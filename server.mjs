import express from "express";
import pg from "pg";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { Client as MinioClient } from "minio";
import { ZipArchive } from "archiver";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import nodemailer from "nodemailer";
import QRCode from "qrcode";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { rateLimit } from "express-rate-limit";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import os from "node:os";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
const { Pool } = pg,
  app = express(),
  port = +(process.env.PORT || 3000),
  root = path.dirname(fileURLToPath(import.meta.url)),
  scrypt = promisify(crypto.scrypt),
  runFile = promisify(execFile),
  backupPath = process.env.BACKUP_PATH || "/backups";
let backupRunning = false;
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "field-log-mail",
  port: +(process.env.SMTP_PORT || 1025),
  secure: false,
});
function privateAddress(address) {
  if (address.toLowerCase().startsWith("::ffff:"))
    return privateAddress(address.slice(7));
  return (
    address === "::" ||
    address === "::1" ||
    address.startsWith("fe80:") ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    /^127\./.test(address) ||
    /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^169\.254\./.test(address) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) ||
    /^198\.(1[89])\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
    /^0\./.test(address)
  );
}
async function safeRemoteUrl(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Only public HTTP(S) links are supported");
  if (
    ["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())
  )
    throw new Error("Private network links are not supported");
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((item) => privateAddress(item.address))
  )
    throw new Error("Private network links are not supported");
  return url;
}
function htmlAttribute(tag, name) {
  return tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
}
async function remotePreview(value, redirects = 0) {
  const url = await safeRemoteUrl(value),
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "Daymark-Link-Preview/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.get("location")
  ) {
    if (redirects >= 3) throw new Error("Too many redirects");
    return remotePreview(
      new URL(response.headers.get("location"), url).href,
      redirects + 1,
    );
  }
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/html")
  )
    throw new Error("Link does not provide an HTML preview");
  const reader = response.body.getReader();
  let size = 0,
    html = "";
  while (size < 524288) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.length;
    html += new TextDecoder().decode(chunk, { stream: true });
  }
  reader.cancel().catch(() => {});
  const metadata = {};
  for (const tag of html.match(/<meta\s[^>]*>/gi) || []) {
    const key = htmlAttribute(tag, "property") || htmlAttribute(tag, "name"),
      content = htmlAttribute(tag, "content");
    if (key && content) metadata[key.toLowerCase()] = content;
  }
  const title =
    metadata["og:title"] ||
    metadata["twitter:title"] ||
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ||
    url.hostname;
  return {
    url: url.href,
    title: title.trim().slice(0, 300),
    description: String(
      metadata["og:description"] ||
        metadata.description ||
        metadata["twitter:description"] ||
        "",
    )
      .trim()
      .slice(0, 600),
    image: metadata["og:image"]
      ? new URL(metadata["og:image"], url).href
      : null,
    siteName: metadata["og:site_name"] || url.hostname,
  };
}
if (!process.env.DATABASE_URL && !process.env.DB_HOST)
  process.exit(console.error("DATABASE_URL or DB_HOST is required"));
const pool = new Pool({
  ...(process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST,
        port: +(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
      }),
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: +(process.env.DATABASE_POOL_SIZE || 10),
});
const mediaBucket = process.env.MINIO_BUCKET || "field-log-media";
const storageQuota = +(process.env.STORAGE_QUOTA || 5 * 1024 * 1024 * 1024);
const mediaStore = new MinioClient({
  endPoint: process.env.MINIO_HOST || "field-log-minio",
  port: +(process.env.MINIO_PORT || 9000),
  useSSL: process.env.MINIO_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY || "fieldlog",
  secretKey: process.env.MINIO_SECRET_KEY || "change-this-minio-password",
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: +(process.env.MEDIA_FILE_LIMIT || 50 * 1024 * 1024),
    files: 12,
  },
});
async function storageUsed(userId) {
  let total = 0;
  for await (const object of mediaStore.listObjectsV2(
    mediaBucket,
    `${userId}/`,
    true,
  ))
    total += object.size || 0;
  return total;
}
async function userStorageQuota(userId, executor = pool) {
  const { rows } = await executor.query(
    "SELECT COALESCE(storage_quota,$2)::bigint AS quota FROM diary_users WHERE id=$1",
    [userId, storageQuota],
  );
  return rows[0] ? +rows[0].quota : storageQuota;
}
async function migrate() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS diary_users(id BIGSERIAL PRIMARY KEY,username TEXT UNIQUE NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,display_name TEXT NOT NULL,bio TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW());CREATE TABLE IF NOT EXISTS diary_sessions(token_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL);CREATE TABLE IF NOT EXISTS diary_entries(id BIGSERIAL PRIMARY KEY,entry_date DATE NOT NULL DEFAULT CURRENT_DATE,title TEXT NOT NULL DEFAULT 'Untitled',body JSONB NOT NULL DEFAULT '[]',tags JSONB NOT NULL DEFAULT '[]',media JSONB NOT NULL DEFAULT '[]',link TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES diary_users(id) ON DELETE CASCADE;ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS mood TEXT NOT NULL DEFAULT '';ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS location_name TEXT NOT NULL DEFAULT '';ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;CREATE TABLE IF NOT EXISTS diary_entry_revisions(id BIGSERIAL PRIMARY KEY,entry_id BIGINT NOT NULL,user_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,snapshot JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS diary_entries_user_date ON diary_entries(user_id,entry_date DESC);CREATE INDEX IF NOT EXISTS diary_sessions_expiry ON diary_sessions(expires_at);CREATE INDEX IF NOT EXISTS diary_revisions_entry ON diary_entry_revisions(entry_id,created_at DESC);`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS diary_entries_search ON diary_entries USING GIN ((to_tsvector('english'::regconfig,coalesce(title,'')||' '||coalesce(mood,'')||' '||coalesce(location_name,'')) || jsonb_to_tsvector('english'::regconfig,body,'["string"]'::jsonb) || jsonb_to_tsvector('english'::regconfig,tags,'["string"]'::jsonb)))`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS diary_journals(id BIGSERIAL PRIMARY KEY,owner_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',color TEXT NOT NULL DEFAULT '#7aa2f7',visibility TEXT NOT NULL DEFAULT 'private',sort_order INTEGER NOT NULL DEFAULT 0,is_default BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(owner_id,name));ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS journal_id BIGINT REFERENCES diary_journals(id) ON DELETE RESTRICT;INSERT INTO diary_journals(owner_id,name,is_default) SELECT u.id,'Field Notes',true FROM diary_users u WHERE NOT EXISTS(SELECT 1 FROM diary_journals j WHERE j.owner_id=u.id);UPDATE diary_entries e SET journal_id=(SELECT j.id FROM diary_journals j WHERE j.owner_id=e.user_id ORDER BY j.is_default DESC,j.sort_order,j.id LIMIT 1) WHERE e.journal_id IS NULL;CREATE INDEX IF NOT EXISTS diary_entries_journal_date ON diary_entries(journal_id,entry_date DESC);CREATE INDEX IF NOT EXISTS diary_journals_owner_sort ON diary_journals(owner_id,sort_order,id);CREATE UNIQUE INDEX IF NOT EXISTS diary_journals_one_default ON diary_journals(owner_id) WHERE is_default;`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS diary_journal_members(journal_id BIGINT NOT NULL REFERENCES diary_journals(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,role TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(journal_id,user_id));CREATE TABLE IF NOT EXISTS diary_journal_invitations(id BIGSERIAL PRIMARY KEY,journal_id BIGINT NOT NULL REFERENCES diary_journals(id) ON DELETE CASCADE,invited_by BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,email TEXT NOT NULL DEFAULT '',role TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,expires_at TIMESTAMPTZ NOT NULL,accepted_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS diary_members_user ON diary_journal_members(user_id,journal_id);CREATE INDEX IF NOT EXISTS diary_invitations_journal ON diary_journal_invitations(journal_id,created_at DESC);`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS diary_comments(id BIGSERIAL PRIMARY KEY,entry_id BIGINT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,parent_id BIGINT REFERENCES diary_comments(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE TABLE IF NOT EXISTS diary_reactions(id BIGSERIAL PRIMARY KEY,entry_id BIGINT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,comment_id BIGINT REFERENCES diary_comments(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,emoji TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE TABLE IF NOT EXISTS diary_activity(id BIGSERIAL PRIMARY KEY,journal_id BIGINT NOT NULL REFERENCES diary_journals(id) ON DELETE CASCADE,actor_id BIGINT REFERENCES diary_users(id) ON DELETE SET NULL,entry_id BIGINT REFERENCES diary_entries(id) ON DELETE CASCADE,action TEXT NOT NULL,metadata JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE TABLE IF NOT EXISTS diary_notifications(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,actor_id BIGINT REFERENCES diary_users(id) ON DELETE SET NULL,entry_id BIGINT REFERENCES diary_entries(id) ON DELETE CASCADE,comment_id BIGINT REFERENCES diary_comments(id) ON DELETE CASCADE,type TEXT NOT NULL,read_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS diary_comments_entry ON diary_comments(entry_id,created_at);CREATE INDEX IF NOT EXISTS diary_reactions_entry ON diary_reactions(entry_id);CREATE UNIQUE INDEX IF NOT EXISTS diary_reactions_unique ON diary_reactions(entry_id,COALESCE(comment_id,0),user_id,emoji);CREATE INDEX IF NOT EXISTS diary_activity_journal ON diary_activity(journal_id,created_at DESC);CREATE INDEX IF NOT EXISTS diary_notifications_user ON diary_notifications(user_id,read_at,created_at DESC);`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS diary_public_links(id BIGSERIAL PRIMARY KEY,entry_id BIGINT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,created_by BIGINT REFERENCES diary_users(id) ON DELETE SET NULL,token_hash TEXT UNIQUE NOT NULL,password_hash TEXT,expires_at TIMESTAMPTZ NOT NULL,revoked_at TIMESTAMPTZ,view_count BIGINT NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_viewed_at TIMESTAMPTZ);CREATE TABLE IF NOT EXISTS diary_public_sessions(token_hash TEXT PRIMARY KEY,link_id BIGINT NOT NULL REFERENCES diary_public_links(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL);CREATE INDEX IF NOT EXISTS diary_public_links_entry ON diary_public_links(entry_id,created_at DESC);CREATE INDEX IF NOT EXISTS diary_public_sessions_expiry ON diary_public_sessions(expires_at);`,
  );
  await pool.query(
    `ALTER TABLE diary_public_links ADD COLUMN IF NOT EXISTS token_ciphertext TEXT;`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS diary_entry_links(id BIGSERIAL PRIMARY KEY,source_entry_id BIGINT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,target_entry_id BIGINT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,created_by BIGINT REFERENCES diary_users(id) ON DELETE SET NULL,label TEXT NOT NULL DEFAULT 'related',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(source_entry_id,target_entry_id),CHECK(source_entry_id<>target_entry_id));CREATE TABLE IF NOT EXISTS diary_people(id BIGSERIAL PRIMARY KEY,owner_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,name TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(owner_id,name));CREATE TABLE IF NOT EXISTS diary_entry_people(entry_id BIGINT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,person_id BIGINT NOT NULL REFERENCES diary_people(id) ON DELETE CASCADE,created_by BIGINT REFERENCES diary_users(id) ON DELETE SET NULL,PRIMARY KEY(entry_id,person_id));CREATE TABLE IF NOT EXISTS diary_collections(id BIGSERIAL PRIMARY KEY,journal_id BIGINT NOT NULL REFERENCES diary_journals(id) ON DELETE CASCADE,name TEXT NOT NULL,color TEXT NOT NULL DEFAULT '#bb9af7',description TEXT NOT NULL DEFAULT '',created_by BIGINT REFERENCES diary_users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(journal_id,name));CREATE TABLE IF NOT EXISTS diary_collection_entries(collection_id BIGINT NOT NULL REFERENCES diary_collections(id) ON DELETE CASCADE,entry_id BIGINT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,added_by BIGINT REFERENCES diary_users(id) ON DELETE SET NULL,PRIMARY KEY(collection_id,entry_id));CREATE INDEX IF NOT EXISTS diary_links_source ON diary_entry_links(source_entry_id);CREATE INDEX IF NOT EXISTS diary_links_target ON diary_entry_links(target_entry_id);CREATE INDEX IF NOT EXISTS diary_entry_people_person ON diary_entry_people(person_id);CREATE INDEX IF NOT EXISTS diary_collection_entries_entry ON diary_collection_entries(entry_id);`,
  );
  await pool.query(
    `ALTER TABLE diary_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;CREATE TABLE IF NOT EXISTS diary_account_tokens(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,type TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS diary_account_tokens_user ON diary_account_tokens(user_id,type,created_at DESC);`,
  );
  await pool.query(
    `ALTER TABLE diary_users ADD COLUMN IF NOT EXISTS totp_secret TEXT;ALTER TABLE diary_users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;ALTER TABLE diary_users ADD COLUMN IF NOT EXISTS recovery_code_hashes JSONB NOT NULL DEFAULT '[]';CREATE TABLE IF NOT EXISTS diary_auth_challenges(token_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,type TEXT NOT NULL,payload JSONB NOT NULL DEFAULT '{}',expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS diary_auth_challenges_user ON diary_auth_challenges(user_id,type,expires_at);`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS diary_passkeys(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,credential_id TEXT UNIQUE NOT NULL,public_key BYTEA NOT NULL,counter BIGINT NOT NULL DEFAULT 0,transports JSONB NOT NULL DEFAULT '[]',device_type TEXT NOT NULL DEFAULT '',backed_up BOOLEAN NOT NULL DEFAULT false,name TEXT NOT NULL DEFAULT 'Passkey',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_used_at TIMESTAMPTZ);CREATE INDEX IF NOT EXISTS diary_passkeys_user ON diary_passkeys(user_id,created_at);`,
  );
  await pool.query(
    `ALTER TABLE diary_sessions ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();ALTER TABLE diary_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();ALTER TABLE diary_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();ALTER TABLE diary_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT '';ALTER TABLE diary_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';CREATE UNIQUE INDEX IF NOT EXISTS diary_sessions_id ON diary_sessions(id);CREATE TABLE IF NOT EXISTS diary_login_history(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES diary_users(id) ON DELETE CASCADE,identifier TEXT NOT NULL DEFAULT '',success BOOLEAN NOT NULL,method TEXT NOT NULL,ip_address TEXT NOT NULL DEFAULT '',user_agent TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS diary_login_history_user ON diary_login_history(user_id,created_at DESC);`,
  );
  await pool.query(
    `ALTER TABLE diary_users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;ALTER TABLE diary_users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;CREATE TABLE IF NOT EXISTS diary_site_settings(id BOOLEAN PRIMARY KEY DEFAULT true CHECK(id),registration_mode TEXT NOT NULL DEFAULT 'open',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());INSERT INTO diary_site_settings(id) VALUES(true) ON CONFLICT(id) DO NOTHING;CREATE TABLE IF NOT EXISTS diary_registration_invites(id BIGSERIAL PRIMARY KEY,code_hash TEXT UNIQUE NOT NULL,created_by BIGINT REFERENCES diary_users(id) ON DELETE SET NULL,max_uses INTEGER NOT NULL DEFAULT 1,use_count INTEGER NOT NULL DEFAULT 0,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS diary_registration_invites_active ON diary_registration_invites(expires_at,use_count);`,
  );
  await pool.query(
    `ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT false;ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS encrypted_payload JSONB;`,
  );
  await pool.query(
    `ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMPTZ;`,
  );
  await pool.query(
    `ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS weather JSONB;`,
  );
  await pool.query(
    `ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS site_name TEXT NOT NULL DEFAULT 'Daymark';ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS site_tagline TEXT NOT NULL DEFAULT 'A private record of days, places, people, and ideas.';ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS site_notice TEXT NOT NULL DEFAULT 'NOTES FROM HOME AND AWAY';ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS footer_text TEXT NOT NULL DEFAULT 'WORDS, IMAGES & OTHER EVIDENCE';`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS diary_admin_audit(id BIGSERIAL PRIMARY KEY,admin_id BIGINT REFERENCES diary_users(id) ON DELETE SET NULL,action TEXT NOT NULL,target_type TEXT NOT NULL DEFAULT '',target_id TEXT NOT NULL DEFAULT '',details JSONB NOT NULL DEFAULT '{}',ip_address TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS diary_admin_audit_created ON diary_admin_audit(created_at DESC);CREATE INDEX IF NOT EXISTS diary_admin_audit_admin ON diary_admin_audit(admin_id,created_at DESC);`,
  );
  await pool.query(
    `ALTER TABLE diary_users ADD COLUMN IF NOT EXISTS storage_quota BIGINT;`,
  );
  await pool.query(
    `ALTER TABLE diary_users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}';`,
  );
  await pool.query(
    `ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS alert_memory_percent INTEGER NOT NULL DEFAULT 90;ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS alert_db_connections_percent INTEGER NOT NULL DEFAULT 80;ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS alert_failed_logins INTEGER NOT NULL DEFAULT 10;ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS alert_backup_hours INTEGER NOT NULL DEFAULT 30;ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS alert_storage_percent INTEGER NOT NULL DEFAULT 90;`,
  );
  await pool.query(
    `ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS maintenance_enabled BOOLEAN NOT NULL DEFAULT false;ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS maintenance_starts_at TIMESTAMPTZ;ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS maintenance_ends_at TIMESTAMPTZ;ALTER TABLE diary_site_settings ADD COLUMN IF NOT EXISTS maintenance_message TEXT NOT NULL DEFAULT 'The diary is temporarily unavailable while maintenance is completed.';`,
  );
  await pool.query(
    `ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS entry_time TIME;UPDATE diary_entries SET entry_time=created_at::time WHERE entry_time IS NULL;`,
  );
  await pool.query(
    `ALTER TABLE diary_comments ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT true;CREATE TABLE IF NOT EXISTS diary_user_blocks(blocker_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,blocked_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(blocker_id,blocked_id),CHECK(blocker_id<>blocked_id));CREATE INDEX IF NOT EXISTS diary_user_blocks_blocked ON diary_user_blocks(blocked_id,blocker_id);`,
  );
  await pool.query(
    `ALTER TABLE diary_comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;CREATE INDEX IF NOT EXISTS diary_comments_deleted ON diary_comments(entry_id,deleted_at);`,
  );
  await pool.query(
    `ALTER TABLE diary_notifications ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;ALTER TABLE diary_notifications ADD COLUMN IF NOT EXISTS email_attempted_at TIMESTAMPTZ;CREATE INDEX IF NOT EXISTS diary_notifications_email_pending ON diary_notifications(user_id,created_at) WHERE email_sent_at IS NULL;`,
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS diary_user_backups(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id BIGINT NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,file_name TEXT NOT NULL,bytes BIGINT NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS diary_user_backups_user ON diary_user_backups(user_id,created_at DESC);`,
  );
  await pool.query(
    `ALTER TABLE diary_users ADD COLUMN IF NOT EXISTS self_deactivated BOOLEAN NOT NULL DEFAULT false;ALTER TABLE diary_users ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;ALTER TABLE diary_users ADD COLUMN IF NOT EXISTS deletion_scheduled_for TIMESTAMPTZ;`,
  );
  if (process.env.ADMIN_EMAIL)
    await pool.query(
      "UPDATE diary_users SET is_admin=true WHERE email=lower($1)",
      [process.env.ADMIN_EMAIL],
    );
  if (!(await mediaStore.bucketExists(mediaBucket)))
    await mediaStore.makeBucket(mediaBucket);
}
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
async function password(p, salt = crypto.randomBytes(16).toString("hex")) {
  return salt + ":" + Buffer.from(await scrypt(p, salt, 64)).toString("hex");
}
async function verify(p, v) {
  const [salt, key] = v.split(":");
  return crypto.timingSafeEqual(
    Buffer.from(key, "hex"),
    Buffer.from((await password(p, salt)).split(":")[1], "hex"),
  );
}
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(buffer) {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  return bits
    .match(/.{1,5}/g)
    .map((chunk) => base32Alphabet[parseInt(chunk.padEnd(5, "0"), 2)])
    .join("");
}
function base32Decode(value) {
  const bits = [...value.toUpperCase().replace(/=+$/, "")]
    .map((character) =>
      base32Alphabet.indexOf(character).toString(2).padStart(5, "0"),
    )
    .join("");
  return Buffer.from(
    (bits.match(/.{8}/g) || []).map((byte) => parseInt(byte, 2)),
  );
}
function totpCode(secret, offset = 0) {
  const counter = Math.floor(Date.now() / 30000) + offset,
    buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto
      .createHmac("sha1", base32Decode(secret))
      .update(buffer)
      .digest(),
    position = digest[digest.length - 1] & 15,
    number = (digest.readUInt32BE(position) & 0x7fffffff) % 1000000;
  return String(number).padStart(6, "0");
}
function verifyTotp(secret, code) {
  const candidate = String(code || "").trim();
  return (
    /^\d{6}$/.test(candidate) &&
    [-1, 0, 1].some((offset) =>
      crypto.timingSafeEqual(
        Buffer.from(totpCode(secret, offset)),
        Buffer.from(candidate),
      ),
    )
  );
}
function encryptSecret(value) {
  const key = crypto
      .createHash("sha256")
      .update(process.env.AUTH_ENCRYPTION_KEY || "field-log-change-this-key")
      .digest(),
    iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key, iv),
    encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}
function decryptSecret(value) {
  const [iv, tag, encrypted] = value
      .split(".")
      .map((part) => Buffer.from(part, "base64url")),
    key = crypto
      .createHash("sha256")
      .update(process.env.AUTH_ENCRYPTION_KEY || "field-log-change-this-key")
      .digest(),
    decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
async function authChallenge(userId, type, payload = {}, minutes = 10) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO diary_auth_challenges(token_hash,user_id,type,payload,expires_at) VALUES($1,$2,$3,$4,NOW()+($5||' minutes')::interval)",
    [hash(token), userId, type, payload, minutes],
  );
  return token;
}
function cookie(req, name) {
  return req.headers.cookie
    ?.split(";")
    .map((x) => x.trim().split("="))
    .find((x) => x[0] === name)?.[1];
}
async function auth(req, res, next) {
  try {
    const token = cookie(req, "diary_session");
    if (!token)
      return res.status(401).json({ error: "Authentication required" });
    const { rows } = await pool.query(
      `SELECT u.id,u.username,u.email,u.display_name,u.bio,u.email_verified_at,u.two_factor_enabled,u.is_admin FROM diary_sessions s JOIN diary_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.disabled_at IS NULL`,
      [hash(token)],
    );
    if (!rows[0]) return res.status(401).json({ error: "Session expired" });
    req.user = rows[0];
    await pool.query(
      "UPDATE diary_sessions SET last_seen_at=NOW() WHERE token_hash=$1 AND last_seen_at<NOW()-INTERVAL '5 minutes'",
      [hash(token)],
    );
    next();
  } catch (e) {
    next(e);
  }
}
const entry = (r) => ({
  id: +r.id,
  date:
    r.entry_date instanceof Date
      ? r.entry_date.toISOString().slice(0, 10)
      : String(r.entry_date).slice(0, 10),
  time: r.entry_time ? String(r.entry_time).slice(0, 5) : "",
  title: r.title,
  body: r.body,
  tags: r.tags,
  media: r.media,
  link: r.link,
  visibility: r.visibility,
  mood: r.mood,
  location: r.location_name,
  latitude: r.latitude,
  longitude: r.longitude,
  pinned: r.pinned,
  author: r.display_name,
  userId: r.user_id ? +r.user_id : null,
  owner: r.owner ?? true,
  journalId: r.journal_id ? +r.journal_id : null,
  encrypted: r.is_encrypted || false,
  encryptedPayload: r.encrypted_payload || null,
  reminderAt: r.reminder_at || null,
  weather: r.weather || null,
});
const journal = (row) => ({
  id: +row.id,
  name: row.name,
  description: row.description,
  color: row.color,
  visibility: row.visibility,
  sortOrder: row.sort_order,
  isDefault: row.is_default,
  ownerId: +row.owner_id,
  entryCount: +(row.entry_count || 0),
  role: row.role || "owner",
  owned: row.role ? row.role === "owner" : true,
});
async function writableJournal(
  userId,
  requestedId,
  roles = ["owner", "editor", "contributor"],
) {
  const { rows } = await pool.query(
    `SELECT j.id,CASE WHEN j.owner_id=$1 THEN 'owner' ELSE m.role END AS role FROM diary_journals j LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$1 WHERE (j.owner_id=$1 OR m.user_id=$1) AND ($2::bigint IS NULL OR j.id=$2) ORDER BY CASE WHEN j.id=$2 THEN 0 ELSE 1 END,j.is_default DESC,j.sort_order,j.id LIMIT 1`,
    [userId, requestedId || null],
  );
  return rows[0] && roles.includes(rows[0].role) ? rows[0] : null;
}
async function entryAccess(userId, entryId) {
  const { rows } = await pool.query(
    `SELECT e.id,e.journal_id,e.user_id,e.title,e.is_encrypted,CASE WHEN j.owner_id=$1 THEN 'owner' ELSE m.role END AS role,(e.user_id=$1 OR j.owner_id=$1 OR m.role='editor') AS can_manage FROM diary_entries e JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$1 WHERE e.id=$2 AND e.deleted_at IS NULL AND (e.user_id=$1 OR j.owner_id=$1 OR m.user_id=$1 OR e.visibility='public')`,
    [userId, entryId],
  );
  return rows[0] || null;
}
async function activity(
  journalId,
  actorId,
  action,
  entryId = null,
  metadata = {},
) {
  await pool.query(
    "INSERT INTO diary_activity(journal_id,actor_id,entry_id,action,metadata) VALUES($1,$2,$3,$4,$5)",
    [journalId, actorId, entryId, action, metadata],
  );
}
async function notifyJournalMembers(journalId, actorId, entryId, type) {
  await pool.query(
    `INSERT INTO diary_notifications(user_id,actor_id,entry_id,type) SELECT recipients.user_id,$2,$3,$4 FROM (SELECT owner_id AS user_id FROM diary_journals WHERE id=$1 UNION SELECT user_id FROM diary_journal_members WHERE journal_id=$1) recipients JOIN diary_users u ON u.id=recipients.user_id WHERE recipients.user_id<>$2 AND COALESCE((u.preferences->>'notifyShares')::boolean,true) AND NOT EXISTS(SELECT 1 FROM diary_user_blocks b WHERE (b.blocker_id=recipients.user_id AND b.blocked_id=$2) OR (b.blocker_id=$2 AND b.blocked_id=recipients.user_id))`,
    [journalId, actorId, entryId, type],
  );
}
async function sendAccountToken(req, user, type) {
  const token = crypto.randomBytes(32).toString("base64url"),
    hours = type === "verify" ? 48 : 1,
    route = type === "verify" ? "verify" : "reset",
    origin = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
  await pool.query(
    "UPDATE diary_account_tokens SET used_at=NOW() WHERE user_id=$1 AND type=$2 AND used_at IS NULL",
    [user.id, type],
  );
  await pool.query(
    "INSERT INTO diary_account_tokens(user_id,type,token_hash,expires_at) VALUES($1,$2,$3,NOW()+($4||' hours')::interval)",
    [user.id, type, hash(token), hours],
  );
  await mailer.sendMail({
    from: process.env.MAIL_FROM || "Daymark <field-log@localhost>",
    to: user.email,
    subject:
      type === "verify"
        ? "Verify your Daymark email"
        : "Reset your Daymark password",
    text: `${type === "verify" ? "Verify your email" : "Reset your password"}: ${origin}/${route}/${token}\n\nThis link expires in ${hours} hour${hours === 1 ? "" : "s"}.`,
  });
}
function webauthnConfig(req) {
  const origin =
    process.env.WEBAUTHN_ORIGIN || `${req.protocol}://${req.get("host")}`;
  return {
    origin,
    rpID: process.env.WEBAUTHN_RP_ID || new URL(origin).hostname,
    rpName: process.env.WEBAUTHN_RP_NAME || "Daymark",
  };
}
let maintenanceCache = { expires: 0, value: null };
async function maintenanceStatus() {
  if (maintenanceCache.value && maintenanceCache.expires > Date.now())
    return maintenanceCache.value;
  const { rows } = await pool.query(
    `SELECT maintenance_enabled,maintenance_starts_at,maintenance_ends_at,maintenance_message,(maintenance_enabled AND (maintenance_starts_at IS NULL OR maintenance_starts_at<=NOW()) AND (maintenance_ends_at IS NULL OR maintenance_ends_at>NOW())) AS maintenance_active FROM diary_site_settings WHERE id=true`,
  );
  maintenanceCache = { expires: Date.now() + 5000, value: rows[0] };
  return rows[0];
}
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: process.env.JSON_LIMIT || "30mb" }));
const strictAuthLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many authentication attempts. Try again later." },
  }),
  recoveryLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many recovery requests. Try again later." },
  }),
  publicAccessLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many public-link attempts. Try again later." },
  }),
  apiWriteLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many changes. Slow down and try again." },
  });
app.use(
  [
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/2fa/login",
    "/api/auth/passkey/options",
    "/api/auth/passkey/verify",
  ],
  strictAuthLimit,
);
app.use(
  [
    "/api/auth/password/request",
    "/api/auth/password/reset",
    "/api/auth/verification/resend",
  ],
  recoveryLimit,
);
app.use("/api/public", publicAccessLimit);
app.use("/api", (req, res, next) =>
  ["GET", "HEAD", "OPTIONS"].includes(req.method)
    ? next()
    : apiWriteLimit(req, res, next),
);
app.use("/api", (req, res, next) => {
  let csrf = cookie(req, "field_log_csrf");
  if (!csrf) {
    csrf = crypto.randomBytes(24).toString("base64url");
    res.append(
      "Set-Cookie",
      `field_log_csrf=${csrf}; SameSite=Strict; Path=/; Max-Age=2592000${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
    );
  }
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    cookie(req, "diary_session")
  ) {
    const supplied = String(req.get("x-csrf-token") || "");
    if (
      supplied.length !== csrf.length ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(csrf))
    )
      return res.status(403).json({ error: "Invalid CSRF token" });
  }
  next();
});
app.use("/api", async (req, res, next) => {
  try {
    if (
      req.path === "/health" ||
      req.path === "/site-settings" ||
      req.path.startsWith("/auth/")
    )
      return next();
    const status = await maintenanceStatus();
    if (!status?.maintenance_active) return next();
    const token = cookie(req, "diary_session");
    if (token) {
      const { rows } = await pool.query(
        `SELECT u.is_admin FROM diary_sessions s JOIN diary_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.disabled_at IS NULL`,
        [hash(token)],
      );
      if (rows[0]?.is_admin) return next();
    }
    res.status(503).json({
      error: "Maintenance mode",
      maintenance: true,
      message: status.maintenance_message,
      startsAt: status.maintenance_starts_at,
      endsAt: status.maintenance_ends_at,
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/health", async (_q, r) => {
  try {
    await pool.query("SELECT 1");
    r.json({ status: "ok", database: "connected" });
  } catch {
    r.status(503).json({ status: "error" });
  }
});
app.get("/api/places", auth, async (req, res, next) => {
  try {
    const query = String(req.query.q || "")
      .trim()
      .slice(0, 160);
    if (query.length < 3)
      return res.status(400).json({ error: "Enter at least 3 characters" });
    const parameters = new URLSearchParams({
        q: query,
        format: "jsonv2",
        addressdetails: "1",
        limit: "6",
      }),
      response = await fetch(
        `https://nominatim.openstreetmap.org/search?${parameters}`,
        {
          headers: {
            "User-Agent": `Daymark/1.0 (${process.env.APP_URL || "self-hosted"})`,
            Accept: "application/json",
          },
        },
      );
    if (!response.ok)
      throw new Error(`Place provider returned ${response.status}`);
    const places = await response.json();
    res.json(
      places.map((place) => ({
        id: place.place_id,
        name: place.display_name,
        latitude: +place.lat,
        longitude: +place.lon,
        type: place.type,
      })),
    );
  } catch (error) {
    next(error);
  }
});
app.get("/api/link-preview", auth, async (req, res) => {
  try {
    res.json(await remotePreview(String(req.query.url || "")));
  } catch (error) {
    res
      .status(422)
      .json({ error: error.message || "Link preview unavailable" });
  }
});
app.get("/api/weather", auth, async (req, res, next) => {
  try {
    const latitude = +req.query.latitude,
      longitude = +req.query.longitude,
      date = String(req.query.date || "");
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    )
      return res
        .status(400)
        .json({ error: "Valid coordinates and date required" });
    const historical =
        date < new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
      endpoint = historical
        ? "https://archive-api.open-meteo.com/v1/archive"
        : "https://api.open-meteo.com/v1/forecast",
      parameters = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        start_date: date,
        end_date: date,
        daily:
          "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max",
        timezone: "auto",
      }),
      response = await fetch(`${endpoint}?${parameters}`),
      result = await response.json();
    if (!response.ok || !result.daily?.time?.length)
      return res.status(422).json({
        error: result.reason || "Weather is unavailable for this date",
      });
    res.json({
      date: result.daily.time[0],
      code: result.daily.weather_code[0],
      temperatureMax: result.daily.temperature_2m_max[0],
      temperatureMin: result.daily.temperature_2m_min[0],
      precipitation: result.daily.precipitation_sum[0],
      windMax: result.daily.wind_speed_10m_max[0],
      timezone: result.timezone,
      source: "Open-Meteo",
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/auth/registration", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT registration_mode FROM diary_site_settings WHERE id=true",
    );
    res.json({ mode: rows[0].registration_mode });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/register", async (req, res, next) => {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    const { username, email, password: pass, displayName } = req.body,
      inviteCode = String(req.body.inviteCode || "")
        .trim()
        .toUpperCase();
    if (
      !/^[a-z0-9_-]{3,30}$/i.test(username) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      pass?.length < 10
    )
      return res.status(400).json({
        error:
          "Use a valid username, email, and password of at least 10 characters",
      });
    await client.query("BEGIN");
    transactionOpen = true;
    const setting = await client.query(
        "SELECT registration_mode FROM diary_site_settings WHERE id=true FOR UPDATE",
      ),
      mode = setting.rows[0].registration_mode;
    if (mode === "closed") {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return res
        .status(403)
        .json({ error: "Registration is currently closed" });
    }
    if (mode === "invite") {
      const accepted = await client.query(
        "UPDATE diary_registration_invites SET use_count=use_count+1 WHERE code_hash=$1 AND expires_at>NOW() AND use_count<max_uses RETURNING id",
        [hash(inviteCode)],
      );
      if (!accepted.rowCount) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res
          .status(403)
          .json({ error: "A valid registration invitation is required" });
      }
    }
    const admins = await client.query(
        "SELECT count(*)::int AS count FROM diary_users WHERE is_admin",
      ),
      makeAdmin =
        admins.rows[0].count === 0 ||
        (!!process.env.ADMIN_EMAIL &&
          email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()),
      { rows } = await client.query(
        "INSERT INTO diary_users(username,email,password_hash,display_name,is_admin) VALUES(lower($1),lower($2),$3,$4,$5) RETURNING id,username,email,display_name,bio,email_verified_at,two_factor_enabled,is_admin",
        [
          username,
          email,
          await password(pass),
          displayName || username,
          makeAdmin,
        ],
      );
    await client.query(
      "INSERT INTO diary_journals(owner_id,name,is_default) VALUES($1,'Field Notes',true)",
      [rows[0].id],
    );
    await client.query("COMMIT");
    transactionOpen = false;
    await login(rows[0], req, res, "registration");
    await sendAccountToken(req, rows[0], "verify").catch(console.error);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (transactionOpen) await client.query("ROLLBACK");
    if (e.code === "23505")
      return res
        .status(409)
        .json({ error: "Username or email already exists" });
    next(e);
  } finally {
    client.release();
  }
});
app.post("/api/auth/reactivate", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM diary_users WHERE (username=lower($1) OR email=lower($1)) AND self_deactivated",
      [req.body.login],
    );
    if (!rows[0] || !(await verify(req.body.password || "", rows[0].password_hash)))
      return res.status(401).json({ error: "Invalid credentials or account was disabled by an administrator" });
    await pool.query("UPDATE diary_users SET disabled_at=NULL,self_deactivated=false WHERE id=$1", [rows[0].id]);
    await login(rows[0], req, res, "reactivation");
    const { password_hash, totp_secret, recovery_code_hashes, ...user } = rows[0];
    res.json({ ...user, disabled_at: null, self_deactivated: false });
  } catch (error) { next(error); }
});
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM diary_users WHERE username=lower($1) OR email=lower($1)",
      [req.body.login],
    );
    if (
      !rows[0] ||
      rows[0].disabled_at ||
      !(await verify(req.body.password || "", rows[0].password_hash))
    ) {
      await recordLogin(
        req,
        rows[0]?.id || null,
        String(req.body.login || ""),
        false,
        "password",
      );
      if (rows[0]?.id)
        await pool.query(
          `INSERT INTO diary_notifications(user_id,type) SELECT id,'security_failed_login' FROM diary_users WHERE id=$1 AND COALESCE((preferences->>'notifySecurity')::boolean,true)`,
          [rows[0].id],
        );
      return res.status(401).json({ error: "Invalid credentials" });
    }
    if (rows[0].two_factor_enabled)
      return res.json({
        requiresTwoFactor: true,
        challenge: await authChallenge(rows[0].id, "login-2fa"),
      });
    await login(rows[0], req, res, "password");
    const { password_hash, totp_secret, recovery_code_hashes, ...user } =
      rows[0];
    res.json(user);
  } catch (e) {
    next(e);
  }
});
app.post("/api/auth/2fa/login", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const challenge = await client.query(
      "SELECT * FROM diary_auth_challenges WHERE token_hash=$1 AND type='login-2fa' AND expires_at>NOW() FOR UPDATE",
      [hash(String(req.body.challenge || ""))],
    );
    if (!challenge.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Login challenge expired" });
    }
    const userResult = await client.query(
        "SELECT * FROM diary_users WHERE id=$1",
        [challenge.rows[0].user_id],
      ),
      user = userResult.rows[0],
      code = String(req.body.code || "")
        .trim()
        .toUpperCase(),
      recoveryIndex = (user.recovery_code_hashes || []).findIndex(
        (item) => item === hash(code),
      ),
      valid =
        verifyTotp(decryptSecret(user.totp_secret), code) || recoveryIndex >= 0;
    if (!valid) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Invalid authentication code" });
    }
    if (recoveryIndex >= 0) {
      const remaining = [...user.recovery_code_hashes];
      remaining.splice(recoveryIndex, 1);
      await client.query(
        "UPDATE diary_users SET recovery_code_hashes=$1 WHERE id=$2",
        [JSON.stringify(remaining), user.id],
      );
    }
    await client.query(
      "DELETE FROM diary_auth_challenges WHERE token_hash=$1",
      [hash(req.body.challenge)],
    );
    await client.query("COMMIT");
    await login(user, req, res, recoveryIndex >= 0 ? "recovery-code" : "totp");
    const { password_hash, totp_secret, recovery_code_hashes, ...safeUser } =
      user;
    res.json(safeUser);
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});
async function recordLogin(req, userId, identifier, success, method) {
  await pool.query(
    "INSERT INTO diary_login_history(user_id,identifier,success,method,ip_address,user_agent) VALUES($1,$2,$3,$4,$5,$6)",
    [
      userId,
      identifier.slice(0, 254),
      success,
      method,
      req.ip || "",
      String(req.get("user-agent") || "").slice(0, 500),
    ],
  );
}
async function login(user, req, res, method = "password") {
  const token = crypto.randomBytes(32).toString("base64url"),
    ip = req.ip || "",
    userAgent = String(req.get("user-agent") || "").slice(0, 500),
    knownDevice = await pool.query(
      "SELECT 1 FROM diary_sessions WHERE user_id=$1 AND ip_address=$2 AND user_agent=$3 LIMIT 1",
      [user.id, ip, userAgent],
    );
  await pool.query(
    "INSERT INTO diary_sessions(token_hash,user_id,expires_at,ip_address,user_agent) VALUES($1,$2,NOW()+INTERVAL '30 days',$3,$4)",
    [
      hash(token),
      user.id,
      ip,
      userAgent,
    ],
  );
  await recordLogin(
    req,
    user.id,
    user.email || user.username || "",
    true,
    method,
  );
  if (method !== "registration" && !knownDevice.rowCount)
    await pool.query(
      `INSERT INTO diary_notifications(user_id,type) SELECT id,'security_new_device' FROM diary_users WHERE id=$1 AND COALESCE((preferences->>'notifySecurity')::boolean,true)`,
      [user.id],
    );
  res.setHeader(
    "Set-Cookie",
    `diary_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
  );
}
app.get("/api/auth/me", auth, (q, r) => r.json(q.user));
const defaultUserPreferences = {
  defaultVisibility: "private",
  defaultJournal: "",
  defaultView: "diary",
  entriesPerPage: 20,
  dateFormat: "locale",
  timeFormat: "24h",
  timezone: "auto",
  temperatureUnit: "celsius",
  distanceUnit: "metric",
  weekStartsOn: "monday",
  spellcheck: true,
  autosave: true,
  editorMode: "markdown",
  imageQuality: "high",
  mapZoom: 11,
  rememberEntryOptions: true,
  theme: "tokyo-night",
  fontScale: 100,
  density: "comfortable",
  reduceMotion: false,
  compactEntries: false,
  accentColor: "#7aa2f7",
  headerImage: "",
  notifyComments: true,
  notifyReplies: true,
  notifyMentions: true,
  notifyShares: true,
  notifySecurity: true,
  notificationInApp: true,
  notificationBrowser: false,
  notificationEmail: false,
  digestFrequency: "instant",
  digestTime: "08:00",
  quietHoursStart: "",
  quietHoursEnd: "",
  locationPrecision: "exact",
  commentPolicy: "members",
  approveComments: false,
  profileVisibility: "private",
  shareExpiryDays: 7,
  avatarUrl: "",
  pronouns: "",
  personalWebsite: "",
  homeLocation: "",
  language: "auto",
  customTemplates: [],
  customPrompts: [],
  writingGoals: { weeklyEntries: 3, monthlyWords: 5000 },
  recurringPromptTime: "",
  recurringPromptDays: [],
};
function timeInZone(timezone) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone && timezone !== "auto" ? timezone : undefined, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  } catch {
    return new Date().toTimeString().slice(0, 5);
  }
}
function withinQuietHours(preferences) {
  const start = preferences.quietHoursStart, end = preferences.quietHoursEnd;
  if (!start || !end || start === end) return false;
  const now = timeInZone(preferences.timezone);
  return start < end ? now >= start && now < end : now >= start || now < end;
}
async function deliverNotificationEmails() {
  const { rows } = await pool.query(
    `SELECT n.id,n.user_id,n.type,n.created_at,u.email,u.display_name,u.preferences,a.display_name AS actor,e.title AS entry_title FROM diary_notifications n JOIN diary_users u ON u.id=n.user_id LEFT JOIN diary_users a ON a.id=n.actor_id LEFT JOIN diary_entries e ON e.id=n.entry_id WHERE u.email_verified_at IS NOT NULL AND n.email_sent_at IS NULL AND (n.email_attempted_at IS NULL OR n.email_attempted_at<NOW()-INTERVAL '15 minutes') ORDER BY n.created_at LIMIT 500`,
  );
  const groups = new Map();
  for (const item of rows) {
    const preferences = { ...defaultUserPreferences, ...(item.preferences || {}) };
    if (!preferences.notificationEmail || withinQuietHours(preferences)) continue;
    const age = Date.now() - new Date(item.created_at).getTime(), frequency = preferences.digestFrequency;
    if ((frequency === "daily" && age < 86400000) || (frequency === "weekly" && age < 604800000) || frequency === "off") continue;
    if (frequency !== "instant" && preferences.digestTime && timeInZone(preferences.timezone) < preferences.digestTime) continue;
    const group = groups.get(item.user_id) || { user: item, preferences, items: [] };
    group.items.push(item);
    groups.set(item.user_id, group);
  }
  for (const group of groups.values()) {
    const ids = group.items.map((item) => item.id);
    await pool.query("UPDATE diary_notifications SET email_attempted_at=NOW() WHERE id=ANY($1::bigint[])", [ids]);
    try {
      const lines = group.items.map((item) => `${item.actor || "Diary security"} ${item.type.replaceAll("_", " ")}${item.entry_title ? `: ${item.entry_title}` : ""}`), digest = group.preferences.digestFrequency !== "instant" || lines.length > 1;
      await mailer.sendMail({
        from: process.env.MAIL_FROM || "Daymark <field-log@localhost>",
        to: group.user.email,
        subject: digest ? `${lines.length} diary notifications` : lines[0],
        text: `Hello ${group.user.display_name},\n\n${lines.map((line) => `- ${line}`).join("\n")}\n\nOpen your inbox: ${(process.env.APP_URL || "").replace(/\/$/, "")}/settings#notifications`,
      });
      await pool.query("UPDATE diary_notifications SET email_sent_at=NOW() WHERE id=ANY($1::bigint[])", [ids]);
    } catch (error) {
      console.error("Notification email delivery failed", error.message);
    }
  }
}
app.get("/api/preferences", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT preferences FROM diary_users WHERE id=$1",
      [req.user.id],
    );
    res.json({ ...defaultUserPreferences, ...(rows[0]?.preferences || {}) });
  } catch (error) {
    next(error);
  }
});
app.put("/api/preferences", auth, async (req, res, next) => {
  try {
    const clean = {};
    for (const [key, fallback] of Object.entries(defaultUserPreferences)) {
      if (!(key in req.body)) continue;
      const value = req.body[key];
      if (typeof fallback === "boolean") clean[key] = !!value;
      else if (typeof fallback === "number") {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) clean[key] = numeric;
      }
      else if (Array.isArray(fallback))
        clean[key] = Array.isArray(value) ? value.slice(0, 50) : [];
      else if (fallback && typeof fallback === "object")
        clean[key] = value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
      else clean[key] = String(value).slice(0, 500);
    }
    const { rows } = await pool.query(
      "UPDATE diary_users SET preferences=preferences||$1::jsonb WHERE id=$2 RETURNING preferences",
      [JSON.stringify(clean), req.user.id],
    );
    res.json({ ...defaultUserPreferences, ...rows[0].preferences });
  } catch (error) {
    next(error);
  }
});
app.put("/api/profile", auth, async (req, res, next) => {
  try {
    const displayName = String(req.body.displayName || "").trim().slice(0, 100);
    const bio = String(req.body.bio || "").trim().slice(0, 2000);
    if (displayName.length < 2)
      return res.status(400).json({ error: "Display name must contain at least two characters" });
    const { rows } = await pool.query(
      "UPDATE diary_users SET display_name=$1,bio=$2 WHERE id=$3 RETURNING id,username,email,display_name,bio,email_verified_at,two_factor_enabled,is_admin",
      [displayName, bio, req.user.id],
    );
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/logout", auth, async (q, r) => {
  await pool.query("DELETE FROM diary_sessions WHERE token_hash=$1", [
    hash(cookie(q, "diary_session")),
  ]);
  r.setHeader(
    "Set-Cookie",
    "diary_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
  );
  r.status(204).end();
});
app.get("/api/security", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
        "SELECT two_factor_enabled,jsonb_array_length(recovery_code_hashes) AS recovery_codes FROM diary_users WHERE id=$1",
        [req.user.id],
      ),
      passkeys = await pool.query(
        "SELECT id,name,device_type,backed_up,created_at,last_used_at FROM diary_passkeys WHERE user_id=$1 ORDER BY created_at DESC",
        [req.user.id],
      );
    res.json({
      twoFactorEnabled: rows[0].two_factor_enabled,
      recoveryCodes: +rows[0].recovery_codes,
      passkeys: passkeys.rows.map((item) => ({ ...item, id: +item.id })),
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/security/sessions", auth, async (req, res, next) => {
  try {
    const currentHash = hash(cookie(req, "diary_session") || ""),
      { rows } = await pool.query(
        "SELECT id,created_at,last_seen_at,expires_at,ip_address,user_agent,(token_hash=$2) AS current FROM diary_sessions WHERE user_id=$1 AND expires_at>NOW() ORDER BY current DESC,last_seen_at DESC",
        [req.user.id, currentHash],
      );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});
app.delete("/api/security/sessions/:id", auth, async (req, res, next) => {
  try {
    const currentHash = hash(cookie(req, "diary_session") || ""),
      { rows } = await pool.query(
        "DELETE FROM diary_sessions WHERE id=$1 AND user_id=$2 RETURNING token_hash",
        [req.params.id, req.user.id],
      );
    if (!rows[0]) return res.status(404).json({ error: "Session not found" });
    if (rows[0].token_hash === currentHash)
      res.setHeader(
        "Set-Cookie",
        "diary_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.delete("/api/security/sessions", auth, async (req, res, next) => {
  try {
    const currentHash = hash(cookie(req, "diary_session") || "");
    await pool.query(
      "DELETE FROM diary_sessions WHERE user_id=$1 AND token_hash<>$2",
      [req.user.id, currentHash],
    );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.get("/api/security/login-history", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id,success,method,ip_address,user_agent,created_at FROM diary_login_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [req.user.id],
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});
app.post("/api/security/passkeys/options", auth, async (req, res, next) => {
  try {
    const config = webauthnConfig(req),
      existing = await pool.query(
        "SELECT credential_id,transports FROM diary_passkeys WHERE user_id=$1",
        [req.user.id],
      ),
      options = await generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpID,
        userName: req.user.email,
        userDisplayName: req.user.display_name,
        userID: Buffer.from(String(req.user.id)),
        attestationType: "none",
        excludeCredentials: existing.rows.map((item) => ({
          id: item.credential_id,
          transports: item.transports,
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
      }),
      challengeToken = await authChallenge(req.user.id, "passkey-register", {
        challenge: options.challenge,
        origin: config.origin,
        rpID: config.rpID,
      });
    res.json({ options, challengeToken });
  } catch (error) {
    next(error);
  }
});
app.post("/api/security/passkeys/verify", auth, async (req, res, next) => {
  try {
    const challenge = await pool.query(
      "SELECT * FROM diary_auth_challenges WHERE token_hash=$1 AND user_id=$2 AND type='passkey-register' AND expires_at>NOW()",
      [hash(String(req.body.challengeToken || "")), req.user.id],
    );
    if (!challenge.rows[0])
      return res.status(404).json({ error: "Passkey challenge expired" });
    const payload = challenge.rows[0].payload,
      verification = await verifyRegistrationResponse({
        response: req.body.response,
        expectedChallenge: payload.challenge,
        expectedOrigin: payload.origin,
        expectedRPID: payload.rpID,
      });
    if (!verification.verified)
      return res
        .status(400)
        .json({ error: "Passkey registration could not be verified" });
    const info = verification.registrationInfo,
      credential = info.credential,
      name =
        String(req.body.name || "Passkey")
          .trim()
          .slice(0, 80) || "Passkey";
    await pool.query(
      `INSERT INTO diary_passkeys(user_id,credential_id,public_key,counter,transports,device_type,backed_up,name) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        req.user.id,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports || []),
        info.credentialDeviceType,
        info.credentialBackedUp,
        name,
      ],
    );
    await pool.query("DELETE FROM diary_auth_challenges WHERE token_hash=$1", [
      hash(req.body.challengeToken),
    ]);
    res.status(201).json({ verified: true });
  } catch (error) {
    if (error.code === "23505")
      return res
        .status(409)
        .json({ error: "This passkey is already registered" });
    next(error);
  }
});
app.delete("/api/security/passkeys/:id", auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "DELETE FROM diary_passkeys WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id],
    );
    if (!result.rowCount)
      return res.status(404).json({ error: "Passkey not found" });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/passkey/options", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id FROM diary_users WHERE username=lower($1) OR email=lower($1)",
      [String(req.body.login || "")],
    );
    if (!rows[0])
      return res.status(404).json({ error: "No passkey account found" });
    const credentials = await pool.query(
      "SELECT credential_id,transports FROM diary_passkeys WHERE user_id=$1",
      [rows[0].id],
    );
    if (!credentials.rowCount)
      return res
        .status(404)
        .json({ error: "No passkeys registered for this account" });
    const config = webauthnConfig(req),
      options = await generateAuthenticationOptions({
        rpID: config.rpID,
        allowCredentials: credentials.rows.map((item) => ({
          id: item.credential_id,
          transports: item.transports,
        })),
        userVerification: "required",
      }),
      challengeToken = await authChallenge(rows[0].id, "passkey-login", {
        challenge: options.challenge,
        origin: config.origin,
        rpID: config.rpID,
      });
    res.json({ options, challengeToken });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/passkey/verify", async (req, res, next) => {
  try {
    const challenge = await pool.query(
      "SELECT * FROM diary_auth_challenges WHERE token_hash=$1 AND type='passkey-login' AND expires_at>NOW()",
      [hash(String(req.body.challengeToken || ""))],
    );
    if (!challenge.rows[0])
      return res.status(404).json({ error: "Passkey challenge expired" });
    const passkey = await pool.query(
      "SELECT * FROM diary_passkeys WHERE credential_id=$1 AND user_id=$2",
      [req.body.response?.id, challenge.rows[0].user_id],
    );
    if (!passkey.rows[0])
      return res.status(404).json({ error: "Passkey not found" });
    const item = passkey.rows[0],
      payload = challenge.rows[0].payload,
      verification = await verifyAuthenticationResponse({
        response: req.body.response,
        expectedChallenge: payload.challenge,
        expectedOrigin: payload.origin,
        expectedRPID: payload.rpID,
        credential: {
          id: item.credential_id,
          publicKey: new Uint8Array(item.public_key),
          counter: +item.counter,
          transports: item.transports,
        },
        requireUserVerification: true,
      });
    if (!verification.verified)
      return res.status(401).json({ error: "Passkey verification failed" });
    await pool.query(
      "UPDATE diary_passkeys SET counter=$1,last_used_at=NOW() WHERE id=$2",
      [verification.authenticationInfo.newCounter, item.id],
    );
    await pool.query("DELETE FROM diary_auth_challenges WHERE token_hash=$1", [
      hash(req.body.challengeToken),
    ]);
    const userResult = await pool.query(
        "SELECT * FROM diary_users WHERE id=$1",
        [item.user_id],
      ),
      user = userResult.rows[0];
    await login(user, req, res, "passkey");
    const { password_hash, totp_secret, recovery_code_hashes, ...safeUser } =
      user;
    res.json(safeUser);
  } catch (error) {
    next(error);
  }
});
app.post("/api/security/2fa/setup", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT password_hash,two_factor_enabled FROM diary_users WHERE id=$1",
      [req.user.id],
    );
    if (!(await verify(String(req.body.password || ""), rows[0].password_hash)))
      return res.status(401).json({ error: "Current password is incorrect" });
    if (rows[0].two_factor_enabled)
      return res
        .status(409)
        .json({ error: "Two-factor authentication is already enabled" });
    const secret = base32Encode(crypto.randomBytes(20)),
      issuer = encodeURIComponent("Daymark"),
      account = encodeURIComponent(req.user.email),
      uri = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
      challenge = await authChallenge(req.user.id, "setup-2fa", {
        secret: encryptSecret(secret),
      });
    res.json({ challenge, secret, qr: await QRCode.toDataURL(uri), uri });
  } catch (error) {
    next(error);
  }
});
app.post("/api/security/2fa/confirm", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM diary_auth_challenges WHERE token_hash=$1 AND user_id=$2 AND type='setup-2fa' AND expires_at>NOW()",
      [hash(String(req.body.challenge || "")), req.user.id],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Setup challenge expired" });
    const encryptedSecret = rows[0].payload.secret,
      secret = decryptSecret(encryptedSecret);
    if (!verifyTotp(secret, req.body.code))
      return res.status(401).json({ error: "Invalid authenticator code" });
    const recoveryCodes = Array.from(
      { length: 10 },
      () =>
        `${base32Encode(crypto.randomBytes(5)).slice(0, 4)}-${base32Encode(crypto.randomBytes(5)).slice(0, 4)}`,
    );
    await pool.query(
      "UPDATE diary_users SET totp_secret=$1,two_factor_enabled=true,recovery_code_hashes=$2 WHERE id=$3",
      [
        encryptedSecret,
        JSON.stringify(recoveryCodes.map((code) => hash(code))),
        req.user.id,
      ],
    );
    await pool.query("DELETE FROM diary_auth_challenges WHERE token_hash=$1", [
      hash(req.body.challenge),
    ]);
    res.json({ enabled: true, recoveryCodes });
  } catch (error) {
    next(error);
  }
});
app.delete("/api/security/2fa", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT password_hash,totp_secret,two_factor_enabled FROM diary_users WHERE id=$1",
      [req.user.id],
    );
    if (!(await verify(String(req.body.password || ""), rows[0].password_hash)))
      return res.status(401).json({ error: "Current password is incorrect" });
    if (
      !rows[0].two_factor_enabled ||
      !verifyTotp(decryptSecret(rows[0].totp_secret), req.body.code)
    )
      return res.status(401).json({ error: "Invalid authenticator code" });
    await pool.query(
      "UPDATE diary_users SET totp_secret=NULL,two_factor_enabled=false,recovery_code_hashes='[]' WHERE id=$1",
      [req.user.id],
    );
    await pool.query("DELETE FROM diary_auth_challenges WHERE user_id=$1", [
      req.user.id,
    ]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/verification/resend", auth, async (req, res, next) => {
  try {
    if (req.user.email_verified_at) return res.status(204).end();
    await sendAccountToken(req, req.user, "verify");
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/verify/:token", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT * FROM diary_account_tokens WHERE token_hash=$1 AND type='verify' AND used_at IS NULL AND expires_at>NOW() FOR UPDATE",
      [hash(req.params.token)],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "Verification link is invalid or expired" });
    }
    await client.query(
      "UPDATE diary_users SET email_verified_at=NOW() WHERE id=$1",
      [rows[0].user_id],
    );
    await client.query(
      "UPDATE diary_account_tokens SET used_at=NOW() WHERE id=$1",
      [rows[0].id],
    );
    await client.query("COMMIT");
    res.json({ verified: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});
app.post("/api/auth/password/request", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id,email,display_name FROM diary_users WHERE email=lower($1)",
      [String(req.body.email || "")],
    );
    if (rows[0])
      await sendAccountToken(req, rows[0], "reset").catch(console.error);
    res.json({ message: "If that address exists, a reset link has been sent" });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/password/reset/:token", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const pass = String(req.body.password || "");
    if (pass.length < 10)
      return res
        .status(400)
        .json({ error: "Password needs at least 10 characters" });
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT * FROM diary_account_tokens WHERE token_hash=$1 AND type='reset' AND used_at IS NULL AND expires_at>NOW() FOR UPDATE",
      [hash(req.params.token)],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "Reset link is invalid or expired" });
    }
    await client.query("UPDATE diary_users SET password_hash=$1 WHERE id=$2", [
      await password(pass),
      rows[0].user_id,
    ]);
    await client.query(
      "UPDATE diary_account_tokens SET used_at=NOW() WHERE id=$1",
      [rows[0].id],
    );
    await client.query("DELETE FROM diary_sessions WHERE user_id=$1", [
      rows[0].user_id,
    ]);
    await client.query("COMMIT");
    res.json({ reset: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});
function admin(req, res, next) {
  return req.user.is_admin
    ? next()
    : res.status(403).json({ error: "Administrator required" });
}
async function auditAdmin(
  req,
  action,
  targetType = "",
  targetId = "",
  details = {},
  executor = pool,
) {
  await executor.query(
    "INSERT INTO diary_admin_audit(admin_id,action,target_type,target_id,details,ip_address) VALUES($1,$2,$3,$4,$5,$6)",
    [
      req.user.id,
      action,
      targetType,
      String(targetId || ""),
      JSON.stringify(details),
      req.ip || "",
    ],
  );
}
async function backupInventory() {
  await mkdir(backupPath, { recursive: true });
  const files = await readdir(backupPath),
    backups = new Map();
  for (const name of files) {
    const match = name.match(/^(diary|media)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)\.(dump|tar\.gz)$/);
    if (!match) continue;
    const [, type, stamp] = match,
      information = await stat(path.join(backupPath, name)),
      item = backups.get(stamp) || {
        stamp,
        createdAt: information.mtime.toISOString(),
        database: null,
        media: null,
      };
    item[type === "diary" ? "database" : "media"] = {
      name,
      bytes: information.size,
    };
    if (information.mtime.toISOString() < item.createdAt)
      item.createdAt = information.mtime.toISOString();
    backups.set(stamp, item);
  }
  return [...backups.values()]
    .map((item) => ({
      ...item,
      complete: !!item.database && !!item.media,
      bytes: (item.database?.bytes || 0) + (item.media?.bytes || 0),
    }))
    .sort((a, b) => b.stamp.localeCompare(a.stamp));
}
app.get("/api/admin/backups", auth, admin, async (_req, res, next) => {
  try {
    res.json({ running: backupRunning, backups: await backupInventory() });
  } catch (error) {
    next(error);
  }
});
app.post("/api/admin/backups", auth, admin, async (req, res, next) => {
  if (backupRunning)
    return res.status(409).json({ error: "A backup is already running" });
  backupRunning = true;
  const stamp = new Date().toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z"),
    databaseFile = path.join(backupPath, `diary-${stamp}.dump`),
    mediaFile = path.join(backupPath, `media-${stamp}.tar.gz`);
  try {
    await mkdir(backupPath, { recursive: true });
    const pgEnvironment = {
      ...process.env,
      PGHOST: process.env.DB_HOST || "database",
      PGPORT: process.env.DB_PORT || "5432",
      PGDATABASE: process.env.DB_NAME || "diary",
      PGUSER: process.env.DB_USER || "diary_user",
      PGPASSWORD: process.env.DB_PASSWORD || "",
    };
    await runFile("pg_dump", ["--format=custom", "--file", databaseFile], {
      env: pgEnvironment,
      timeout: 30 * 60 * 1000,
    });
    await runFile("tar", ["-czf", mediaFile, "-C", "/minio-data", "."], {
      timeout: 30 * 60 * 1000,
    });
    await auditAdmin(req, "backup.created", "backup", stamp);
    const backups = await backupInventory();
    res.status(201).json(backups.find((item) => item.stamp === stamp));
  } catch (error) {
    await Promise.all([
      unlink(databaseFile).catch(() => {}),
      unlink(mediaFile).catch(() => {}),
    ]);
    next(error);
  } finally {
    backupRunning = false;
  }
});
app.get(
  "/api/admin/backups/:stamp/:type",
  auth,
  admin,
  async (req, res, next) => {
    try {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/.test(req.params.stamp))
        return res.status(400).json({ error: "Invalid backup timestamp" });
      const fileName =
        req.params.type === "database"
          ? `diary-${req.params.stamp}.dump`
          : req.params.type === "media"
            ? `media-${req.params.stamp}.tar.gz`
            : null;
      if (!fileName)
        return res.status(400).json({ error: "Invalid backup type" });
      res.download(path.join(backupPath, fileName), fileName);
    } catch (error) {
      next(error);
    }
  },
);
app.delete("/api/admin/backups/:stamp", auth, admin, async (req, res, next) => {
  try {
    const { stamp } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/.test(stamp))
      return res.status(400).json({ error: "Invalid backup timestamp" });
    let deleted = 0;
    for (const name of [`diary-${stamp}.dump`, `media-${stamp}.tar.gz`]) {
      try {
        await unlink(path.join(backupPath, name));
        deleted += 1;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!deleted) return res.status(404).json({ error: "Backup not found" });
    await auditAdmin(req, "backup.deleted", "backup", stamp, { files: deleted });
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});
app.get("/api/admin/moderation", auth, admin, async (_req, res, next) => {
  try {
    const comments = await pool.query(
        `SELECT c.id,c.entry_id,c.parent_id,c.body,c.created_at,c.updated_at,u.id AS user_id,u.display_name,u.username,e.title AS entry_title,j.name AS journal_name FROM diary_comments c JOIN diary_users u ON u.id=c.user_id JOIN diary_entries e ON e.id=c.entry_id JOIN diary_journals j ON j.id=e.journal_id WHERE c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 200`,
      ),
      links = await pool.query(
        `SELECT l.id,l.entry_id,l.expires_at,l.revoked_at,l.view_count,l.created_at,l.last_viewed_at,(l.password_hash IS NOT NULL) AS password_protected,e.title AS entry_title,u.display_name,u.username FROM diary_public_links l JOIN diary_entries e ON e.id=l.entry_id LEFT JOIN diary_users u ON u.id=l.created_by ORDER BY l.created_at DESC LIMIT 200`,
      );
    res.json({ comments: comments.rows, links: links.rows });
  } catch (error) {
    next(error);
  }
});
app.delete(
  "/api/admin/moderation/comments/:id",
  auth,
  admin,
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        "DELETE FROM diary_comments WHERE id=$1 RETURNING id,entry_id,user_id,left(body,160) AS excerpt",
        [+req.params.id],
      );
      if (!rows[0]) return res.status(404).json({ error: "Comment not found" });
      await auditAdmin(req, "moderation.comment_deleted", "comment", rows[0].id, {
        entryId: rows[0].entry_id,
        userId: rows[0].user_id,
        excerpt: rows[0].excerpt,
      });
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  },
);
app.delete(
  "/api/admin/moderation/public-links/:id",
  auth,
  admin,
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        "UPDATE diary_public_links SET revoked_at=COALESCE(revoked_at,NOW()) WHERE id=$1 RETURNING id,entry_id,view_count",
        [+req.params.id],
      );
      if (!rows[0])
        return res.status(404).json({ error: "Public link not found" });
      await auditAdmin(
        req,
        "moderation.public_link_revoked",
        "public_link",
        rows[0].id,
        { entryId: rows[0].entry_id, views: rows[0].view_count },
      );
      res.json({ revoked: true });
    } catch (error) {
      next(error);
    }
  },
);
app.post("/api/admin/reports/:format", auth, admin, async (req, res, next) => {
  try {
    const format = req.params.format,
      days = Math.min(365, Math.max(7, Math.round(Number(req.query.days) || 30)));
    if (!['csv', 'pdf'].includes(format))
      return res.status(400).json({ error: "Report format must be CSV or PDF" });
    const totals = await pool.query(
        `SELECT (SELECT count(*) FROM diary_users)::int AS users,(SELECT count(*) FROM diary_users WHERE disabled_at IS NULL)::int AS active_users,(SELECT count(*) FROM diary_entries WHERE deleted_at IS NULL)::int AS entries,(SELECT count(*) FROM diary_journals)::int AS journals,(SELECT count(*) FROM diary_comments)::int AS comments,(SELECT count(*) FROM diary_public_links WHERE revoked_at IS NULL AND expires_at>NOW())::int AS active_public_links,(SELECT count(*) FROM diary_login_history WHERE NOT success AND created_at>NOW()-INTERVAL '24 hours')::int AS failed_logins_24h`,
      ),
      daily = await pool.query(
        `WITH days AS (SELECT generate_series(CURRENT_DATE-($1::int-1),CURRENT_DATE,INTERVAL '1 day')::date AS day) SELECT day::text AS date,(SELECT count(*) FROM diary_entries WHERE created_at>=day AND created_at<day+1)::int AS entries,(SELECT count(*) FROM diary_comments WHERE created_at>=day AND created_at<day+1)::int AS comments,(SELECT count(*) FROM diary_users WHERE created_at>=day AND created_at<day+1)::int AS users,(SELECT count(*) FROM diary_login_history WHERE success AND created_at>=day AND created_at<day+1)::int AS successful_logins,(SELECT count(*) FROM diary_login_history WHERE NOT success AND created_at>=day AND created_at<day+1)::int AS failed_logins FROM days ORDER BY day`,
        [days],
      ),
      users = await pool.query(
        `SELECT u.display_name,u.username,u.email,u.is_admin,(u.disabled_at IS NOT NULL) AS disabled,count(DISTINCT e.id) FILTER (WHERE e.deleted_at IS NULL)::int AS entries,COALESCE(u.storage_quota,$1)::bigint AS storage_quota,(SELECT COALESCE(sum(CASE WHEN item->>'size' ~ '^[0-9]+$' THEN (item->>'size')::bigint ELSE 0 END),0)::bigint FROM diary_entries se CROSS JOIN LATERAL jsonb_array_elements(COALESCE(se.media,'[]'::jsonb)) item WHERE se.user_id=u.id AND se.deleted_at IS NULL) AS storage_used FROM diary_users u LEFT JOIN diary_entries e ON e.user_id=u.id GROUP BY u.id ORDER BY entries DESC,u.display_name`,
        [storageQuota],
      ),
      visibility = await pool.query(
        `SELECT visibility,count(*)::int AS count FROM diary_entries WHERE deleted_at IS NULL GROUP BY visibility ORDER BY count DESC`,
      ),
      audit = await pool.query(
        `SELECT a.action,a.target_type,a.target_id,a.created_at,u.display_name,u.username FROM diary_admin_audit a LEFT JOIN diary_users u ON u.id=a.admin_id ORDER BY a.created_at DESC LIMIT 50`,
      ),
      generatedAt = new Date(),
      fileDate = generatedAt.toISOString().slice(0, 10),
      byteLabel = (value) => {
        const bytes = +value || 0;
        if (!bytes) return "0 B";
        const unit = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
        return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
      };
    await auditAdmin(req, "analytics.report_generated", "report", format, {
      days,
    });
    if (format === "csv") {
      const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`,
        rows = [["section", "date", "metric", "value", "details"]];
      for (const [metric, value] of Object.entries(totals.rows[0]))
        rows.push(["summary", generatedAt.toISOString(), metric, value, ""]);
      for (const item of daily.rows)
        for (const metric of ["entries", "comments", "users", "successful_logins", "failed_logins"])
          rows.push(["daily", item.date, metric, item[metric], `${days}-day range`]);
      for (const item of visibility.rows)
        rows.push(["visibility", generatedAt.toISOString(), item.visibility, item.count, "entries"]);
      for (const item of users.rows)
        rows.push(["user", generatedAt.toISOString(), item.username, item.entries, `${item.display_name}; ${item.email}; storage ${byteLabel(item.storage_used)} / ${byteLabel(item.storage_quota)}; admin ${item.is_admin}; disabled ${item.disabled}`]);
      for (const item of audit.rows)
        rows.push(["audit", item.created_at, item.action, item.target_id, `${item.display_name || "deleted administrator"}; ${item.target_type}`]);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=diary-admin-report-${fileDate}.csv`);
      return res.send(`\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\n")}`);
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=diary-admin-report-${fileDate}.pdf`);
    const doc = new PDFDocument({ margin: 48, size: "A4", bufferPages: true });
    doc.pipe(res);
    const heading = (title) => {
        if (doc.y > 700) doc.addPage();
        doc.moveDown(0.7).fontSize(13).fillColor("#1f3a5f").text(title).moveDown(0.35);
      },
      line = (label, value, detail = "") => {
        if (doc.y > 750) doc.addPage();
        doc.fontSize(8).fillColor("#111827").text(`${label}: ${value}`, { continued: !!detail });
        if (detail) doc.fillColor("#6b7280").text(`  ${detail}`);
      };
    doc.fontSize(22).fillColor("#111827").text("Daymark", { align: "left" });
    doc.fontSize(11).fillColor("#4b5563").text("Administrator analytics report");
    doc.fontSize(8).text(`Generated ${generatedAt.toLocaleString("en-GB")} · Reporting period ${days} days`);
    heading("Site summary");
    for (const [metric, value] of Object.entries(totals.rows[0]))
      line(metric.replaceAll("_", " ").toUpperCase(), value);
    heading("Daily activity");
    for (const item of daily.rows)
      line(item.date, `${item.entries} entries · ${item.comments} comments · ${item.users} users`, `${item.successful_logins} successful / ${item.failed_logins} failed logins`);
    heading("Entry visibility");
    for (const item of visibility.rows) line(item.visibility.toUpperCase(), item.count);
    heading("Users and storage");
    for (const item of users.rows)
      line(`${item.display_name} (@${item.username})`, `${item.entries} entries`, `${byteLabel(item.storage_used)} / ${byteLabel(item.storage_quota)} · ${item.is_admin ? "admin" : "user"}${item.disabled ? " · disabled" : ""}`);
    heading("Recent administrator activity");
    for (const item of audit.rows)
      line(new Date(item.created_at).toLocaleString("en-GB"), item.action, `${item.display_name || "deleted administrator"} · ${item.target_type}${item.target_id ? ` #${item.target_id}` : ""}`);
    doc.end();
  } catch (error) {
    next(error);
  }
});
app.get("/api/site-settings", async (_req, res, next) => {
  try {
    const status = await maintenanceStatus(),
      { rows } = await pool.query(
        "SELECT site_name,site_tagline,site_notice,footer_text FROM diary_site_settings WHERE id=true",
      );
    res.json({ ...rows[0], ...status });
  } catch (error) {
    next(error);
  }
});
app.get("/api/authors/:username", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id,username,display_name,bio,preferences,created_at FROM diary_users WHERE username=lower($1) AND disabled_at IS NULL",
      [req.params.username],
    );
    const author = rows[0], preferences = { ...defaultUserPreferences, ...(author?.preferences || {}) };
    if (!author || preferences.profileVisibility !== "public")
      return res.status(404).json({ error: "Public profile not found" });
    const entries = await pool.query(
      "SELECT e.*,u.display_name FROM diary_entries e JOIN diary_users u ON u.id=e.user_id WHERE e.user_id=$1 AND e.visibility='public' AND e.deleted_at IS NULL AND NOT e.is_encrypted ORDER BY e.entry_date DESC,e.created_at DESC LIMIT 100",
      [author.id],
    );
    res.json({
      profile: { username: author.username, displayName: author.display_name, bio: author.bio, joinedAt: author.created_at, avatarUrl: preferences.avatarUrl?.startsWith("/api/media/") ? `/api/authors/${author.username}/avatar` : preferences.avatarUrl, pronouns: preferences.pronouns, personalWebsite: preferences.personalWebsite },
      entries: entries.rows.map((item) => ({ ...entry(item), media: [] })),
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/authors/:username/avatar", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id,preferences FROM diary_users WHERE username=lower($1) AND disabled_at IS NULL", [req.params.username]),
      user = rows[0], preferences = { ...defaultUserPreferences, ...(user?.preferences || {}) };
    if (!user || preferences.profileVisibility !== "public" || !preferences.avatarUrl?.startsWith("/api/media/")) return res.status(404).end();
    const key = decodeURIComponent(preferences.avatarUrl.slice("/api/media/".length));
    if (!key.startsWith(`${user.id}/`)) return res.status(403).end();
    const stat = await mediaStore.statObject(mediaBucket, key);
    res.setHeader("Content-Type", stat.metaData["content-type"] || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
    (await mediaStore.getObject(mediaBucket, key)).pipe(res);
  } catch (error) {
    if (error.code === "NoSuchKey" || error.code === "NotFound") return res.status(404).end();
    next(error);
  }
});
app.get("/api/admin", auth, admin, async (_req, res, next) => {
  try {
    const users = await pool.query(
        `SELECT u.id,u.username,u.email,u.display_name,u.bio,u.is_admin,u.disabled_at,u.email_verified_at,u.created_at,COALESCE(u.storage_quota,$1)::bigint AS storage_quota,(SELECT COALESCE(sum(CASE WHEN item->>'size' ~ '^[0-9]+$' THEN (item->>'size')::bigint ELSE 0 END),0)::bigint FROM diary_entries se CROSS JOIN LATERAL jsonb_array_elements(COALESCE(se.media,'[]'::jsonb)) item WHERE se.user_id=u.id AND se.deleted_at IS NULL) AS storage_used,count(DISTINCT e.id) FILTER (WHERE e.deleted_at IS NULL) AS entry_count,max(h.created_at) FILTER (WHERE h.success) AS last_login FROM diary_users u LEFT JOIN diary_entries e ON e.user_id=u.id LEFT JOIN diary_login_history h ON h.user_id=u.id GROUP BY u.id ORDER BY u.created_at`,
        [storageQuota],
      ),
      settings = await pool.query(
        "SELECT registration_mode,site_name,site_tagline,site_notice,footer_text,alert_memory_percent,alert_db_connections_percent,alert_failed_logins,alert_backup_hours,alert_storage_percent,maintenance_enabled,maintenance_starts_at,maintenance_ends_at,maintenance_message FROM diary_site_settings WHERE id=true",
      ),
      totals = await pool.query(
        "SELECT (SELECT count(*) FROM diary_users)::int AS users,(SELECT count(*) FROM diary_users WHERE disabled_at IS NULL)::int AS active_users,(SELECT count(*) FROM diary_entries WHERE deleted_at IS NULL)::int AS entries,(SELECT count(*) FROM diary_entries WHERE deleted_at IS NOT NULL)::int AS trashed_entries,(SELECT count(*) FROM diary_journals)::int AS journals,(SELECT count(*) FROM diary_comments)::int AS comments,(SELECT count(*) FROM diary_sessions WHERE expires_at>NOW())::int AS active_sessions,(SELECT count(*) FROM diary_login_history WHERE NOT success AND created_at>NOW()-INTERVAL '24 hours')::int AS failed_logins_24h",
      ),
      invitations = await pool.query(
        "SELECT i.id,i.max_uses,i.use_count,i.expires_at,i.created_at,u.display_name AS created_by_name FROM diary_registration_invites i LEFT JOIN diary_users u ON u.id=i.created_by ORDER BY i.created_at DESC LIMIT 100",
      ),
      loginActivity = await pool.query(
        "SELECT h.id,h.identifier,h.success,h.method,h.ip_address,h.created_at,u.display_name,u.username FROM diary_login_history h LEFT JOIN diary_users u ON u.id=h.user_id ORDER BY h.created_at DESC LIMIT 50",
      ),
      media = await pool.query(
        `SELECT count(*)::int AS files,COALESCE(sum(CASE WHEN item->>'size' ~ '^[0-9]+$' THEN (item->>'size')::bigint ELSE 0 END),0)::bigint AS bytes FROM diary_entries e CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.media,'[]'::jsonb)) item WHERE e.deleted_at IS NULL`,
      ),
      system = await pool.query(
        "SELECT current_database() AS database,current_setting('server_version') AS database_version,NOW() AS server_time,pg_database_size(current_database())::bigint AS database_bytes,(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS connections,current_setting('max_connections')::int AS max_connections",
      ),
      tableSizes = await pool.query(
        `SELECT relname AS name,pg_total_relation_size(relid)::bigint AS bytes,n_live_tup::bigint AS rows FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12`,
      ),
      dailyActivity = await pool.query(
        `WITH days AS (SELECT generate_series(CURRENT_DATE-29,CURRENT_DATE,INTERVAL '1 day')::date AS day) SELECT day::text AS date,(SELECT count(*) FROM diary_entries WHERE created_at>=day AND created_at<day+1)::int AS entries,(SELECT count(*) FROM diary_comments WHERE created_at>=day AND created_at<day+1)::int AS comments,(SELECT count(*) FROM diary_users WHERE created_at>=day AND created_at<day+1)::int AS users,(SELECT count(*) FROM diary_login_history WHERE success AND created_at>=day AND created_at<day+1)::int AS successful_logins,(SELECT count(*) FROM diary_login_history WHERE NOT success AND created_at>=day AND created_at<day+1)::int AS failed_logins FROM days ORDER BY day`,
      ),
      visibility = await pool.query(
        `SELECT visibility,count(*)::int AS count FROM diary_entries WHERE deleted_at IS NULL GROUP BY visibility ORDER BY count DESC`,
      ),
      contributors = await pool.query(
        `SELECT u.id,u.display_name,u.username,count(DISTINCT e.id)::int AS entries,count(DISTINCT c.id)::int AS comments FROM diary_users u LEFT JOIN diary_entries e ON e.user_id=u.id AND e.deleted_at IS NULL LEFT JOIN diary_comments c ON c.user_id=u.id GROUP BY u.id ORDER BY count(DISTINCT e.id) DESC,count(DISTINCT c.id) DESC LIMIT 8`,
      ),
      adminAudit = await pool.query(
        `SELECT a.id,a.action,a.target_type,a.target_id,a.details,a.ip_address,a.created_at,u.display_name,u.username FROM diary_admin_audit a LEFT JOIN diary_users u ON u.id=a.admin_id ORDER BY a.created_at DESC LIMIT 100`,
      );
    const alertSettings = settings.rows[0],
      hostMemoryPercent =
        ((os.totalmem() - os.freemem()) / Math.max(1, os.totalmem())) * 100,
      connectionPercent =
        (+system.rows[0].connections / Math.max(1, +system.rows[0].max_connections)) *
        100,
      backupItems = await backupInventory().catch(() => []),
      latestCompleteBackup = backupItems.find((item) => item.complete),
      backupAgeHours = latestCompleteBackup
        ? (Date.now() - new Date(latestCompleteBackup.createdAt).getTime()) / 3600000
        : Infinity,
      alerts = [];
    if (hostMemoryPercent >= alertSettings.alert_memory_percent)
      alerts.push({
        id: "memory",
        severity: "warning",
        title: "High host memory usage",
        detail: `${hostMemoryPercent.toFixed(1)}% used; threshold ${alertSettings.alert_memory_percent}%`,
      });
    if (connectionPercent >= alertSettings.alert_db_connections_percent)
      alerts.push({
        id: "database-connections",
        severity: "warning",
        title: "High database connection usage",
        detail: `${connectionPercent.toFixed(1)}% used; threshold ${alertSettings.alert_db_connections_percent}%`,
      });
    if (+totals.rows[0].failed_logins_24h >= alertSettings.alert_failed_logins)
      alerts.push({
        id: "failed-logins",
        severity: "critical",
        title: "Elevated failed sign-ins",
        detail: `${totals.rows[0].failed_logins_24h} failures in 24 hours; threshold ${alertSettings.alert_failed_logins}`,
      });
    if (backupAgeHours >= alertSettings.alert_backup_hours)
      alerts.push({
        id: "backup-age",
        severity: "critical",
        title: latestCompleteBackup ? "Backup is overdue" : "No complete backup found",
        detail: latestCompleteBackup
          ? `${backupAgeHours.toFixed(1)} hours since the latest complete backup`
          : "Create a complete database and media backup",
      });
    for (const item of users.rows) {
      const percent = (+item.storage_used / Math.max(1, +item.storage_quota || storageQuota)) * 100;
      if (percent >= alertSettings.alert_storage_percent)
        alerts.push({
          id: `storage-${item.id}`,
          severity: percent >= 100 ? "critical" : "warning",
          title: `${item.display_name} storage ${percent >= 100 ? "exceeded" : "nearly full"}`,
          detail: `${percent.toFixed(1)}% of the account quota is used`,
          userId: +item.id,
        });
    }
    for (const item of backupItems.filter((backup) => !backup.complete).slice(0, 5))
      alerts.push({
        id: `backup-incomplete-${item.stamp}`,
        severity: "warning",
        title: "Incomplete backup pair",
        detail: `${item.stamp} is missing ${item.database ? "media" : "database"}`,
      });
    res.json({
      settings: settings.rows[0],
      totals: totals.rows[0],
      users: users.rows.map((user) => ({
        ...user,
        id: +user.id,
        entry_count: +user.entry_count,
        storage_quota: +user.storage_quota,
        storage_used: +user.storage_used,
      })),
      invitations: invitations.rows,
      loginActivity: loginActivity.rows,
      media: { files: +media.rows[0].files, bytes: +media.rows[0].bytes },
      analytics: {
        daily: dailyActivity.rows,
        visibility: visibility.rows,
        contributors: contributors.rows,
      },
      adminAudit: adminAudit.rows,
      alerts,
      system: {
        ...system.rows[0],
        database_bytes: +system.rows[0].database_bytes,
        tables: tableSizes.rows.map((table) => ({
          ...table,
          bytes: +table.bytes,
          rows: +table.rows,
        })),
        host: {
          hostname: os.hostname(),
          platform: `${os.platform()} ${os.release()} (${os.arch()})`,
          cpu_model: os.cpus()[0]?.model || "Unknown",
          cpu_cores: os.cpus().length,
          load: os.loadavg(),
          total_memory: os.totalmem(),
          free_memory: os.freemem(),
          system_uptime: os.uptime(),
          process_uptime: process.uptime(),
          process_memory: process.memoryUsage().rss,
          node_version: process.version,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});
app.put("/api/admin/settings", auth, admin, async (req, res, next) => {
  try {
    const mode = ["open", "invite", "closed"].includes(
      req.body.registrationMode,
    )
      ? req.body.registrationMode
      : null;
    if (!mode)
      return res.status(400).json({ error: "Invalid registration mode" });
    await pool.query(
      "UPDATE diary_site_settings SET registration_mode=$1,updated_at=NOW() WHERE id=true",
      [mode],
    );
    await auditAdmin(req, "registration.mode_changed", "site", "settings", {
      mode,
    });
    res.json({ registrationMode: mode });
  } catch (error) {
    next(error);
  }
});
app.put("/api/admin/site-settings", auth, admin, async (req, res, next) => {
  try {
    const siteName = String(req.body.siteName || "").trim().slice(0, 80),
      siteTagline = String(req.body.siteTagline || "").trim().slice(0, 240),
      siteNotice = String(req.body.siteNotice || "").trim().slice(0, 160),
      footerText = String(req.body.footerText || "").trim().slice(0, 160);
    if (!siteName || !siteTagline)
      return res
        .status(400)
        .json({ error: "Site name and description are required" });
    const { rows } = await pool.query(
      `UPDATE diary_site_settings SET site_name=$1,site_tagline=$2,site_notice=$3,footer_text=$4,updated_at=NOW() WHERE id=true RETURNING site_name,site_tagline,site_notice,footer_text`,
      [siteName, siteTagline, siteNotice, footerText],
    );
    await auditAdmin(req, "website.settings_updated", "site", "settings", {
      siteName,
    });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});
app.put("/api/admin/alert-settings", auth, admin, async (req, res, next) => {
  try {
    const values = {
      memory: Math.round(Number(req.body.memory)),
      connections: Math.round(Number(req.body.connections)),
      failedLogins: Math.round(Number(req.body.failedLogins)),
      backupHours: Math.round(Number(req.body.backupHours)),
      storage: Math.round(Number(req.body.storage)),
    };
    if (
      !Number.isFinite(values.memory) ||
      values.memory < 10 ||
      values.memory > 100 ||
      !Number.isFinite(values.connections) ||
      values.connections < 10 ||
      values.connections > 100 ||
      !Number.isFinite(values.failedLogins) ||
      values.failedLogins < 1 ||
      values.failedLogins > 10000 ||
      !Number.isFinite(values.backupHours) ||
      values.backupHours < 1 ||
      values.backupHours > 720 ||
      !Number.isFinite(values.storage) ||
      values.storage < 10 ||
      values.storage > 100
    )
      return res.status(400).json({ error: "Invalid alert thresholds" });
    await pool.query(
      `UPDATE diary_site_settings SET alert_memory_percent=$1,alert_db_connections_percent=$2,alert_failed_logins=$3,alert_backup_hours=$4,alert_storage_percent=$5,updated_at=NOW() WHERE id=true`,
      [
        values.memory,
        values.connections,
        values.failedLogins,
        values.backupHours,
        values.storage,
      ],
    );
    await auditAdmin(req, "alerts.thresholds_updated", "site", "settings", values);
    res.json(values);
  } catch (error) {
    next(error);
  }
});
app.put("/api/admin/maintenance", auth, admin, async (req, res, next) => {
  try {
    const enabled = !!req.body.enabled,
      startsAt = req.body.startsAt ? new Date(req.body.startsAt) : null,
      endsAt = req.body.endsAt ? new Date(req.body.endsAt) : null,
      message = String(req.body.message || "").trim().slice(0, 500);
    if (
      (startsAt && Number.isNaN(startsAt.getTime())) ||
      (endsAt && Number.isNaN(endsAt.getTime())) ||
      (startsAt && endsAt && endsAt <= startsAt) ||
      !message
    )
      return res.status(400).json({
        error: "Use a valid maintenance schedule and message",
      });
    const { rows } = await pool.query(
      `UPDATE diary_site_settings SET maintenance_enabled=$1,maintenance_starts_at=$2,maintenance_ends_at=$3,maintenance_message=$4,updated_at=NOW() WHERE id=true RETURNING maintenance_enabled,maintenance_starts_at,maintenance_ends_at,maintenance_message`,
      [enabled, startsAt, endsAt, message],
    );
    maintenanceCache = { expires: 0, value: null };
    await auditAdmin(req, "maintenance.schedule_updated", "site", "maintenance", {
      enabled,
      startsAt,
      endsAt,
    });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});
app.post("/api/admin/users", auth, admin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const username = String(req.body.username || "").trim(),
      email = String(req.body.email || "").trim(),
      displayName = String(req.body.displayName || "").trim(),
      pass = String(req.body.password || ""),
      quotaGb = Number(req.body.storageQuotaGb || 0),
      quotaBytes = quotaGb > 0 ? Math.round(quotaGb * 1024 ** 3) : null;
    if (
      !/^[a-z0-9_-]{3,30}$/i.test(username) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      pass.length < 10 ||
      (req.body.storageQuotaGb &&
        (!Number.isFinite(quotaGb) || quotaGb < 0.1 || quotaGb > 1024))
    )
      return res.status(400).json({
        error:
          "Use a valid username, email, and password of at least 10 characters",
      });
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO diary_users(username,email,password_hash,display_name,bio,is_admin,email_verified_at,disabled_at,storage_quota) VALUES(lower($1),lower($2),$3,$4,$5,$6,CASE WHEN $7 THEN NOW() ELSE NULL END,CASE WHEN $8 THEN NOW() ELSE NULL END,$9) RETURNING id,username,email,display_name`,
      [
        username,
        email,
        await password(pass),
        displayName || username,
        String(req.body.bio || "").slice(0, 2000),
        !!req.body.isAdmin,
        !!req.body.verified,
        !!req.body.disabled,
        quotaBytes,
      ],
    );
    await client.query(
      "INSERT INTO diary_journals(owner_id,name,is_default) VALUES($1,'Field Notes',true)",
      [rows[0].id],
    );
    await auditAdmin(
      req,
      "user.created",
      "user",
      rows[0].id,
      { username: rows[0].username, email: rows[0].email },
      client,
    );
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505")
      return res.status(409).json({ error: "Username or email already exists" });
    next(error);
  } finally {
    client.release();
  }
});
app.put("/api/admin/users/:id/details", auth, admin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const targetId = +req.params.id,
      username = String(req.body.username || "").trim(),
      email = String(req.body.email || "").trim(),
      displayName = String(req.body.displayName || "").trim(),
      pass = String(req.body.password || ""),
      quotaGb = Number(req.body.storageQuotaGb || 0),
      quotaBytes = quotaGb > 0 ? Math.round(quotaGb * 1024 ** 3) : storageQuota;
    if (
      !/^[a-z0-9_-]{3,30}$/i.test(username) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !displayName ||
      (pass && pass.length < 10) ||
      !Number.isFinite(quotaGb) ||
      quotaGb < 0.1 ||
      quotaGb > 1024
    )
      return res.status(400).json({ error: "Invalid account details" });
    if (
      targetId === +req.user.id &&
      (req.body.disabled || req.body.isAdmin === false)
    )
      return res.status(400).json({
        error: "You cannot disable or demote your own active account",
      });
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT is_admin FROM diary_users WHERE id=$1 FOR UPDATE",
      [targetId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }
    if (current.rows[0].is_admin && req.body.isAdmin === false) {
      const admins = await client.query(
        "SELECT count(*)::int AS count FROM diary_users WHERE is_admin AND disabled_at IS NULL",
      );
      if (admins.rows[0].count <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "At least one active administrator is required",
        });
      }
    }
    await client.query(
      `UPDATE diary_users SET username=lower($1),email=lower($2),display_name=$3,bio=$4,is_admin=$5,email_verified_at=CASE WHEN $6 THEN COALESCE(email_verified_at,NOW()) ELSE NULL END,disabled_at=CASE WHEN $7 THEN COALESCE(disabled_at,NOW()) ELSE NULL END,password_hash=CASE WHEN $8='' THEN password_hash ELSE $9 END,storage_quota=$10 WHERE id=$11`,
      [
        username,
        email,
        displayName,
        String(req.body.bio || "").slice(0, 2000),
        !!req.body.isAdmin,
        !!req.body.verified,
        !!req.body.disabled,
        pass,
        pass ? await password(pass) : "",
        quotaBytes,
        targetId,
      ],
    );
    if (req.body.disabled || pass)
      await client.query("DELETE FROM diary_sessions WHERE user_id=$1", [
        targetId,
      ]);
    await auditAdmin(
      req,
      "user.details_updated",
      "user",
      targetId,
      {
        username,
        email,
        isAdmin: !!req.body.isAdmin,
        verified: !!req.body.verified,
        disabled: !!req.body.disabled,
        passwordReset: !!pass,
        storageQuota: quotaBytes,
      },
      client,
    );
    await client.query("COMMIT");
    res.json({ updated: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505")
      return res.status(409).json({ error: "Username or email already exists" });
    next(error);
  } finally {
    client.release();
  }
});
app.delete("/api/admin/users/:id", auth, admin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const targetId = +req.params.id;
    if (targetId === +req.user.id)
      return res.status(400).json({ error: "You cannot delete yourself" });
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT is_admin FROM diary_users WHERE id=$1 FOR UPDATE",
      [targetId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }
    if (current.rows[0].is_admin) {
      const admins = await client.query(
        "SELECT count(*)::int AS count FROM diary_users WHERE is_admin AND disabled_at IS NULL",
      );
      if (admins.rows[0].count <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "The last administrator cannot be deleted" });
      }
    }
    await client.query(
      "DELETE FROM diary_entries WHERE user_id=$1 OR journal_id IN (SELECT id FROM diary_journals WHERE owner_id=$1)",
      [targetId],
    );
    await auditAdmin(req, "user.deleted", "user", targetId, {}, client);
    await client.query("DELETE FROM diary_users WHERE id=$1", [targetId]);
    await client.query("COMMIT");
    const keys = [];
    for await (const object of mediaStore.listObjectsV2(
      mediaBucket,
      `${targetId}/`,
      true,
    ))
      keys.push(object.name);
    if (keys.length) await mediaStore.removeObjects(mediaBucket, keys);
    res.json({ deleted: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});
app.post(
  "/api/admin/registration-invites",
  auth,
  admin,
  async (req, res, next) => {
    try {
      const code = base32Encode(crypto.randomBytes(10)),
        days = Math.min(90, Math.max(1, +(req.body.days || 7))),
        uses = Math.min(100, Math.max(1, +(req.body.maxUses || 1))),
        { rows } = await pool.query(
          "INSERT INTO diary_registration_invites(code_hash,created_by,max_uses,expires_at) VALUES($1,$2,$3,NOW()+($4||' days')::interval) RETURNING id,max_uses,expires_at",
          [hash(code), req.user.id, uses, days],
        );
      await auditAdmin(
        req,
        "registration.code_created",
        "registration_invite",
        rows[0].id,
        { maxUses: uses, days },
      );
      res.status(201).json({ ...rows[0], code });
    } catch (error) {
      next(error);
    }
  },
);
app.delete(
  "/api/admin/registration-invites/:id",
  auth,
  admin,
  async (req, res, next) => {
    try {
      const { rowCount } = await pool.query(
        "DELETE FROM diary_registration_invites WHERE id=$1",
        [+req.params.id],
      );
      if (!rowCount)
        return res.status(404).json({ error: "Registration code not found" });
      await auditAdmin(
        req,
        "registration.code_revoked",
        "registration_invite",
        req.params.id,
      );
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  },
);
app.delete(
  "/api/admin/users/:id/sessions",
  auth,
  admin,
  async (req, res, next) => {
    try {
      const targetId = +req.params.id;
      if (!targetId)
        return res.status(400).json({ error: "Invalid user" });
      const { rowCount } = await pool.query(
        "DELETE FROM diary_sessions WHERE user_id=$1",
        [targetId],
      );
      await auditAdmin(req, "user.sessions_revoked", "user", targetId, {
        sessions: rowCount,
      });
      res.json({ revoked: rowCount });
    } catch (error) {
      next(error);
    }
  },
);
app.put("/api/admin/users/:id", auth, admin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const targetId = +req.params.id;
    if (
      targetId === +req.user.id &&
      (req.body.disabled || req.body.isAdmin === false)
    )
      return res.status(400).json({
        error: "You cannot disable or demote your own active account",
      });
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT * FROM diary_users WHERE id=$1 FOR UPDATE",
      [targetId],
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }
    if (current.rows[0].is_admin && req.body.isAdmin === false) {
      const admins = await client.query(
        "SELECT count(*)::int AS count FROM diary_users WHERE is_admin AND disabled_at IS NULL",
      );
      if (admins.rows[0].count <= 1) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ error: "At least one active administrator is required" });
      }
    }
    const { rows } = await client.query(
      "UPDATE diary_users SET is_admin=COALESCE($1,is_admin),disabled_at=CASE WHEN $2::boolean THEN COALESCE(disabled_at,NOW()) ELSE NULL END WHERE id=$3 RETURNING id,is_admin,disabled_at",
      [
        typeof req.body.isAdmin === "boolean" ? req.body.isAdmin : null,
        !!req.body.disabled,
        targetId,
      ],
    );
    if (req.body.disabled)
      await client.query("DELETE FROM diary_sessions WHERE user_id=$1", [
        targetId,
      ]);
    await auditAdmin(
      req,
      "user.access_updated",
      "user",
      targetId,
      {
        isAdmin:
          typeof req.body.isAdmin === "boolean" ? req.body.isAdmin : undefined,
        disabled: !!req.body.disabled,
      },
      client,
    );
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});
app.get("/api/journals", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT j.*,CASE WHEN j.owner_id=$1 THEN 'owner' ELSE m.role END AS role,count(e.id) FILTER (WHERE e.deleted_at IS NULL) AS entry_count FROM diary_journals j LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$1 LEFT JOIN diary_entries e ON e.journal_id=j.id WHERE j.owner_id=$1 OR m.user_id=$1 GROUP BY j.id,m.role ORDER BY (j.owner_id=$1) DESC,j.is_default DESC,j.sort_order,j.id`,
      [req.user.id],
    );
    res.json(rows.map(journal));
  } catch (error) {
    next(error);
  }
});
app.post("/api/journals", auth, async (req, res, next) => {
  try {
    const name = String(req.body.name || "")
        .trim()
        .slice(0, 80),
      color = /^#[0-9a-f]{6}$/i.test(req.body.color)
        ? req.body.color
        : "#7aa2f7";
    if (!name) return res.status(400).json({ error: "Journal name required" });
    const { rows } = await pool.query(
      `INSERT INTO diary_journals(owner_id,name,description,color,visibility,sort_order) VALUES($1,$2,$3,$4,$5,COALESCE((SELECT max(sort_order)+1 FROM diary_journals WHERE owner_id=$1),0)) RETURNING *`,
      [
        req.user.id,
        name,
        String(req.body.description || "").slice(0, 500),
        color,
        req.body.visibility === "public" ? "public" : "private",
      ],
    );
    res.status(201).json(journal(rows[0]));
  } catch (error) {
    if (error.code === "23505")
      return res
        .status(409)
        .json({ error: "A journal with that name already exists" });
    next(error);
  }
});
app.put("/api/journals/:id", auth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const name = String(req.body.name || "")
        .trim()
        .slice(0, 80),
      color = /^#[0-9a-f]{6}$/i.test(req.body.color)
        ? req.body.color
        : "#7aa2f7";
    if (!name) return res.status(400).json({ error: "Journal name required" });
    await client.query("BEGIN");
    if (req.body.isDefault)
      await client.query(
        "UPDATE diary_journals SET is_default=false WHERE owner_id=$1",
        [req.user.id],
      );
    const { rows } = await client.query(
      `UPDATE diary_journals SET name=$1,description=$2,color=$3,visibility=$4,sort_order=$5,is_default=CASE WHEN $6 THEN true ELSE is_default END,updated_at=NOW() WHERE id=$7 AND owner_id=$8 RETURNING *`,
      [
        name,
        String(req.body.description || "").slice(0, 500),
        color,
        req.body.visibility === "public" ? "public" : "private",
        Number.isInteger(req.body.sortOrder) ? req.body.sortOrder : 0,
        !!req.body.isDefault,
        req.params.id,
        req.user.id,
      ],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Journal not found" });
    }
    await client.query("COMMIT");
    res.json(journal(rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505")
      return res
        .status(409)
        .json({ error: "A journal with that name already exists" });
    next(error);
  } finally {
    client.release();
  }
});
app.delete("/api/journals/:id", auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM diary_journals j WHERE j.id=$1 AND j.owner_id=$2 AND NOT j.is_default AND NOT EXISTS(SELECT 1 FROM diary_entries e WHERE e.journal_id=j.id)`,
      [req.params.id, req.user.id],
    );
    if (!result.rowCount)
      return res
        .status(409)
        .json({ error: "Only empty, non-default journals can be deleted" });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.get("/api/journals/:id/members", auth, async (req, res, next) => {
  try {
    const owned = await pool.query(
      "SELECT 1 FROM diary_journals WHERE id=$1 AND owner_id=$2",
      [req.params.id, req.user.id],
    );
    if (!owned.rowCount)
      return res.status(403).json({ error: "Journal owner required" });
    const members = await pool.query(
      `SELECT u.id,u.username,u.email,u.display_name,m.role,m.created_at FROM diary_journal_members m JOIN diary_users u ON u.id=m.user_id WHERE m.journal_id=$1 ORDER BY m.created_at`,
      [req.params.id],
    );
    const invitations = await pool.query(
      `SELECT id,email,role,expires_at,accepted_at,created_at FROM diary_journal_invitations WHERE journal_id=$1 AND accepted_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC`,
      [req.params.id],
    );
    res.json({ members: members.rows, invitations: invitations.rows });
  } catch (error) {
    next(error);
  }
});
app.post("/api/journals/:id/invitations", auth, async (req, res, next) => {
  try {
    const roles = ["editor", "contributor", "viewer"],
      role = roles.includes(req.body.role) ? req.body.role : "viewer",
      email = String(req.body.email || "")
        .trim()
        .toLowerCase()
        .slice(0, 254),
      days = Math.min(30, Math.max(1, +(req.body.days || 7))),
      token = crypto.randomBytes(32).toString("base64url");
    const { rows } = await pool.query(
      `INSERT INTO diary_journal_invitations(journal_id,invited_by,email,role,token_hash,expires_at) SELECT id,$2,$3,$4,$5,NOW()+($6||' days')::interval FROM diary_journals WHERE id=$1 AND owner_id=$2 RETURNING id,email,role,expires_at`,
      [req.params.id, req.user.id, email, role, hash(token), days],
    );
    if (!rows[0])
      return res.status(403).json({ error: "Journal owner required" });
    res.status(201).json({ ...rows[0], token, acceptUrl: `/invite/${token}` });
  } catch (error) {
    next(error);
  }
});
app.post("/api/invitations/:token/accept", auth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT i.*,j.owner_id,j.name AS journal_name FROM diary_journal_invitations i JOIN diary_journals j ON j.id=i.journal_id WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.expires_at>NOW() FOR UPDATE`,
      [hash(req.params.token)],
    );
    const invitation = rows[0];
    if (!invitation) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "Invitation is invalid or expired" });
    }
    if (invitation.email && invitation.email !== req.user.email.toLowerCase()) {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ error: "Invitation belongs to another email address" });
    }
    if (+invitation.owner_id === +req.user.id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "You already own this journal" });
    }
    await client.query(
      `INSERT INTO diary_journal_members(journal_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(journal_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
      [invitation.journal_id, req.user.id, invitation.role],
    );
    await client.query(
      "UPDATE diary_journal_invitations SET accepted_at=NOW() WHERE id=$1",
      [invitation.id],
    );
    await client.query("COMMIT");
    res.json({
      journalId: +invitation.journal_id,
      journalName: invitation.journal_name,
      role: invitation.role,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});
app.put(
  "/api/journals/:journalId/members/:userId",
  auth,
  async (req, res, next) => {
    try {
      const role = ["editor", "contributor", "viewer"].includes(req.body.role)
        ? req.body.role
        : null;
      if (!role) return res.status(400).json({ error: "Invalid role" });
      const { rows } = await pool.query(
        `UPDATE diary_journal_members m SET role=$1 FROM diary_journals j WHERE m.journal_id=$2 AND m.user_id=$3 AND j.id=m.journal_id AND j.owner_id=$4 RETURNING m.*`,
        [role, req.params.journalId, req.params.userId, req.user.id],
      );
      if (!rows[0]) return res.status(404).json({ error: "Member not found" });
      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  },
);
app.delete(
  "/api/journals/:journalId/members/:userId",
  auth,
  async (req, res, next) => {
    try {
      const result = await pool.query(
        `DELETE FROM diary_journal_members m USING diary_journals j WHERE m.journal_id=$1 AND m.user_id=$2 AND j.id=m.journal_id AND j.owner_id=$3`,
        [req.params.journalId, req.params.userId, req.user.id],
      );
      if (!result.rowCount)
        return res.status(404).json({ error: "Member not found" });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/media",
  auth,
  upload.array("media", 12),
  async (req, res, next) => {
    try {
      const files = req.files || [],
        used = await storageUsed(req.user.id),
        incoming = files.reduce((total, file) => total + file.size, 0),
        captions = (() => {
          try {
            return JSON.parse(req.body.captions || "[]");
          } catch {
            return [];
          }
        })(),
        metadata = (() => {
          try {
            return JSON.parse(req.body.metadata || "[]");
          } catch {
            return [];
          }
        })();
      const quota = await userStorageQuota(req.user.id);
      if (used + incoming > quota)
        return res
          .status(413)
          .json({ error: "Storage quota exceeded", used, quota });
      const saved = [];
      for (const [index, file] of files.entries()) {
        const key = `${req.user.id}/${crypto.randomUUID()}`;
        await mediaStore.putObject(mediaBucket, key, file.buffer, file.size, {
          "Content-Type": file.mimetype,
          "X-Amz-Meta-Original-Name": encodeURIComponent(file.originalname),
        });
        const item = {
          key,
          url: `/api/media/${encodeURIComponent(key)}`,
          name: file.originalname,
          type: file.mimetype,
          size: file.size,
          caption: String(captions[index] || "").slice(0, 500),
        };
        if (file.mimetype.startsWith("image/")) {
          const supplied = metadata[index] && typeof metadata[index] === "object" ? metadata[index] : {},
            textValue = (name, limit) => String(supplied[name] || "").slice(0, limit),
            numberValue = (name) => supplied[name] !== null && supplied[name] !== "" && Number.isFinite(Number(supplied[name])) ? Number(supplied[name]) : null;
          item.metadata = {
            make: textValue("make", 100),
            model: textValue("model", 100),
            lens: textValue("lens", 140),
            aperture: numberValue("aperture"),
            exposure: numberValue("exposure"),
            iso: numberValue("iso"),
            focalLength: numberValue("focalLength"),
            width: numberValue("width"),
            height: numberValue("height"),
            capturedAt: /^\d{4}-\d{2}-\d{2}T/.test(String(supplied.capturedAt || "")) ? String(supplied.capturedAt).slice(0, 40) : null,
          };
          try {
            const thumbnail = await sharp(file.buffer)
              .rotate()
              .resize({
                width: 640,
                height: 640,
                fit: "inside",
                withoutEnlargement: true,
              })
              .webp({ quality: 78 })
              .toBuffer();
            item.thumbKey = `${key}.thumb.webp`;
            item.thumbUrl = `/api/media/${encodeURIComponent(item.thumbKey)}`;
            await mediaStore.putObject(
              mediaBucket,
              item.thumbKey,
              thumbnail,
              thumbnail.length,
              {
                "Content-Type": "image/webp",
              },
            );
          } catch {
            // Preserve the original even when its format cannot be thumbnailed.
          }
        }
        saved.push(item);
      }
      res.status(201).json(saved);
    } catch (e) {
      next(e);
    }
  },
);
app.get("/api/storage", auth, async (req, res, next) => {
  try {
    res.json({
      used: await storageUsed(req.user.id),
      quota: await userStorageQuota(req.user.id),
    });
  } catch (e) {
    next(e);
  }
});
app.get("/api/storage/details", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id AS entry_id,e.title,item FROM diary_entries e CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.media,'[]'::jsonb)) item WHERE e.user_id=$1 AND e.deleted_at IS NULL`,
      [req.user.id],
    );
    const files = [];
    for (const row of rows) {
      const item = row.item || {}, key = item.key || "";
      let checksum = "";
      if (key) try { checksum = (await mediaStore.statObject(mediaBucket, key)).etag || ""; } catch {}
      const type = String(item.type || "application/octet-stream"), category = type.startsWith("image/") ? "images" : type.startsWith("video/") ? "videos" : type.startsWith("audio/") ? "audio" : "documents";
      files.push({ entryId: +row.entry_id, entryTitle: row.title, key, thumbKey: item.thumbKey || "", name: item.name || "attachment", type, category, size: Number(item.size || 0), checksum, url: item.url || "" });
    }
    const categories = { images: 0, videos: 0, audio: 0, documents: 0 };
    for (const file of files) categories[file.category] += file.size;
    const grouped = new Map();
    for (const file of files) {
      if (!file.checksum) continue;
      const duplicateKey = `${file.checksum}:${file.size}`, group = grouped.get(duplicateKey) || [];
      group.push(file);
      grouped.set(duplicateKey, group);
    }
    res.json({ used: await storageUsed(req.user.id), quota: await userStorageQuota(req.user.id), categories, files: files.sort((a, b) => b.size - a.size), duplicates: [...grouped.values()].filter((group) => group.length > 1) });
  } catch (error) { next(error); }
});
app.delete("/api/storage/files", auth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const key = String(req.body.key || "");
    if (!key.startsWith(`${req.user.id}/`)) return res.status(403).json({ error: "File ownership required" });
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT id,media FROM diary_entries WHERE user_id=$1 AND media @> $2::jsonb FOR UPDATE", [req.user.id, JSON.stringify([{ key }])]);
    let thumbKey = "";
    for (const row of rows) {
      const matched = (row.media || []).find((item) => item.key === key);
      thumbKey ||= matched?.thumbKey || "";
      await client.query("UPDATE diary_entries SET media=$1,updated_at=NOW() WHERE id=$2", [JSON.stringify((row.media || []).filter((item) => item.key !== key)), row.id]);
    }
    await client.query("COMMIT");
    try { await mediaStore.removeObject(mediaBucket, key); } catch {}
    if (thumbKey) try { await mediaStore.removeObject(mediaBucket, thumbKey); } catch {}
    res.json({ removedFromEntries: rows.length });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally { client.release(); }
});
app.get("/api/tags", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.tag,count(*)::int AS count FROM diary_entries e CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.tags,'[]'::jsonb)) AS t(tag) WHERE e.user_id=$1 AND e.deleted_at IS NULL GROUP BY t.tag ORDER BY count DESC,t.tag`,
      [req.user.id],
    );
    res.json(rows);
  } catch (error) { next(error); }
});
app.put("/api/tags/:tag", auth, async (req, res, next) => {
  try {
    const oldTag = String(req.params.tag).trim(), newTag = String(req.body.name || "").trim().replace(/^#/, "").slice(0, 80);
    if (!newTag) return res.status(400).json({ error: "Tag name required" });
    const result = await pool.query(
      `UPDATE diary_entries e SET tags=(SELECT jsonb_agg(DISTINCT CASE WHEN value=$1 THEN $2 ELSE value END) FROM jsonb_array_elements_text(e.tags) value),updated_at=NOW() WHERE e.user_id=$3 AND e.tags ? $1`,
      [oldTag, newTag, req.user.id],
    );
    res.json({ updated: result.rowCount });
  } catch (error) { next(error); }
});
app.delete("/api/tags/:tag", auth, async (req, res, next) => {
  try {
    const tag = String(req.params.tag).trim(), result = await pool.query(
      `UPDATE diary_entries e SET tags=COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements_text(e.tags) value WHERE value<>$1),'[]'::jsonb),updated_at=NOW() WHERE e.user_id=$2 AND e.tags ? $1`,
      [tag, req.user.id],
    );
    res.json({ updated: result.rowCount });
  } catch (error) { next(error); }
});
app.get("/api/media/*key", auth, async (req, res, next) => {
  try {
    const key = Array.isArray(req.params.key)
      ? req.params.key.join("/")
      : req.params.key;
    if (!key.startsWith(`${req.user.id}/`)) {
      const allowed = await pool.query(
        `SELECT 1 FROM diary_entries e JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members jm ON jm.journal_id=j.id AND jm.user_id=$2 CROSS JOIN LATERAL jsonb_array_elements(e.media) m WHERE (e.visibility='public' OR j.owner_id=$2 OR jm.user_id=$2) AND (m->>'key'=$1 OR m->>'thumbKey'=$1) LIMIT 1`,
        [key, req.user.id],
      );
      if (!allowed.rowCount)
        return res.status(403).json({ error: "Media access denied" });
    }
    const stat = await mediaStore.statObject(mediaBucket, key);
    res.setHeader(
      "Content-Type",
      stat.metaData["content-type"] || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "private, max-age=86400");
    (await mediaStore.getObject(mediaBucket, key)).pipe(res);
  } catch (e) {
    if (e.code === "NoSuchKey" || e.code === "NotFound")
      return res.status(404).end();
    next(e);
  }
});
async function findPublicLink(token) {
  const { rows } = await pool.query(
    `SELECT l.*,e.*,l.id AS link_id,l.password_hash AS link_password_hash,l.expires_at AS link_expires_at,u.display_name FROM diary_public_links l JOIN diary_entries e ON e.id=l.entry_id JOIN diary_users u ON u.id=e.user_id WHERE l.token_hash=$1 AND l.revoked_at IS NULL AND l.expires_at>NOW() AND e.deleted_at IS NULL`,
    [hash(token)],
  );
  return rows[0] || null;
}
async function hasPublicGrant(req, link) {
  if (!link.link_password_hash) return true;
  const grant = cookie(req, "field_log_share");
  if (!grant) return false;
  const result = await pool.query(
    "SELECT 1 FROM diary_public_sessions WHERE token_hash=$1 AND link_id=$2 AND expires_at>NOW()",
    [hash(grant), link.link_id],
  );
  return !!result.rowCount;
}
function sharedEntry(row, token) {
  const result = entry({ ...row, owner: false });
  result.media = (result.media || []).map((item) => ({
    ...item,
    url: item.key
      ? `/api/public/${encodeURIComponent(token)}/media/${encodeURIComponent(item.key)}`
      : item.url,
    thumbUrl: item.thumbKey
      ? `/api/public/${encodeURIComponent(token)}/media/${encodeURIComponent(item.thumbKey)}`
      : item.thumbUrl,
  }));
  return result;
}
app.get("/api/public/:token", async (req, res, next) => {
  try {
    const link = await findPublicLink(req.params.token);
    if (!link)
      return res
        .status(404)
        .json({ error: "Share link is invalid or expired" });
    if (!(await hasPublicGrant(req, link)))
      return res.status(401).json({ passwordRequired: true });
    await pool.query(
      "UPDATE diary_public_links SET view_count=view_count+1,last_viewed_at=NOW() WHERE id=$1",
      [link.link_id],
    );
    res.json(sharedEntry(link, req.params.token));
  } catch (error) {
    next(error);
  }
});
app.post("/api/public/:token/access", async (req, res, next) => {
  try {
    const link = await findPublicLink(req.params.token);
    if (!link)
      return res
        .status(404)
        .json({ error: "Share link is invalid or expired" });
    if (
      link.link_password_hash &&
      !(await verify(String(req.body.password || ""), link.link_password_hash))
    )
      return res.status(401).json({ error: "Incorrect password" });
    const grant = crypto.randomBytes(32).toString("base64url"),
      expiry = new Date(
        Math.min(
          Date.now() + 86400000,
          new Date(link.link_expires_at).getTime(),
        ),
      );
    await pool.query(
      "INSERT INTO diary_public_sessions(token_hash,link_id,expires_at) VALUES($1,$2,$3)",
      [hash(grant), link.link_id, expiry],
    );
    res.setHeader(
      "Set-Cookie",
      `field_log_share=${grant}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(1, Math.floor((expiry.getTime() - Date.now()) / 1000))}${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
    );
    await pool.query(
      "UPDATE diary_public_links SET view_count=view_count+1,last_viewed_at=NOW() WHERE id=$1",
      [link.link_id],
    );
    res.json(sharedEntry(link, req.params.token));
  } catch (error) {
    next(error);
  }
});
app.get("/api/public/:token/media/*key", async (req, res, next) => {
  try {
    const link = await findPublicLink(req.params.token);
    if (!link || !(await hasPublicGrant(req, link)))
      return res.status(403).end();
    const key = Array.isArray(req.params.key)
        ? req.params.key.join("/")
        : req.params.key,
      allowed = (link.media || []).some(
        (item) => item.key === key || item.thumbKey === key,
      );
    if (!allowed) return res.status(403).end();
    const stat = await mediaStore.statObject(mediaBucket, key);
    res.setHeader(
      "Content-Type",
      stat.metaData["content-type"] || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "private, max-age=3600");
    (await mediaStore.getObject(mediaBucket, key)).pipe(res);
  } catch (error) {
    if (error.code === "NoSuchKey" || error.code === "NotFound")
      return res.status(404).end();
    next(error);
  }
});
app.get("/api/entries/:id/public-links", auth, async (req, res, next) => {
  try {
    const access = await entryAccess(req.user.id, req.params.id);
    if (!access?.can_manage)
      return res.status(403).json({ error: "Entry management required" });
    if (access.is_encrypted)
      return res
        .status(409)
        .json({ error: "Encrypted entries cannot have public links" });
    const { rows } = await pool.query(
      "SELECT id,expires_at,revoked_at,view_count,created_at,last_viewed_at,token_ciphertext,(password_hash IS NOT NULL) AS password_protected FROM diary_public_links WHERE entry_id=$1 ORDER BY created_at DESC",
      [req.params.id],
    );
    res.json(rows.map(({ token_ciphertext, ...row }) => {
      let url = null;
      if (token_ciphertext && !row.revoked_at && new Date(row.expires_at) > new Date()) {
        try { url = `/share/${decryptSecret(token_ciphertext)}`; } catch {}
      }
      return { ...row, url };
    }));
  } catch (error) {
    next(error);
  }
});
app.post("/api/entries/:id/public-links/automatic", auth, async (req, res, next) => {
  try {
    const access = await entryAccess(req.user.id, req.params.id),
      days = Math.min(365, Math.max(1, +(req.body.days || 7)));
    if (!access?.can_manage)
      return res.status(403).json({ error: "Entry management required" });
    if (access.is_encrypted)
      return res.status(409).json({ error: "Encrypted entries cannot have public links" });
    const existing = await pool.query(
      `SELECT id,expires_at,created_at,token_ciphertext FROM diary_public_links WHERE entry_id=$1 AND revoked_at IS NULL AND expires_at>NOW() AND token_ciphertext IS NOT NULL AND password_hash IS NULL ORDER BY created_at DESC LIMIT 1`,
      [req.params.id],
    );
    if (existing.rows[0]) {
      try {
        const { token_ciphertext, ...link } = existing.rows[0];
        return res.json({ ...link, url: `/share/${decryptSecret(token_ciphertext)}`, reused: true });
      } catch {}
    }
    const token = crypto.randomBytes(32).toString("base64url"),
      created = await pool.query(
        `INSERT INTO diary_public_links(entry_id,created_by,token_hash,token_ciphertext,expires_at) VALUES($1,$2,$3,$4,NOW()+($5||' days')::interval) RETURNING id,expires_at,created_at`,
        [req.params.id, req.user.id, hash(token), encryptSecret(token), days],
      );
    await activity(access.journal_id, req.user.id, "created_public_link", req.params.id, {
      expiresAt: created.rows[0].expires_at,
      passwordProtected: false,
      automatic: true,
    });
    res.status(201).json({ ...created.rows[0], url: `/share/${token}`, reused: false });
  } catch (error) {
    next(error);
  }
});
app.get("/api/public-links", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id,l.entry_id,l.expires_at,l.revoked_at,l.view_count,l.created_at,l.last_viewed_at,(l.password_hash IS NOT NULL) AS password_protected,e.title FROM diary_public_links l JOIN diary_entries e ON e.id=l.entry_id JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$1 WHERE e.user_id=$1 OR j.owner_id=$1 OR m.role='editor' ORDER BY l.created_at DESC`,
      [req.user.id],
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});
app.get("/api/blocks", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT u.id,u.username,u.display_name,b.created_at FROM diary_user_blocks b JOIN diary_users u ON u.id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created_at DESC",
      [req.user.id],
    );
    res.json(rows);
  } catch (error) { next(error); }
});
app.post("/api/blocks", auth, async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase(),
      found = await pool.query("SELECT id FROM diary_users WHERE username=$1 AND id<>$2", [username, req.user.id]);
    if (!found.rows[0]) return res.status(404).json({ error: "User not found" });
    await pool.query("INSERT INTO diary_user_blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.user.id, found.rows[0].id]);
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});
app.delete("/api/blocks/:id", auth, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM diary_user_blocks WHERE blocker_id=$1 AND blocked_id=$2", [req.user.id, req.params.id]);
    res.status(204).end();
  } catch (error) { next(error); }
});
app.get("/api/comments/pending", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id,c.body,c.created_at,e.id AS entry_id,e.title,u.display_name,u.username FROM diary_comments c JOIN diary_entries e ON e.id=c.entry_id JOIN diary_users u ON u.id=c.user_id JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$1 WHERE c.deleted_at IS NULL AND NOT c.approved AND (e.user_id=$1 OR j.owner_id=$1 OR m.role='editor') ORDER BY c.created_at DESC`,
      [req.user.id],
    );
    res.json(rows);
  } catch (error) { next(error); }
});
app.post("/api/comments/:id/approve", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE diary_comments c SET approved=true FROM diary_entries e JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$2 WHERE c.id=$1 AND e.id=c.entry_id AND (e.user_id=$2 OR j.owner_id=$2 OR m.role='editor') RETURNING c.id`,
      [req.params.id, req.user.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Pending comment not found" });
    res.json(rows[0]);
  } catch (error) { next(error); }
});
app.post("/api/entries/:id/public-links", auth, async (req, res, next) => {
  try {
    const access = await entryAccess(req.user.id, req.params.id),
      days = Math.min(365, Math.max(1, +(req.body.days || 7))),
      pass = String(req.body.password || ""),
      token = crypto.randomBytes(32).toString("base64url");
    if (!access?.can_manage)
      return res.status(403).json({ error: "Entry management required" });
    if (access.is_encrypted)
      return res
        .status(409)
        .json({ error: "Encrypted entries cannot have public links" });
    if (pass && pass.length < 8)
      return res
        .status(400)
        .json({ error: "Share passwords need at least 8 characters" });
    const { rows } = await pool.query(
      `INSERT INTO diary_public_links(entry_id,created_by,token_hash,token_ciphertext,password_hash,expires_at) VALUES($1,$2,$3,$4,$5,NOW()+($6||' days')::interval) RETURNING id,expires_at,created_at`,
      [
        req.params.id,
        req.user.id,
        hash(token),
        encryptSecret(token),
        pass ? await password(pass) : null,
        days,
      ],
    );
    await activity(
      access.journal_id,
      req.user.id,
      "created_public_link",
      req.params.id,
      { expiresAt: rows[0].expires_at, passwordProtected: !!pass },
    );
    res.status(201).json({
      ...rows[0],
      token,
      url: `/share/${token}`,
      passwordProtected: !!pass,
    });
  } catch (error) {
    next(error);
  }
});
app.delete("/api/public-links/:id", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE diary_public_links l SET revoked_at=NOW() FROM diary_entries e JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$2 WHERE l.id=$1 AND e.id=l.entry_id AND (e.user_id=$2 OR j.owner_id=$2 OR m.role='editor') RETURNING l.id,l.entry_id,e.journal_id`,
      [req.params.id, req.user.id],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Share link not found" });
    await activity(
      rows[0].journal_id,
      req.user.id,
      "revoked_public_link",
      rows[0].entry_id,
    );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.get("/api/entries", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,u.display_name,(e.user_id=$1 OR j.owner_id=$1 OR jm.role='editor') AS owner FROM diary_entries e JOIN diary_users u ON u.id=e.user_id JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members jm ON jm.journal_id=j.id AND jm.user_id=$1 WHERE e.deleted_at IS NULL AND (e.user_id=$1 OR j.owner_id=$1 OR jm.user_id=$1 OR e.visibility='public') ORDER BY e.pinned DESC,e.entry_date DESC,e.created_at DESC`,
      [req.user.id],
    );
    res.json(rows.map(entry));
  } catch (e) {
    next(e);
  }
});
app.get("/api/entries/:id", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,u.display_name,(e.user_id=$1 OR j.owner_id=$1 OR jm.role='editor') AS owner FROM diary_entries e JOIN diary_users u ON u.id=e.user_id JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members jm ON jm.journal_id=j.id AND jm.user_id=$1 WHERE e.id=$2 AND e.deleted_at IS NULL AND (e.user_id=$1 OR j.owner_id=$1 OR jm.user_id=$1 OR e.visibility='public')`,
      [req.user.id, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Entry not found" });
    res.json(entry(rows[0]));
  } catch (error) {
    next(error);
  }
});
app.get("/api/search", auth, async (req, res, next) => {
  try {
    const values = [req.user.id],
      clauses = [
        "e.deleted_at IS NULL",
        "(e.user_id=$1 OR j.owner_id=$1 OR jm.user_id=$1 OR e.visibility='public')",
      ],
      add = (sql, value) => {
        values.push(value);
        clauses.push(sql.replace("?", `$${values.length}`));
      },
      q = String(req.query.q || "")
        .trim()
        .slice(0, 500);
    if (q) {
      values.push(q);
      clauses.push(
        `(to_tsvector('english'::regconfig,coalesce(e.title,'')||' '||coalesce(e.mood,'')||' '||coalesce(e.location_name,'')) || jsonb_to_tsvector('english'::regconfig,e.body,'["string"]'::jsonb) || jsonb_to_tsvector('english'::regconfig,e.tags,'["string"]'::jsonb)) @@ websearch_to_tsquery('english'::regconfig,$${values.length})`,
      );
    }
    if (req.query.tag)
      add("e.tags @> to_jsonb(ARRAY[?]::text[])", String(req.query.tag));
    if (req.query.mood) add("lower(e.mood)=lower(?)", String(req.query.mood));
    if (req.query.from) add("e.entry_date>=?::date", String(req.query.from));
    if (req.query.to) add("e.entry_date<=?::date", String(req.query.to));
    if (req.query.media === "true")
      clauses.push("jsonb_array_length(e.media)>0");
    if (req.query.located === "true")
      clauses.push("e.latitude IS NOT NULL AND e.longitude IS NOT NULL");
    if (req.query.owner === "mine") clauses.push("e.user_id=$1");
    if (req.query.visibility === "private")
      clauses.push("e.user_id=$1 AND e.visibility='private'");
    if (req.query.visibility === "public")
      clauses.push("e.visibility='public'");
    const { rows } = await pool.query(
      `SELECT e.*,u.display_name,(e.user_id=$1 OR j.owner_id=$1 OR jm.role='editor') AS owner FROM diary_entries e JOIN diary_users u ON u.id=e.user_id JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members jm ON jm.journal_id=j.id AND jm.user_id=$1 WHERE ${clauses.join(" AND ")} ORDER BY e.pinned DESC,e.entry_date DESC,e.created_at DESC LIMIT 500`,
      values,
    );
    res.json(rows.map(entry));
  } catch (e) {
    next(e);
  }
});
app.get("/api/entries/:id/social", auth, async (req, res, next) => {
  try {
    const access = await entryAccess(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: "Entry not found" });
    const comments = await pool.query(
      `SELECT c.id,c.parent_id,CASE WHEN c.deleted_at IS NULL THEN c.body ELSE '' END AS body,c.created_at,c.updated_at,c.approved,c.deleted_at IS NOT NULL AS deleted,CASE WHEN c.deleted_at IS NULL THEN u.id END AS user_id,CASE WHEN c.deleted_at IS NULL THEN u.username ELSE '' END AS username,CASE WHEN c.deleted_at IS NULL THEN u.display_name ELSE 'Deleted comment' END AS display_name,(c.deleted_at IS NULL AND (c.user_id=$2 OR $3::boolean)) AS can_delete FROM diary_comments c JOIN diary_users u ON u.id=c.user_id WHERE c.entry_id=$1 AND (c.deleted_at IS NOT NULL OR c.approved OR c.user_id=$2 OR $3::boolean) ORDER BY c.created_at`,
      [req.params.id, req.user.id, access.can_manage],
    );
    const reactions = await pool.query(
      `SELECT r.id,r.comment_id,r.emoji,u.display_name,(r.user_id=$2) AS mine FROM diary_reactions r JOIN diary_users u ON u.id=r.user_id LEFT JOIN diary_comments c ON c.id=r.comment_id WHERE r.entry_id=$1 AND (r.comment_id IS NULL OR c.deleted_at IS NULL) ORDER BY r.created_at`,
      [req.params.id, req.user.id],
    );
    res.json({ comments: comments.rows, reactions: reactions.rows });
  } catch (error) {
    next(error);
  }
});
app.post("/api/entries/:id/comments", auth, async (req, res, next) => {
  try {
    const access = await entryAccess(req.user.id, req.params.id),
      body = String(req.body.body || "")
        .trim()
        .slice(0, 5000),
      parentId = req.body.parentId || null;
    if (!access) return res.status(404).json({ error: "Entry not found" });
    if (!body) return res.status(400).json({ error: "Comment required" });
    const ownerPreferences = await pool.query(
      "SELECT preferences FROM diary_users WHERE id=$1",
      [access.user_id],
    );
    const commentPolicy = {
      ...defaultUserPreferences,
      ...(ownerPreferences.rows[0]?.preferences || {}),
    }.commentPolicy;
    const ownsEntry = +access.user_id === +req.user.id;
    const blocked = await pool.query(
      "SELECT 1 FROM diary_user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1",
      [access.user_id, req.user.id],
    );
    if (blocked.rowCount && !ownsEntry)
      return res.status(403).json({ error: "Comments are unavailable between these accounts" });
    if (commentPolicy === "nobody" && !ownsEntry)
      return res.status(403).json({ error: "Comments are disabled for this entry" });
    if (commentPolicy === "members" && !ownsEntry && !access.role)
      return res.status(403).json({ error: "Comments are limited to journal members" });
    if (parentId) {
      const parent = await pool.query(
        "SELECT 1 FROM diary_comments WHERE id=$1 AND entry_id=$2 AND deleted_at IS NULL",
        [parentId, req.params.id],
      );
      if (!parent.rowCount)
        return res.status(400).json({ error: "Invalid parent comment" });
    }
    const approved = ownsEntry || access.can_manage || !ownerPreferences.rows[0]?.preferences?.approveComments,
      { rows } = await pool.query(
      `INSERT INTO diary_comments(entry_id,user_id,parent_id,body,approved) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, req.user.id, parentId, body, approved],
    );
    if (!approved) return res.status(202).json({ ...rows[0], pending: true });
    await pool.query(
      `INSERT INTO diary_notifications(user_id,actor_id,entry_id,comment_id,type) SELECT e.user_id,$1,e.id,$3,'comment' FROM diary_entries e JOIN diary_users u ON u.id=e.user_id WHERE e.id=$2 AND e.user_id<>$1 AND COALESCE((u.preferences->>'notifyComments')::boolean,true)`,
      [req.user.id, req.params.id, rows[0].id],
    );
    if (parentId)
      await pool.query(
        `INSERT INTO diary_notifications(user_id,actor_id,entry_id,comment_id,type) SELECT c.user_id,$1,c.entry_id,$3,'reply' FROM diary_comments c JOIN diary_users u ON u.id=c.user_id WHERE c.id=$2 AND c.user_id<>$1 AND COALESCE((u.preferences->>'notifyReplies')::boolean,true) AND c.user_id<>(SELECT user_id FROM diary_entries WHERE id=c.entry_id)`,
        [req.user.id, parentId, rows[0].id],
      );
    const usernames = [
      ...new Set(
        [...body.matchAll(/(?:^|\s)@([a-z0-9_-]{3,30})/gi)].map((match) =>
          match[1].toLowerCase(),
        ),
      ),
    ];
    if (usernames.length)
      await pool.query(
        `INSERT INTO diary_notifications(user_id,actor_id,entry_id,comment_id,type) SELECT u.id,$1,$2,$3,'mention' FROM diary_users u WHERE u.username=ANY($4) AND u.id<>$1 AND COALESCE((u.preferences->>'notifyMentions')::boolean,true) AND NOT EXISTS(SELECT 1 FROM diary_user_blocks b WHERE (b.blocker_id=u.id AND b.blocked_id=$1) OR (b.blocker_id=$1 AND b.blocked_id=u.id)) AND (EXISTS(SELECT 1 FROM diary_journals j WHERE j.id=$5 AND j.owner_id=u.id) OR EXISTS(SELECT 1 FROM diary_journal_members m WHERE m.journal_id=$5 AND m.user_id=u.id))`,
        [req.user.id, req.params.id, rows[0].id, usernames, access.journal_id],
      );
    await activity(access.journal_id, req.user.id, "commented", req.params.id, {
      commentId: +rows[0].id,
    });
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});
app.delete("/api/comments/:id", auth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const found = await client.query(
        "SELECT c.*,e.journal_id FROM diary_comments c JOIN diary_entries e ON e.id=c.entry_id WHERE c.id=$1",
        [req.params.id],
      ),
      comment = found.rows[0];
    if (!comment) return res.status(404).json({ error: "Comment not found" });
    const access = await entryAccess(req.user.id, comment.entry_id);
    if (!access || (+comment.user_id !== +req.user.id && !access.can_manage))
      return res.status(403).json({ error: "Not allowed" });
    await client.query("BEGIN");
    const children = await client.query("SELECT 1 FROM diary_comments WHERE parent_id=$1 LIMIT 1", [req.params.id]);
    if (children.rowCount) {
      await client.query("UPDATE diary_comments SET body='',deleted_at=NOW(),updated_at=NOW() WHERE id=$1", [req.params.id]);
      await client.query("DELETE FROM diary_reactions WHERE comment_id=$1", [req.params.id]);
    } else {
      await client.query("DELETE FROM diary_comments WHERE id=$1", [req.params.id]);
      let ancestorId = comment.parent_id;
      while (ancestorId) {
        const ancestor = await client.query("SELECT id,parent_id,deleted_at,EXISTS(SELECT 1 FROM diary_comments child WHERE child.parent_id=diary_comments.id) AS has_children FROM diary_comments WHERE id=$1 FOR UPDATE", [ancestorId]);
        if (!ancestor.rowCount || !ancestor.rows[0].deleted_at || ancestor.rows[0].has_children) break;
        await client.query("DELETE FROM diary_comments WHERE id=$1", [ancestorId]);
        ancestorId = ancestor.rows[0].parent_id;
      }
    }
    await client.query("COMMIT");
    await activity(
      comment.journal_id,
      req.user.id,
      "deleted_comment",
      comment.entry_id,
    );
    res.json({ deleted: true, tombstoned: children.rowCount > 0 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});
app.post("/api/entries/:id/reactions", auth, async (req, res, next) => {
  try {
    const access = await entryAccess(req.user.id, req.params.id),
      emoji = String(req.body.emoji || "").slice(0, 16),
      commentId = req.body.commentId || null;
    if (!access) return res.status(404).json({ error: "Entry not found" });
    if (!emoji) return res.status(400).json({ error: "Reaction required" });
    const blocked = await pool.query(
      "SELECT 1 FROM diary_user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1",
      [access.user_id, req.user.id],
    );
    if (blocked.rowCount && +access.user_id !== +req.user.id)
      return res.status(403).json({ error: "Reactions are unavailable between these accounts" });
    if (commentId) {
      const comment = await pool.query(
        "SELECT 1 FROM diary_comments WHERE id=$1 AND entry_id=$2 AND deleted_at IS NULL",
        [commentId, req.params.id],
      );
      if (!comment.rowCount)
        return res.status(400).json({ error: "Invalid comment" });
    }
    const removed = await pool.query(
      "DELETE FROM diary_reactions WHERE entry_id=$1 AND comment_id IS NOT DISTINCT FROM $2::bigint AND user_id=$3 AND emoji=$4",
      [req.params.id, commentId, req.user.id, emoji],
    );
    if (!removed.rowCount)
      await pool.query(
        "INSERT INTO diary_reactions(entry_id,comment_id,user_id,emoji) VALUES($1,$2,$3,$4)",
        [req.params.id, commentId, req.user.id, emoji],
      );
    await activity(
      access.journal_id,
      req.user.id,
      removed.rowCount ? "removed_reaction" : "reacted",
      req.params.id,
      { emoji, commentId },
    );
    res.json({ active: !removed.rowCount });
  } catch (error) {
    next(error);
  }
});
app.get("/api/journals/:id/activity", auth, async (req, res, next) => {
  try {
    const access = await pool.query(
      `SELECT 1 FROM diary_journals j LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$2 WHERE j.id=$1 AND (j.owner_id=$2 OR m.user_id=$2)`,
      [req.params.id, req.user.id],
    );
    if (!access.rowCount)
      return res.status(403).json({ error: "Journal access required" });
    const { rows } = await pool.query(
      `SELECT a.id,a.action,a.metadata,a.created_at,u.display_name,e.title AS entry_title FROM diary_activity a LEFT JOIN diary_users u ON u.id=a.actor_id LEFT JOIN diary_entries e ON e.id=a.entry_id WHERE a.journal_id=$1 ORDER BY a.created_at DESC LIMIT 100`,
      [req.params.id],
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});
app.get("/api/notifications", auth, async (req, res, next) => {
  try {
    const preferenceResult = await pool.query("SELECT preferences FROM diary_users WHERE id=$1", [req.user.id]),
      preferences = { ...defaultUserPreferences, ...(preferenceResult.rows[0]?.preferences || {}) };
    if (!preferences.notificationInApp && req.query.channel !== "browser") return res.json([]);
    const { rows } = await pool.query(
      `SELECT n.id,n.type,n.read_at,n.created_at,n.entry_id,u.display_name AS actor,e.title AS entry_title FROM diary_notifications n LEFT JOIN diary_users u ON u.id=n.actor_id LEFT JOIN diary_entries e ON e.id=n.entry_id WHERE n.user_id=$1 ${req.query.unread === "1" ? "AND n.read_at IS NULL" : ""} ORDER BY n.created_at DESC LIMIT 100`,
      [req.user.id],
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});
app.post("/api/notifications/read", auth, async (req, res, next) => {
  try {
    await pool.query(
      "UPDATE diary_notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL",
      [req.user.id],
    );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.get("/api/knowledge", auth, async (req, res, next) => {
  try {
    const accessible = await pool.query(
      `SELECT DISTINCT e.id,e.journal_id,e.title,e.entry_date,u.display_name AS author FROM diary_entries e JOIN diary_users u ON u.id=e.user_id JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$1 WHERE e.deleted_at IS NULL AND (e.user_id=$1 OR j.owner_id=$1 OR m.user_id=$1 OR e.visibility='public') ORDER BY e.entry_date DESC LIMIT 1000`,
      [req.user.id],
    );
    const ids = accessible.rows.map((row) => row.id);
    if (!ids.length)
      return res.json({ entries: [], links: [], people: [], collections: [] });
    const [links, people, collections] = await Promise.all([
      pool.query(
        `SELECT l.id,l.source_entry_id,l.target_entry_id,l.label FROM diary_entry_links l WHERE l.source_entry_id=ANY($1::bigint[]) AND l.target_entry_id=ANY($1::bigint[])`,
        [ids],
      ),
      pool.query(
        `SELECT p.id,p.name,p.notes,p.owner_id,COALESCE(array_agg(ep.entry_id) FILTER (WHERE ep.entry_id=ANY($2::bigint[])),'{}') AS entry_ids FROM diary_people p LEFT JOIN diary_entry_people ep ON ep.person_id=p.id WHERE p.owner_id=$1 OR ep.entry_id=ANY($2::bigint[]) GROUP BY p.id ORDER BY p.name`,
        [req.user.id, ids],
      ),
      pool.query(
        `SELECT c.id,c.journal_id,c.name,c.color,c.description,c.created_by,COALESCE(array_agg(ce.entry_id) FILTER (WHERE ce.entry_id=ANY($2::bigint[])),'{}') AS entry_ids FROM diary_collections c LEFT JOIN diary_collection_entries ce ON ce.collection_id=c.id JOIN diary_journals j ON j.id=c.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$1 WHERE j.owner_id=$1 OR m.user_id=$1 GROUP BY c.id ORDER BY c.name`,
        [req.user.id, ids],
      ),
    ]);
    res.json({
      entries: accessible.rows.map((row) => ({
        ...row,
        id: +row.id,
        journal_id: +row.journal_id,
      })),
      links: links.rows.map((row) => ({
        id: +row.id,
        sourceId: +row.source_entry_id,
        targetId: +row.target_entry_id,
        label: row.label,
      })),
      people: people.rows.map((row) => ({
        id: +row.id,
        name: row.name,
        notes: row.notes,
        ownerId: +row.owner_id,
        entryIds: row.entry_ids.map(Number),
      })),
      collections: collections.rows.map((row) => ({
        id: +row.id,
        journalId: +row.journal_id,
        name: row.name,
        color: row.color,
        description: row.description,
        createdBy: +row.created_by,
        entryIds: row.entry_ids.map(Number),
      })),
    });
  } catch (error) {
    next(error);
  }
});
app.post("/api/people", auth, async (req, res, next) => {
  try {
    const name = String(req.body.name || "")
      .trim()
      .slice(0, 100);
    if (!name) return res.status(400).json({ error: "Person name required" });
    const { rows } = await pool.query(
      "INSERT INTO diary_people(owner_id,name,notes) VALUES($1,$2,$3) RETURNING *",
      [req.user.id, name, String(req.body.notes || "").slice(0, 1000)],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === "23505")
      return res.status(409).json({ error: "That person already exists" });
    next(error);
  }
});
app.put("/api/people/:id", auth, async (req, res, next) => {
  try {
    const name = String(req.body.name || "")
        .trim()
        .slice(0, 100),
      { rows } = await pool.query(
        "UPDATE diary_people SET name=$1,notes=$2 WHERE id=$3 AND owner_id=$4 RETURNING *",
        [
          name,
          String(req.body.notes || "").slice(0, 1000),
          req.params.id,
          req.user.id,
        ],
      );
    if (!rows[0]) return res.status(404).json({ error: "Person not found" });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});
app.delete("/api/people/:id", auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "DELETE FROM diary_people WHERE id=$1 AND owner_id=$2",
      [req.params.id, req.user.id],
    );
    if (!result.rowCount)
      return res.status(404).json({ error: "Person not found" });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.post("/api/entries/:id/people/:personId", auth, async (req, res, next) => {
  try {
    const access = await entryAccess(req.user.id, req.params.id);
    if (!access?.can_manage)
      return res.status(403).json({ error: "Entry management required" });
    const person = await pool.query(
      "SELECT 1 FROM diary_people WHERE id=$1 AND (owner_id=$2 OR EXISTS(SELECT 1 FROM diary_entry_people ep JOIN diary_entries e ON e.id=ep.entry_id JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$2 WHERE ep.person_id=$1 AND (j.owner_id=$2 OR m.user_id=$2)))",
      [req.params.personId, req.user.id],
    );
    if (!person.rowCount)
      return res.status(404).json({ error: "Person not found" });
    const removed = await pool.query(
      "DELETE FROM diary_entry_people WHERE entry_id=$1 AND person_id=$2",
      [req.params.id, req.params.personId],
    );
    if (!removed.rowCount)
      await pool.query(
        "INSERT INTO diary_entry_people(entry_id,person_id,created_by) VALUES($1,$2,$3)",
        [req.params.id, req.params.personId, req.user.id],
      );
    await activity(
      access.journal_id,
      req.user.id,
      removed.rowCount ? "unlinked_person" : "linked_person",
      req.params.id,
      { personId: +req.params.personId },
    );
    res.json({ active: !removed.rowCount });
  } catch (error) {
    next(error);
  }
});
app.post("/api/entries/:id/links", auth, async (req, res, next) => {
  try {
    const access = await entryAccess(req.user.id, req.params.id),
      target = await entryAccess(req.user.id, req.body.targetId),
      label = String(req.body.label || "related")
        .trim()
        .slice(0, 60);
    if (!access?.can_manage)
      return res.status(403).json({ error: "Entry management required" });
    if (!target || +req.params.id === +req.body.targetId)
      return res
        .status(400)
        .json({ error: "Valid different target entry required" });
    const { rows } = await pool.query(
      "INSERT INTO diary_entry_links(source_entry_id,target_entry_id,created_by,label) VALUES($1,$2,$3,$4) ON CONFLICT(source_entry_id,target_entry_id) DO UPDATE SET label=EXCLUDED.label RETURNING *",
      [req.params.id, req.body.targetId, req.user.id, label || "related"],
    );
    await activity(
      access.journal_id,
      req.user.id,
      "linked_entry",
      req.params.id,
      { targetId: +req.body.targetId, label },
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});
app.get("/api/entries/:id/links", auth, async (req, res, next) => {
  try {
    const access = await entryAccess(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: "Entry not found" });
    const visibleLinkSql = `(e.user_id=$2 OR j.owner_id=$2 OR m.user_id=$2 OR e.visibility='public')`,
      outbound = await pool.query(
        `SELECT l.id,l.label,e.id AS entry_id,e.title,e.entry_date FROM diary_entry_links l JOIN diary_entries e ON e.id=l.target_entry_id JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$2 WHERE l.source_entry_id=$1 AND ${visibleLinkSql} ORDER BY e.entry_date DESC`,
        [req.params.id, req.user.id],
      ),
      backlinks = await pool.query(
        `SELECT l.id,l.label,e.id AS entry_id,e.title,e.entry_date FROM diary_entry_links l JOIN diary_entries e ON e.id=l.source_entry_id JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$2 WHERE l.target_entry_id=$1 AND ${visibleLinkSql} ORDER BY e.entry_date DESC`,
        [req.params.id, req.user.id],
      );
    res.json({ outbound: outbound.rows, backlinks: backlinks.rows });
  } catch (error) {
    next(error);
  }
});
app.delete("/api/entry-links/:id", auth, async (req, res, next) => {
  try {
    const found = await pool.query(
        "SELECT * FROM diary_entry_links WHERE id=$1",
        [req.params.id],
      ),
      link = found.rows[0],
      access = link && (await entryAccess(req.user.id, link.source_entry_id));
    if (!access?.can_manage)
      return res.status(403).json({ error: "Entry management required" });
    await pool.query("DELETE FROM diary_entry_links WHERE id=$1", [
      req.params.id,
    ]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.post("/api/collections", auth, async (req, res, next) => {
  try {
    const access = await writableJournal(req.user.id, req.body.journalId, [
        "owner",
        "editor",
      ]),
      name = String(req.body.name || "")
        .trim()
        .slice(0, 100),
      color = /^#[0-9a-f]{6}$/i.test(req.body.color)
        ? req.body.color
        : "#bb9af7";
    if (!access)
      return res.status(403).json({ error: "Journal editor required" });
    if (!name)
      return res.status(400).json({ error: "Collection name required" });
    const { rows } = await pool.query(
      "INSERT INTO diary_collections(journal_id,name,color,description,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [
        access.id,
        name,
        color,
        String(req.body.description || "").slice(0, 500),
        req.user.id,
      ],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === "23505")
      return res.status(409).json({ error: "That collection already exists" });
    next(error);
  }
});
app.post(
  "/api/collections/:id/entries/:entryId",
  auth,
  async (req, res, next) => {
    try {
      const collection = await pool.query(
          "SELECT * FROM diary_collections WHERE id=$1",
          [req.params.id],
        ),
        item = collection.rows[0],
        access = item && (await writableJournal(req.user.id, item.journal_id)),
        entryPermission = await entryAccess(req.user.id, req.params.entryId);
      if (
        !access ||
        !entryPermission?.can_manage ||
        +entryPermission.journal_id !== +item.journal_id
      )
        return res
          .status(403)
          .json({ error: "Collection and entry access required" });
      const removed = await pool.query(
        "DELETE FROM diary_collection_entries WHERE collection_id=$1 AND entry_id=$2",
        [req.params.id, req.params.entryId],
      );
      if (!removed.rowCount)
        await pool.query(
          "INSERT INTO diary_collection_entries(collection_id,entry_id,added_by) VALUES($1,$2,$3)",
          [req.params.id, req.params.entryId, req.user.id],
        );
      res.json({ active: !removed.rowCount });
    } catch (error) {
      next(error);
    }
  },
);
app.delete("/api/collections/:id", auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "DELETE FROM diary_collections c USING diary_journals j WHERE c.id=$1 AND j.id=c.journal_id AND (j.owner_id=$2 OR EXISTS(SELECT 1 FROM diary_journal_members m WHERE m.journal_id=j.id AND m.user_id=$2 AND m.role='editor'))",
      [req.params.id, req.user.id],
    );
    if (!result.rowCount)
      return res.status(404).json({ error: "Collection not found" });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.post("/api/entries", auth, async (req, res, next) => {
  try {
    const x = req.body,
      encrypted = x.encrypted === true,
      journalAccess = await writableJournal(req.user.id, x.journalId),
      journalId = journalAccess?.id;
    if (
      !x.date ||
      (encrypted
        ? !x.encryptedPayload?.ciphertext || !x.encryptedPayload?.iv
        : !x.body?.length && !x.media?.length)
    )
      return res.status(400).json({ error: "Date and content required" });
    if (!journalId)
      return res.status(400).json({ error: "Valid journal required" });
    const { rows } = await pool.query(
      `INSERT INTO diary_entries(user_id,entry_date,entry_time,title,body,tags,media,link,visibility,mood,location_name,latitude,longitude,pinned,journal_id,is_encrypted,encrypted_payload,reminder_at,weather) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [
        req.user.id,
        x.date,
        x.time || null,
        encrypted ? "Encrypted entry" : x.title || "Untitled",
        JSON.stringify(encrypted ? [] : x.body || []),
        JSON.stringify(encrypted ? [] : x.tags || []),
        JSON.stringify(x.media || []),
        encrypted ? "" : x.link || "",
        encrypted
          ? "private"
          : x.visibility === "public"
            ? "public"
            : "private",
        encrypted ? "" : x.mood || "",
        encrypted ? "" : x.location || "",
        encrypted ? null : x.latitude || null,
        encrypted ? null : x.longitude || null,
        !!x.pinned,
        journalId,
        encrypted,
        encrypted ? JSON.stringify(x.encryptedPayload) : null,
        x.reminderAt || null,
        x.weather || null,
      ],
    );
    await activity(journalId, req.user.id, "created_entry", rows[0].id, {
      title: rows[0].title,
    });
    await notifyJournalMembers(journalId, req.user.id, rows[0].id, "shared_entry_created");
    res
      .status(201)
      .json(entry({ ...rows[0], display_name: req.user.display_name }));
  } catch (e) {
    next(e);
  }
});
app.put("/api/entries/:id", auth, async (req, res, next) => {
  try {
    const x = req.body,
      encrypted = x.encrypted === true,
      currentEntry = await pool.query(
        "SELECT user_id FROM diary_entries WHERE id=$1",
        [req.params.id],
      ),
      ownsEntry = +currentEntry.rows[0]?.user_id === +req.user.id,
      journalAccess = await writableJournal(
        req.user.id,
        x.journalId,
        ownsEntry ? ["owner", "editor", "contributor"] : ["owner", "editor"],
      ),
      journalId = journalAccess?.id;
    if (
      !x.date ||
      (encrypted
        ? !x.encryptedPayload?.ciphertext || !x.encryptedPayload?.iv
        : !x.body?.length && !x.media?.length)
    )
      return res.status(400).json({ error: "Date and content required" });
    if (!journalId)
      return res.status(400).json({ error: "Valid journal required" });
    await pool.query(
      `INSERT INTO diary_entry_revisions(entry_id,user_id,snapshot) SELECT e.id,$2,to_jsonb(e) FROM diary_entries e JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$2 WHERE e.id=$1 AND (e.user_id=$2 OR j.owner_id=$2 OR m.role='editor')`,
      [req.params.id, req.user.id],
    );
    const { rows } = await pool.query(
      `UPDATE diary_entries e SET entry_date=$1,entry_time=$20,title=$2,body=$3,tags=$4,media=$5,link=$6,visibility=$7,mood=$8,location_name=$9,latitude=$10,longitude=$11,pinned=$12,journal_id=$13,is_encrypted=$16,encrypted_payload=$17,reminder_at=$18,weather=$19,updated_at=NOW() WHERE e.id=$14 AND (e.user_id=$15 OR EXISTS(SELECT 1 FROM diary_journals j LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$15 WHERE j.id=e.journal_id AND (j.owner_id=$15 OR m.role='editor'))) RETURNING e.*`,
      [
        x.date,
        encrypted ? "Encrypted entry" : x.title || "Untitled",
        JSON.stringify(encrypted ? [] : x.body || []),
        JSON.stringify(encrypted ? [] : x.tags || []),
        JSON.stringify(x.media || []),
        encrypted ? "" : x.link || "",
        encrypted
          ? "private"
          : x.visibility === "public"
            ? "public"
            : "private",
        encrypted ? "" : x.mood || "",
        encrypted ? "" : x.location || "",
        encrypted ? null : x.latitude || null,
        encrypted ? null : x.longitude || null,
        !!x.pinned,
        journalId,
        req.params.id,
        req.user.id,
        encrypted,
        encrypted ? JSON.stringify(x.encryptedPayload) : null,
        x.reminderAt || null,
        x.weather || null,
        x.time || null,
      ],
    );
    if (!rows[0]) return res.status(404).json({ error: "Entry not found" });
    await activity(
      rows[0].journal_id,
      req.user.id,
      "updated_entry",
      rows[0].id,
      {
        title: rows[0].title,
      },
    );
    await notifyJournalMembers(rows[0].journal_id, req.user.id, rows[0].id, "shared_entry_updated");
    res.json(entry({ ...rows[0], display_name: req.user.display_name }));
  } catch (e) {
    next(e);
  }
});
app.delete("/api/entries/:id", auth, async (req, res, next) => {
  try {
    const x = await pool.query(
      `UPDATE diary_entries e SET deleted_at=NOW(),updated_at=NOW() WHERE e.id=$1 AND e.deleted_at IS NULL AND (e.user_id=$2 OR EXISTS(SELECT 1 FROM diary_journals j LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$2 WHERE j.id=e.journal_id AND (j.owner_id=$2 OR m.role='editor'))) RETURNING e.journal_id,e.title`,
      [req.params.id, req.user.id],
    );
    if (!x.rowCount) return res.status(404).json({ error: "Not found" });
    await activity(
      x.rows[0].journal_id,
      req.user.id,
      "trashed_entry",
      req.params.id,
      {
        title: x.rows[0].title,
      },
    );
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
app.get("/api/trash", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,u.display_name,true AS owner FROM diary_entries e JOIN diary_users u ON u.id=e.user_id JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$1 WHERE e.deleted_at IS NOT NULL AND (e.user_id=$1 OR j.owner_id=$1 OR m.role='editor') ORDER BY e.deleted_at DESC`,
      [req.user.id],
    );
    res.json(rows.map(entry));
  } catch (e) {
    next(e);
  }
});
app.post("/api/entries/:id/restore", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE diary_entries e SET deleted_at=NULL,updated_at=NOW() WHERE e.id=$1 AND (e.user_id=$2 OR EXISTS(SELECT 1 FROM diary_journals j LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$2 WHERE j.id=e.journal_id AND (j.owner_id=$2 OR m.role='editor'))) RETURNING e.*`,
      [req.params.id, req.user.id],
    );
    rows[0]
      ? res.json(entry({ ...rows[0], display_name: req.user.display_name }))
      : res.status(404).json({ error: "Entry not found" });
  } catch (e) {
    next(e);
  }
});
app.delete("/api/entries/:id/permanent", auth, async (req, res, next) => {
  try {
    const x = await pool.query(
      `DELETE FROM diary_entries e WHERE e.id=$1 AND e.deleted_at IS NOT NULL AND (e.user_id=$2 OR EXISTS(SELECT 1 FROM diary_journals j LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$2 WHERE j.id=e.journal_id AND (j.owner_id=$2 OR m.role='editor')))`,
      [req.params.id, req.user.id],
    );
    x.rowCount
      ? res.status(204).end()
      : res.status(404).json({ error: "Entry not found" });
  } catch (e) {
    next(e);
  }
});
app.get("/api/entries/:id/revisions", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id,r.created_at,r.snapshot->>'title' AS title FROM diary_entry_revisions r JOIN diary_entries e ON e.id=r.entry_id JOIN diary_journals j ON j.id=e.journal_id LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$2 WHERE r.entry_id=$1 AND (e.user_id=$2 OR j.owner_id=$2 OR m.role='editor') ORDER BY r.created_at DESC`,
      [req.params.id, req.user.id],
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});
app.post(
  "/api/entries/:id/revisions/:revisionId/restore",
  auth,
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT e.* FROM diary_entries e WHERE e.id=$1 AND (e.user_id=$2 OR EXISTS(SELECT 1 FROM diary_journals j LEFT JOIN diary_journal_members m ON m.journal_id=j.id AND m.user_id=$2 WHERE j.id=e.journal_id AND (j.owner_id=$2 OR m.role='editor'))) FOR UPDATE`,
        [req.params.id, req.user.id],
      );
      if (!current.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Entry not found" });
      }
      const revision = await client.query(
        "SELECT snapshot FROM diary_entry_revisions WHERE id=$1 AND entry_id=$2",
        [req.params.revisionId, req.params.id],
      );
      if (!revision.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Revision not found" });
      }
      await client.query(
        "INSERT INTO diary_entry_revisions(entry_id,user_id,snapshot) VALUES($1,$2,$3)",
        [req.params.id, req.user.id, current.rows[0]],
      );
      const s = revision.rows[0].snapshot;
      const { rows } = await client.query(
        `UPDATE diary_entries SET entry_date=$1,title=$2,body=$3,tags=$4,media=$5,link=$6,visibility=$7,mood=$8,location_name=$9,latitude=$10,longitude=$11,pinned=$12,journal_id=$13,deleted_at=NULL,updated_at=NOW() WHERE id=$14 RETURNING *`,
        [
          s.entry_date,
          s.title,
          s.body,
          s.tags,
          s.media,
          s.link,
          s.visibility,
          s.mood,
          s.location_name,
          s.latitude,
          s.longitude,
          s.pinned,
          s.journal_id || current.rows[0].journal_id,
          req.params.id,
        ],
      );
      await client.query("COMMIT");
      res.json(entry({ ...rows[0], display_name: req.user.display_name }));
    } catch (e) {
      await client.query("ROLLBACK");
      next(e);
    } finally {
      client.release();
    }
  },
);
async function ownedEntries(userId) {
  const { rows } = await pool.query(
    "SELECT e.*,u.display_name,true AS owner FROM diary_entries e JOIN diary_users u ON u.id=e.user_id WHERE e.user_id=$1 AND e.deleted_at IS NULL ORDER BY e.entry_date DESC,e.created_at DESC",
    [userId],
  );
  return rows;
}
async function completeUserExport(userId) {
  const queries = {
    profile:
      "SELECT id,username,email,display_name,bio,email_verified_at,two_factor_enabled,is_admin,disabled_at,self_deactivated,deletion_requested_at,deletion_scheduled_for,created_at FROM diary_users WHERE id=$1",
    journals: "SELECT * FROM diary_journals WHERE owner_id=$1 ORDER BY id",
    memberships:
      "SELECT m.*,j.name AS journal_name,j.owner_id FROM diary_journal_members m JOIN diary_journals j ON j.id=m.journal_id WHERE m.user_id=$1 ORDER BY m.journal_id",
    invitations:
      "SELECT id,journal_id,email,role,expires_at,accepted_at,created_at FROM diary_journal_invitations WHERE invited_by=$1 ORDER BY id",
    entries: "SELECT * FROM diary_entries WHERE user_id=$1 ORDER BY id",
    revisions:
      "SELECT * FROM diary_entry_revisions WHERE user_id=$1 ORDER BY id",
    comments: "SELECT * FROM diary_comments WHERE user_id=$1 ORDER BY id",
    reactions: "SELECT * FROM diary_reactions WHERE user_id=$1 ORDER BY id",
    activity: "SELECT * FROM diary_activity WHERE actor_id=$1 ORDER BY id",
    notifications:
      "SELECT * FROM diary_notifications WHERE user_id=$1 ORDER BY id",
    publicLinks:
      "SELECT id,entry_id,expires_at,revoked_at,view_count,created_at,last_viewed_at,(password_hash IS NOT NULL) AS password_protected FROM diary_public_links WHERE created_by=$1 ORDER BY id",
    entryLinks:
      "SELECT * FROM diary_entry_links WHERE created_by=$1 ORDER BY id",
    people: "SELECT * FROM diary_people WHERE owner_id=$1 ORDER BY id",
    entryPeople:
      "SELECT * FROM diary_entry_people WHERE created_by=$1 ORDER BY entry_id,person_id",
    collections:
      "SELECT * FROM diary_collections WHERE created_by=$1 ORDER BY id",
    collectionEntries:
      "SELECT * FROM diary_collection_entries WHERE added_by=$1 ORDER BY collection_id,entry_id",
    passkeys:
      "SELECT id,name,device_type,backed_up,transports,created_at,last_used_at FROM diary_passkeys WHERE user_id=$1 ORDER BY id",
    sessions:
      "SELECT id,created_at,last_seen_at,ip_address,user_agent,expires_at FROM diary_sessions WHERE user_id=$1 ORDER BY created_at",
    loginHistory:
      "SELECT id,identifier,success,method,ip_address,user_agent,created_at FROM diary_login_history WHERE user_id=$1 ORDER BY id",
    personalBackups:
      "SELECT id,bytes,created_at FROM diary_user_backups WHERE user_id=$1 ORDER BY created_at",
    registrationInvites:
      "SELECT id,max_uses,use_count,expires_at,created_at FROM diary_registration_invites WHERE created_by=$1 ORDER BY id",
  };
  const results = await Promise.all(
    Object.entries(queries).map(async ([name, sql]) => [
      name,
      (await pool.query(sql, [userId])).rows,
    ]),
  );
  const data = Object.fromEntries(results);
  data.profile = data.profile[0];
  return {
    format: "field-log-complete-account",
    version: 1,
    exportedAt: new Date().toISOString(),
    ...data,
  };
}
app.get("/api/export/json", auth, async (req, res, next) => {
  try {
    const exported = await completeUserExport(req.user.id);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=field-log-${new Date().toISOString().slice(0, 10)}.json`,
    );
    res.json(exported);
  } catch (e) {
    next(e);
  }
});
app.get("/api/export/pdf", auth, async (req, res, next) => {
  try {
    const rows = await ownedEntries(req.user.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=field-log-${new Date().toISOString().slice(0, 10)}.pdf`,
    );
    const doc = new PDFDocument({ margin: 54, bufferPages: true });
    doc.pipe(res);
    doc
      .fontSize(24)
      .text("DAYMARK")
      .fontSize(10)
      .fillColor("#666")
      .text(`Exported ${new Date().toLocaleString()}`)
      .moveDown(2);
    for (const r of rows) {
      doc
        .fillColor("#111")
        .fontSize(16)
        .text(r.title)
        .fontSize(9)
        .fillColor("#666")
        .text(
          `${r.entry_date instanceof Date ? r.entry_date.toISOString().slice(0, 10) : String(r.entry_date).slice(0, 10)} / ${(r.tags || []).join(", ")}`,
        )
        .moveDown(0.5)
        .fontSize(11)
        .fillColor("#222")
        .text((r.body || []).join("\n\n"), { lineGap: 3 })
        .moveDown(2);
      if (doc.y > 700) doc.addPage();
    }
    doc.end();
  } catch (e) {
    next(e);
  }
});
app.get("/api/export/zip", auth, async (req, res, next) => {
  try {
    const rows = await ownedEntries(req.user.id),
      exported = await completeUserExport(req.user.id);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=field-log-${new Date().toISOString().slice(0, 10)}.zip`,
    );
    const zip = new ZipArchive({ zlib: { level: 9 } });
    zip.on("error", next);
    zip.pipe(res);
    zip.append(JSON.stringify(exported, null, 2), { name: "field-log.json" });
    for (const r of rows) {
      const date =
          r.entry_date instanceof Date
            ? r.entry_date.toISOString().slice(0, 10)
            : String(r.entry_date).slice(0, 10),
        safe = `${date}-${r.id}-${r.title}`
          .replace(/[^a-z0-9._-]+/gi, "-")
          .slice(0, 100);
      zip.append(
        `# ${r.title}\n\n${date}\n\n${(r.body || []).join("\n\n")}\n\n${(r.tags || []).map((t) => `#${t}`).join(" ")}\n`,
        { name: `entries/${safe}.md` },
      );
      for (const [i, m] of (r.media || []).entries()) {
        if (!m.key) continue;
        try {
          zip.append(await mediaStore.getObject(mediaBucket, m.key), {
            name: `media/${r.id}/${i}-${String(m.name || "attachment").replace(/[\\/]/g, "-")}`,
          });
        } catch {}
      }
    }
    await zip.finalize();
  } catch (e) {
    next(e);
  }
});
async function appendUserBackup(zip, userId) {
  const rows = await ownedEntries(userId),
    exported = await completeUserExport(userId);
  zip.append(JSON.stringify(exported, null, 2), { name: "field-log.json" });
  for (const row of rows) {
    const date = row.entry_date instanceof Date
        ? row.entry_date.toISOString().slice(0, 10)
        : String(row.entry_date).slice(0, 10),
      safe = `${date}-${row.id}-${row.title}`
        .replace(/[^a-z0-9._-]+/gi, "-")
        .slice(0, 100);
    zip.append(
      `# ${row.title}\n\n${date}\n\n${(row.body || []).join("\n\n")}\n\n${(row.tags || []).map((tag) => `#${tag}`).join(" ")}\n`,
      { name: `entries/${safe}.md` },
    );
    for (const [index, media] of (row.media || []).entries()) {
      if (!media.key) continue;
      try {
        zip.append(await mediaStore.getObject(mediaBucket, media.key), {
          name: `media/${row.id}/${index}-${String(media.name || "attachment").replace(/[\\/]/g, "-")}`,
        });
      } catch {}
    }
  }
}
app.get("/api/user-backups", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id,bytes,created_at FROM diary_user_backups WHERE user_id=$1 ORDER BY created_at DESC",
      [req.user.id],
    );
    res.json(rows);
  } catch (error) { next(error); }
});
app.post("/api/user-backups", auth, async (req, res, next) => {
  const id = crypto.randomUUID(),
    fileName = `user-${req.user.id}-${id}.zip`,
    target = path.join(backupPath, fileName);
  try {
    await mkdir(backupPath, { recursive: true });
    await new Promise(async (resolve, reject) => {
      const output = createWriteStream(target),
        zip = new ZipArchive({ zlib: { level: 9 } });
      output.on("close", resolve);
      output.on("error", reject);
      zip.on("error", reject);
      zip.pipe(output);
      try {
        await appendUserBackup(zip, req.user.id);
        await zip.finalize();
      } catch (error) { reject(error); }
    });
    const information = await stat(target);
    const { rows } = await pool.query(
      "INSERT INTO diary_user_backups(id,user_id,file_name,bytes) VALUES($1,$2,$3,$4) RETURNING id,bytes,created_at",
      [id, req.user.id, fileName, information.size],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    await unlink(target).catch(() => {});
    next(error);
  }
});
app.get("/api/user-backups/:id/download", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT file_name FROM diary_user_backups WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Backup not found" });
    res.download(path.join(backupPath, path.basename(rows[0].file_name)), `diary-backup-${req.params.id}.zip`);
  } catch (error) { next(error); }
});
app.delete("/api/user-backups/:id", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM diary_user_backups WHERE id=$1 AND user_id=$2 RETURNING file_name",
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Backup not found" });
    await unlink(path.join(backupPath, path.basename(rows[0].file_name))).catch(() => {});
    res.status(204).end();
  } catch (error) { next(error); }
});
app.get("/api/account/lifecycle", auth, async (req, res, next) => {
  try {
    const [account, journals] = await Promise.all([
      pool.query("SELECT deletion_requested_at,deletion_scheduled_for FROM diary_users WHERE id=$1", [req.user.id]),
      pool.query("SELECT id,name FROM diary_journals WHERE owner_id=$1 ORDER BY is_default DESC,name", [req.user.id]),
    ]);
    res.json({ ...account.rows[0], journals: journals.rows });
  } catch (error) { next(error); }
});
app.post("/api/account/deactivate", auth, async (req, res, next) => {
  try {
    const current = await pool.query("SELECT password_hash,is_admin FROM diary_users WHERE id=$1", [req.user.id]);
    if (!(await verify(req.body.password || "", current.rows[0].password_hash)))
      return res.status(401).json({ error: "Current password is incorrect" });
    if (current.rows[0].is_admin) {
      const admins = await pool.query("SELECT count(*)::int AS count FROM diary_users WHERE is_admin AND disabled_at IS NULL");
      if (admins.rows[0].count <= 1) return res.status(409).json({ error: "Promote another administrator before deactivating" });
    }
    await pool.query("UPDATE diary_users SET disabled_at=NOW(),self_deactivated=true WHERE id=$1", [req.user.id]);
    await pool.query("DELETE FROM diary_sessions WHERE user_id=$1", [req.user.id]);
    res.clearCookie("diary_session", { path: "/" });
    res.json({ deactivated: true });
  } catch (error) { next(error); }
});
app.post("/api/account/transfer", auth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const target = await client.query("SELECT id,username FROM diary_users WHERE username=lower($1) AND disabled_at IS NULL", [String(req.body.username || "")]);
    if (!target.rows.length || +target.rows[0].id === +req.user.id)
      return res.status(400).json({ error: "Choose another active account" });
    const journalId = req.body.journalId === "all" ? null : Number(req.body.journalId);
    await client.query("BEGIN");
    const transferred = await client.query(
      `UPDATE diary_journals SET owner_id=$1,is_default=false WHERE owner_id=$2 ${journalId ? "AND id=$3" : ""} RETURNING id`,
      journalId ? [target.rows[0].id, req.user.id, journalId] : [target.rows[0].id, req.user.id],
    );
    if (!transferred.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Owned journal not found" }); }
    await client.query("DELETE FROM diary_journal_members WHERE user_id=$1 AND journal_id=ANY($2::bigint[])", [target.rows[0].id, transferred.rows.map((row) => row.id)]);
    for (const journal of transferred.rows)
      await client.query("INSERT INTO diary_journal_members(journal_id,user_id,role) VALUES($1,$2,'editor') ON CONFLICT(journal_id,user_id) DO UPDATE SET role='editor'", [journal.id, req.user.id]);
    await client.query("COMMIT");
    res.json({ transferred: transferred.rowCount, owner: target.rows[0].username });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); next(error); }
  finally { client.release(); }
});
app.post("/api/account/deletion", auth, async (req, res, next) => {
  try {
    const current = await pool.query("SELECT password_hash,is_admin FROM diary_users WHERE id=$1", [req.user.id]);
    if (!(await verify(req.body.password || "", current.rows[0].password_hash)))
      return res.status(401).json({ error: "Current password is incorrect" });
    if (current.rows[0].is_admin) {
      const admins = await pool.query("SELECT count(*)::int AS count FROM diary_users WHERE is_admin AND disabled_at IS NULL AND deletion_scheduled_for IS NULL");
      if (admins.rows[0].count <= 1) return res.status(409).json({ error: "Promote another administrator before scheduling deletion" });
    }
    const { rows } = await pool.query("UPDATE diary_users SET deletion_requested_at=NOW(),deletion_scheduled_for=NOW()+INTERVAL '30 days' WHERE id=$1 RETURNING deletion_scheduled_for", [req.user.id]);
    res.json(rows[0]);
  } catch (error) { next(error); }
});
app.delete("/api/account/deletion", auth, async (req, res, next) => {
  try {
    await pool.query("UPDATE diary_users SET deletion_requested_at=NULL,deletion_scheduled_for=NULL WHERE id=$1", [req.user.id]);
    res.status(204).end();
  } catch (error) { next(error); }
});
app.get("/api/security/login-history.csv", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT success,method,ip_address,user_agent,created_at FROM diary_login_history WHERE user_id=$1 ORDER BY created_at DESC", [req.user.id]);
    const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=account-security-activity.csv");
    res.send(["success,method,ip_address,user_agent,created_at", ...rows.map((row) => [row.success, row.method, row.ip_address, row.user_agent, row.created_at.toISOString()].map(quote).join(","))].join("\n"));
  } catch (error) { next(error); }
});
app.delete("/api/account", auth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (req.body.username !== req.user.username)
      return res.status(400).json({ error: "Enter your username exactly" });
    const current = await client.query(
      "SELECT password_hash,is_admin FROM diary_users WHERE id=$1",
      [req.user.id],
    );
    if (!(await verify(req.body.password || "", current.rows[0].password_hash)))
      return res.status(401).json({ error: "Current password is incorrect" });
    await client.query("BEGIN");
    if (current.rows[0].is_admin) {
      const admins = await client.query(
        "SELECT id FROM diary_users WHERE is_admin AND disabled_at IS NULL FOR SHARE",
      );
      if (admins.rowCount <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Promote another administrator before deleting this account",
        });
      }
    }
    await client.query(
      "DELETE FROM diary_entries WHERE user_id=$1 OR journal_id IN (SELECT id FROM diary_journals WHERE owner_id=$1)",
      [req.user.id],
    );
    await client.query("DELETE FROM diary_users WHERE id=$1", [req.user.id]);
    await client.query("COMMIT");
    const keys = [];
    for await (const object of mediaStore.listObjectsV2(
      mediaBucket,
      `${req.user.id}/`,
      true,
    ))
      keys.push(object.name);
    if (keys.length) await mediaStore.removeObjects(mediaBucket, keys);
    res.clearCookie("diary_session", { path: "/" });
    res.json({ deleted: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});
app.post(
  "/api/import/json",
  auth,
  upload.single("file"),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      if (!req.file)
        return res
          .status(400)
          .json({ error: "JSON or Markdown file required" });
      const text = req.file.buffer.toString("utf8");
      let items;
      if (/\.md$/i.test(req.file.originalname)) {
        const lines = text.split(/\r?\n/),
          title = (
            lines.find((l) => /^#\s+/.test(l)) || "# Imported note"
          ).replace(/^#\s+/, ""),
          date =
            (text.match(/\b\d{4}-\d{2}-\d{2}\b/) || [])[0] ||
            new Date().toISOString().slice(0, 10),
          tags = [...text.matchAll(/(?:^|\s)#([\w-]+)/g)].map((m) => m[1]);
        items = [
          {
            title,
            date,
            tags,
            body: text
              .replace(/^#\s+.*$/m, "")
              .replace(date, "")
              .trim()
              .split(/\n\s*\n/),
          },
        ];
      } else {
        const data = JSON.parse(text);
        items = Array.isArray(data) ? data : data.entries;
      }
      if (!Array.isArray(items) || items.length > 10000)
        return res.status(400).json({ error: "Invalid Daymark import" });
      const defaultJournal = await writableJournal(req.user.id, null);
      await client.query("BEGIN");
      let imported = 0;
      for (const x of items) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date || "")) continue;
        await client.query(
          `INSERT INTO diary_entries(user_id,entry_date,title,body,tags,media,link,visibility,mood,location_name,latitude,longitude,pinned,journal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            req.user.id,
            x.date,
            x.title || "Untitled",
            JSON.stringify(Array.isArray(x.body) ? x.body : []),
            JSON.stringify(Array.isArray(x.tags) ? x.tags : []),
            JSON.stringify(
              Array.isArray(x.media)
                ? x.media.filter((m) => String(m.url || "").startsWith("data:"))
                : [],
            ),
            x.link || "",
            "private",
            x.mood || "",
            x.location || "",
            x.latitude || null,
            x.longitude || null,
            !!x.pinned,
            defaultJournal?.id,
          ],
        );
        imported++;
      }
      await client.query("COMMIT");
      res.status(201).json({ imported });
    } catch (e) {
      await client.query("ROLLBACK");
      if (e instanceof SyntaxError)
        return res.status(400).json({ error: "Invalid JSON" });
      next(e);
    } finally {
      client.release();
    }
  },
);
app.use(express.static(path.join(root, "dist"), { maxAge: "1d" }));
app.get("*all", (_q, r) => r.sendFile(path.join(root, "dist", "index.html")));
app.use((e, _q, r, _n) => {
  console.error(e);
  r.status(500).json({ error: "Internal server error" });
});
async function purgeScheduledAccounts() {
  const { rows } = await pool.query("SELECT id FROM diary_users WHERE deletion_scheduled_for IS NOT NULL AND deletion_scheduled_for<=NOW()");
  for (const user of rows) {
    const backups = await pool.query("SELECT file_name FROM diary_user_backups WHERE user_id=$1", [user.id]);
    await pool.query("DELETE FROM diary_users WHERE id=$1", [user.id]);
    const keys = [];
    for await (const object of mediaStore.listObjectsV2(mediaBucket, `${user.id}/`, true)) keys.push(object.name);
    if (keys.length) await mediaStore.removeObjects(mediaBucket, keys);
    for (const backup of backups.rows) await unlink(path.join(backupPath, path.basename(backup.file_name))).catch(() => {});
  }
}
migrate()
  .then(() => {
    app.listen(port, "0.0.0.0", () => console.log(`Daymark listening on :${port}`));
    deliverNotificationEmails().catch((error) => console.error(error));
    setInterval(() => deliverNotificationEmails().catch((error) => console.error(error)), 60000).unref();
    purgeScheduledAccounts().catch((error) => console.error(error));
    setInterval(() => purgeScheduledAccounts().catch((error) => console.error(error)), 3600000).unref();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
