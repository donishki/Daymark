import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import exifr from "exifr";
import { createWorker } from "tesseract.js";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import {
  Search,
  Plus,
  X,
  Paperclip,
  ChevronLeft,
  ChevronRight,
  Menu,
  MapPin,
  Pin,
  LogOut,
  Pencil,
  Trash2,
  RotateCcw,
  History,
  Download,
  Upload,
  Bold,
  Italic,
  Heading,
  List,
  ListChecks,
  Quote,
  Code,
  Link2,
  Eye,
  Maximize2,
  Minimize2,
  CalendarDays,
  Images,
  Rows3,
  MapPinned,
  SlidersHorizontal,
  BarChart3,
  BookOpen,
  Settings,
  ArrowUp,
  ArrowDown,
  MessageSquare,
  Bell,
  Activity,
  Network,
  UserRound,
  FolderOpen,
  ShieldCheck,
  KeyRound,
  Users,
  LockKeyhole,
  Camera,
  Mic,
  Square,
  HardDrive,
  Archive,
  ThumbsUp,
  Share2,
  Copy,
  Mail,
  Send,
} from "lucide-react";
import "./styles.css";
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, options = {}) => {
  const method = String(options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = document.cookie
      .split(";")
      .map((item) => item.trim().split("="))
      .find(([name]) => name === "field_log_csrf")?.[1];
    if (csrf) {
      const headers = new Headers(options.headers || {});
      headers.set("X-CSRF-Token", csrf);
      options = { ...options, headers };
    }
  }
  return nativeFetch(input, options);
};
const bytesToBase64 = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));
const base64ToBytes = (value) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
async function vaultKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function encryptEntryPayload(value, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    key = await vaultKey(passphrase, salt),
    ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(value)),
    );
  return {
    algorithm: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: 310000,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };
}
async function decryptEntryPayload(payload, passphrase) {
  const key = await vaultKey(passphrase, base64ToBytes(payload.salt)),
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
      key,
      base64ToBytes(payload.ciphertext),
    );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
const starter = [
  {
    id: 1,
    date: "2025-06-21",
    title: "The longest light",
    tags: ["garden", "life"],
    body: [
      `The sun stayed in the kitchen long after dinner, gilding the jam jars and every speck of flour on the counter. I left the back door open and listened to the blackbirds trade their last few notes across the roofs.`,
      `There was nowhere to be. That felt, for once, less like an absence and more like a gift. I watered the tomatoes, tied up the tallest one, and found the first small green fruit hiding beneath a leaf.`,
      `A day doesn’t need to announce itself to be remembered. Sometimes it is enough that the light was kind, the coffee was strong, and everyone you love got home safely.`,
    ],
    media: [],
  },
  {
    id: 2,
    date: "2025-06-18",
    title: "Rain on the workshop roof",
    tags: ["making", "weather"],
    body: [
      `A proper northern rain arrived before lunch and drummed on the zinc roof until every other sound disappeared. The kind of rain that gives you permission to stay exactly where you are.`,
      `I sharpened the old plane and finally fitted the drawer that has been waiting on the bench since April. It still catches slightly on the left, but I’ve decided that perfection is mostly a very elegant form of procrastination.`,
    ],
    media: [],
  },
  {
    id: 3,
    date: "2025-06-12",
    title: "Train south, window seat",
    tags: ["travel", "observations"],
    body: [
      `Fields flickered past in green and yellow strips. Every small station offered a life I could almost imagine: the red bicycle by the ticket machine, two cups left on a café table, a dog waiting patiently at a crossing.`,
      `Across the aisle, a boy was explaining the entire solar system to his grandmother with the aid of a bread roll and three grapes. Saturn was eaten somewhere after Hanover.`,
    ],
    media: [],
  },
  {
    id: 4,
    date: "2025-05-30",
    title: "Things planted, things repaired",
    tags: ["garden", "making"],
    body: [
      `The basil has taken over the sill, which is exactly the sort of quiet ambition I admire. I moved half of it outside and gave the rest to Marta next door.`,
      `Replaced the loose hinge on the garden gate, oiled the handle, and stood back with the disproportionate satisfaction that follows a five-minute repair postponed for six months.`,
    ],
    media: [],
  },
];
const fd = (d, o) =>
  new Intl.DateTimeFormat("en-GB", o).format(new Date(d + "T12:00:00"));
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const writingPrompts = [
  "What small detail from today would otherwise be forgotten?",
  "What surprised you, and why?",
  "Describe one conversation exactly as you remember it.",
  "What changed between the start and end of today?",
  "Write about a sound, smell, or texture you noticed.",
  "What are you carrying forward into tomorrow?",
];
function App() {
  const initialParameters = new URLSearchParams(location.search),
    requestedYear = +initialParameters.get("year"),
    requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(initialParameters.get("date") || "") ? initialParameters.get("date") : "",
    [entries, setEntries] = useState([]),
    [siteSettings, setSiteSettings] = useState({
      site_name: "Daymark",
      site_tagline: "A private record of days, places, people, and ideas.",
      site_notice: "NOTES FROM HOME AND AWAY",
      footer_text: "WORDS, IMAGES & OTHER EVIDENCE",
      maintenance_active: false,
    }),
    [siteReady, setSiteReady] = useState(false),
    [maintenanceBypass, setMaintenanceBypass] = useState(false),
    [user, setUser] = useState(null),
    [preferences, setPreferences] = useState(null),
    [journals, setJournals] = useState([]),
    [journalFilter, setJournalFilter] = useState("all"),
    [shareEntry, setShareEntry] = useState(null),
    [authReady, setAuthReady] = useState(false),
    [q, setQ] = useState(""),
    [tag, setTag] = useState(initialParameters.get("tag") || "all"),
    [filters, setFilters] = useState({}),
    [timelineDate, setTimelineDate] = useState(requestedDate),
    [searchResults, setSearchResults] = useState(null),
    [filtersOpen, setFiltersOpen] = useState(false),
    [peek, setPeek] = useState(null),
    [uploadProgress, setUploadProgress] = useState(0),
    [compose, setCompose] = useState(false),
    [editing, setEditing] = useState(null),
    [deleting, setDeleting] = useState(null),
    [history, setHistory] = useState(null),
    [view, setView] = useState(
      ["diary", "calendar", "timeline", "gallery", "map", "stats"].includes(new URLSearchParams(location.search).get("view")) ? new URLSearchParams(location.search).get("view") : "diary",
    ),
    [selectedYear, setSelectedYear] = useState(
      Number.isInteger(requestedYear) && requestedYear > 1900
        ? requestedYear
        : new Date().getFullYear(),
    ),
    [side, setSide] = useState(false);
  useEffect(() => {
    fetch("/api/site-settings")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((settings) => {
        setSiteSettings(settings);
        document.title = settings.site_name;
      })
      .catch(() => {})
      .finally(() => setSiteReady(true));
  }, []);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((u) => {
        setUser(u);
        return Promise.all([
          fetch("/api/entries").then((response) => response.json()),
          fetch("/api/journals").then((response) => response.json()),
          fetch("/api/preferences").then((response) => response.json()),
        ]);
      })
      .then(([data, journalData, preferenceData]) => {
        setEntries(data);
        setJournals(journalData);
        setPreferences(preferenceData);
        if (!new URLSearchParams(location.search).has("view"))
          setView(["diary", "calendar", "timeline", "gallery", "map", "stats"].includes(preferenceData.defaultView) ? preferenceData.defaultView : "diary");
        if (data[0] && !requestedYear)
          setSelectedYear(+data[0].date.slice(0, 4));
      })
      .catch(() => {})
      .finally(() => setAuthReady(true));
  }, []);
  useEffect(() => {
    if (!preferences) return;
    const root = document.documentElement;
    root.dataset.theme = preferences.theme || "tokyo-night";
    root.dataset.density = preferences.density || "comfortable";
    root.classList.toggle("reduce-motion", !!preferences.reduceMotion);
    root.classList.toggle("compact-entries", !!preferences.compactEntries);
    root.style.zoom = String(1.1 * ((Number(preferences.fontScale) || 100) / 100));
    root.style.setProperty("--user-accent", preferences.accentColor || "#7aa2f7");
    const safeHeader = String(preferences.headerImage || "").replace(/["\\\n\r]/g, "");
    root.style.setProperty("--diary-header-image", safeHeader ? `url("${safeHeader}")` : "none");
  }, [preferences]);
  useEffect(() => {
    if (!user) return;
    const parameters = new URLSearchParams(location.search);
    if (parameters.has("new") || parameters.has("share")) setCompose(true);
    const flushOutbox = async () => {
      const key = `field-log:outbox:${user.id}`,
        queued = JSON.parse(localStorage.getItem(key) || "[]"),
        remaining = [];
      for (const item of queued) {
        try {
          const response = await fetch(item.url, {
            method: item.method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item.draft),
          });
          if (!response.ok) remaining.push(item);
        } catch {
          remaining.push(item);
        }
      }
      localStorage.setItem(key, JSON.stringify(remaining));
      if (queued.length && !remaining.length) {
        const refreshed = await fetch("/api/entries");
        if (refreshed.ok) setEntries(await refreshed.json());
      }
    };
    flushOutbox();
    window.addEventListener("online", flushOutbox);
    return () => window.removeEventListener("online", flushOutbox);
  }, [user]);
  useEffect(() => {
    if (!user || !("Notification" in window)) return;
    const timers = entries
      .filter((item) => item.reminderAt)
      .map((item) => {
        const key = `field-log:reminded:${item.id}:${item.reminderAt}`,
          delay = new Date(item.reminderAt).getTime() - Date.now();
        if (localStorage.getItem(key) || delay < 0 || delay > 2147483647)
          return null;
        return setTimeout(async () => {
          localStorage.setItem(key, "1");
          const options = {
            body:
              item.encrypted && !item._decrypted
                ? "Encrypted entry reminder"
                : item.title,
            icon: "/field-log-icon.svg",
            tag: `field-log-${item.id}`,
          };
          if (navigator.serviceWorker?.controller)
            (await navigator.serviceWorker.ready).showNotification(
              "DAYMARK REMINDER",
              options,
            );
          else new Notification("DAYMARK REMINDER", options);
        }, delay);
      })
      .filter(Boolean);
    return () => timers.forEach(clearTimeout);
  }, [entries, user]);
  useEffect(() => {
    if (!user || !preferences?.recurringPromptTime || !preferences?.recurringPromptDays?.length) return;
    const check = () => {
      const now = new Date(), day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()], time = now.toTimeString().slice(0, 5), key = `field-log:prompt:${user.id}:${now.toISOString().slice(0, 10)}`;
      if (preferences.recurringPromptDays.includes(day) && time === preferences.recurringPromptTime && !localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        const body = (preferences.customPrompts || [])[0] || writingPrompts[Math.floor(Math.random() * writingPrompts.length)];
        if ("Notification" in window && Notification.permission === "granted") new Notification("DIARY WRITING PROMPT", { body, icon: "/field-log-icon.svg" });
      }
    };
    check();
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, [user, preferences]);
  useEffect(() => {
    if (!user || !preferences?.notificationBrowser || !("Notification" in window) || Notification.permission !== "granted") return;
    const quiet = () => {
      const start = preferences.quietHoursStart, end = preferences.quietHoursEnd;
      if (!start || !end || start === end) return false;
      const now = new Date().toTimeString().slice(0, 5);
      return start < end ? now >= start && now < end : now >= start || now < end;
    };
    const deliver = async () => {
      if (quiet()) return;
      const response = await fetch("/api/notifications?channel=browser&unread=1");
      if (!response.ok) return;
      const items = await response.json(), key = `field-log:browser-notifications:${user.id}`, delivered = new Set(JSON.parse(localStorage.getItem(key) || "[]"));
      for (const item of items.reverse()) {
        if (delivered.has(item.id)) continue;
        const action = item.type === "reply" ? "replied to your comment" : item.type === "comment" ? "commented on your entry" : item.type.startsWith("security_") ? item.type.replaceAll("_", " ") : item.type.startsWith("shared_entry") ? item.type.replaceAll("_", " ") : "mentioned you";
        new Notification("DAYMARK", { body: `${item.actor || "Security"} ${action}${item.entry_title ? `: ${item.entry_title}` : ""}`, icon: "/field-log-icon.svg", tag: `diary-notification-${item.id}` });
        delivered.add(item.id);
      }
      localStorage.setItem(key, JSON.stringify([...delivered].slice(-200)));
    };
    deliver();
    const timer = setInterval(deliver, 60000);
    return () => clearInterval(timer);
  }, [user, preferences]);
  useEffect(() => {
    const match = location.pathname.match(/^\/invite\/([^/]+)$/);
    if (!user || !match) return;
    fetch(`/api/invitations/${encodeURIComponent(match[1])}/accept`, {
      method: "POST",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        window.history.replaceState(null, "", "/");
        alert(`Joined “${data.journalName}” as ${data.role}.`);
        location.reload();
      })
      .catch((error) => {
        window.history.replaceState(null, "", "/");
        alert(error.message || "Could not accept invitation");
      });
  }, [user]);
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (tag !== "all") params.set("tag", tag);
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    if (![...params].length) {
      setSearchResults(null);
      return;
    }
    const controller = new AbortController(),
      timer = setTimeout(() => {
        fetch(`/api/search?${params}`, { signal: controller.signal })
          .then((response) =>
            response.ok ? response.json() : Promise.reject(),
          )
          .then(setSearchResults)
          .catch(
            (error) => error.name !== "AbortError" && setSearchResults([]),
          );
      }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [user, q, tag, filters]);
  const tags = [...new Set(entries.flatMap((e) => e.tags))],
    matches = useMemo(
      () =>
        (searchResults ?? entries)
          .filter(
            (item) =>
              journalFilter === "all" || item.journalId === +journalFilter,
          )
          .sort(
            (first, second) =>
              Number(!!second.pinned) - Number(!!first.pinned) ||
              second.date.localeCompare(first.date) ||
              String(second.time || "").localeCompare(String(first.time || "")) ||
              Number(second.id) - Number(first.id),
          ),
      [entries, searchResults, journalFilter],
    ),
    shown = useMemo(
      () => matches.filter((e) => +e.date.slice(0, 4) === selectedYear),
      [matches, selectedYear],
    );
  const add = async (e, selectedFiles = [], captions = [], mediaMetadata = []) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      files = selectedFiles.filter((x) => x.size && x.size <= 50 * 1024 * 1024),
      body = String(f.get("body")).trim(),
      remainingMedia = editing
        ? JSON.parse(String(f.get("existingMedia") || "[]"))
        : [];
    if (!body && !files.length && !remainingMedia.length) return;
    let queuedDraft = null;
    try {
      let media = [];
      if (files.length) {
        const uploadBody = new FormData();
        files.forEach((file) => uploadBody.append("media", file));
        uploadBody.append("captions", JSON.stringify(captions));
        uploadBody.append("metadata", JSON.stringify(mediaMetadata));
        media = await new Promise((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open("POST", "/api/media");
          const csrf = document.cookie
            .split(";")
            .map((item) => item.trim().split("="))
            .find(([name]) => name === "field_log_csrf")?.[1];
          if (csrf) request.setRequestHeader("X-CSRF-Token", csrf);
          request.upload.onprogress = (event) =>
            event.lengthComputable &&
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          request.onload = () =>
            request.status >= 200 && request.status < 300
              ? resolve(JSON.parse(request.responseText))
              : reject(
                  new Error(
                    JSON.parse(request.responseText || "{}").error ||
                      "Upload failed",
                  ),
                );
          request.onerror = reject;
          request.send(uploadBody);
        });
      }
      let draft = {
        journalId: f.get("journalId"),
        date: f.get("date"),
        time: f.get("time"),
        title: f.get("title") || "Untitled",
        tags: String(f.get("tags") || "note")
          .split(",")
          .map((x) => x.trim()),
        body: body ? body.split(/\n\s*\n/) : [],
        media: editing ? [...remainingMedia, ...media] : media,
        link: f.get("link"),
        visibility: f.get("visibility"),
        mood: f.get("mood"),
        location: f.get("location"),
        latitude: f.get("latitude"),
        longitude: f.get("longitude"),
        pinned: f.get("pinned") === "on",
        reminderAt: f.get("reminderAt")
          ? new Date(String(f.get("reminderAt"))).toISOString()
          : null,
        weather: JSON.parse(String(f.get("weather") || "null")),
      };
      if (preferences?.locationPrecision === "hidden") {
        draft.location = "";
        draft.latitude = "";
        draft.longitude = "";
      } else if (preferences?.locationPrecision === "city") {
        draft.latitude = "";
        draft.longitude = "";
      } else if (preferences?.locationPrecision === "approximate") {
        draft.latitude = draft.latitude ? Number(draft.latitude).toFixed(2) : "";
        draft.longitude = draft.longitude ? Number(draft.longitude).toFixed(2) : "";
      }
      const encryptionPassphrase = String(f.get("encryptionPassphrase") || "");
      if (f.get("encrypted") === "on") {
        if (encryptionPassphrase.length < 12)
          throw new Error(
            "Use an encryption passphrase of at least 12 characters",
          );
        draft = {
          date: draft.date,
          time: draft.time,
          journalId: draft.journalId,
          pinned: draft.pinned,
          media: draft.media,
          reminderAt: draft.reminderAt,
          encrypted: true,
          encryptedPayload: await encryptEntryPayload(
            draft,
            encryptionPassphrase,
          ),
        };
      }
      queuedDraft = draft;
      if (
        draft.reminderAt &&
        "Notification" in window &&
        Notification.permission === "default"
      )
        await Notification.requestPermission();
      const response = await fetch(
        editing ? `/api/entries/${editing.id}` : "/api/entries",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      if (!response.ok) throw new Error("Save failed");
      const saved = await response.json();
      setEntries(
        editing
          ? entries.map((x) => (x.id === saved.id ? saved : x))
          : [saved, ...entries],
      );
      setCompose(false);
      setEditing(null);
      if (!editing && preferences?.rememberEntryOptions)
        localStorage.setItem(`field-log:entry-defaults:${user.id}`, JSON.stringify({
          journalId: String(f.get("journalId") || ""),
          visibility: String(f.get("visibility") || "private"),
          tags: String(f.get("tags") || ""),
          weather: draft.weather || null,
        }));
      localStorage.removeItem(String(f.get("draftKey")));
      if (new URLSearchParams(location.search).has("share"))
        window.history.replaceState(null, "", "/");
      setSelectedYear(+saved.date.slice(0, 4));
      setUploadProgress(0);
    } catch (error) {
      setUploadProgress(0);
      if (!navigator.onLine && queuedDraft && !files.length) {
        const key = `field-log:outbox:${user.id}`,
          queued = JSON.parse(localStorage.getItem(key) || "[]");
        queued.push({
          method: editing ? "PUT" : "POST",
          url: editing ? `/api/entries/${editing.id}` : "/api/entries",
          draft: queuedDraft,
          queuedAt: new Date().toISOString(),
        });
        localStorage.setItem(key, JSON.stringify(queued));
        localStorage.removeItem(String(f.get("draftKey")));
        setCompose(false);
        setEditing(null);
        return alert(
          "Saved to the offline outbox. It will sync when the connection returns.",
        );
      }
      alert(
        error.message ||
          "Could not save the entry or its attachments. Please try again.",
      );
    }
  };
  const accountMatch = location.pathname.match(/^\/(verify|reset)\/([^/]+)$/);
  if (accountMatch)
    return <AccountTokenPage mode={accountMatch[1]} token={accountMatch[2]} />;
  if (!authReady || !siteReady)
    return <div className="boot">CONNECTING TO DAYMARK_</div>;
  if (
    siteSettings.maintenance_active &&
    !user?.is_admin &&
    !maintenanceBypass
  )
    return (
      <MaintenancePage
        settings={siteSettings}
        adminAccess={() => setMaintenanceBypass(true)}
      />
    );
  const publicMatch = location.pathname.match(/^\/share\/([^/]+)$/);
  if (publicMatch) return <PublicEntry token={publicMatch[1]} />;
  const authorMatch = location.pathname.match(/^\/authors\/([^/]+)$/);
  if (authorMatch) return <PublicAuthorPage username={authorMatch[1]} />;
  if (!user)
    return (
      <Auth
        onAuth={(u) => {
          setUser(u);
          Promise.all([
            fetch("/api/entries").then((response) => response.json()),
            fetch("/api/journals").then((response) => response.json()),
            fetch("/api/preferences").then((response) => response.json()),
          ]).then(([data, journalData, preferenceData]) => {
            setEntries(data);
            setJournals(journalData);
            setPreferences(preferenceData);
            if (!new URLSearchParams(location.search).has("view"))
              setView(["diary", "calendar", "timeline", "gallery", "map", "stats"].includes(preferenceData.defaultView) ? preferenceData.defaultView : "diary");
            if (data[0] && !requestedYear)
              setSelectedYear(+data[0].date.slice(0, 4));
          });
        }}
      />
    );
  const logout = () =>
    fetch("/api/auth/logout", { method: "POST" }).then(() => {
      setUser(null);
      location.assign("/");
    });
  const removeEntry = async (entry) => {
    const r = await fetch(`/api/entries/${entry.id}`, { method: "DELETE" });
    if (r.ok) {
      setEntries((current) => current.filter((x) => x.id !== entry.id));
      setDeleting(null);
    }
  };
  const openHistory = async (entry) => {
    const r = await fetch(`/api/entries/${entry.id}/revisions`);
    if (r.ok) setHistory({ entry, revisions: await r.json() });
  };
  const unlockEntry = async (protectedEntry) => {
    const passphrase = prompt("Enter this entry's encryption passphrase");
    if (!passphrase) return;
    try {
      const plaintext = await decryptEntryPayload(
        protectedEntry.encryptedPayload,
        passphrase,
      );
      setEntries((current) =>
        current.map((item) =>
          item.id === protectedEntry.id
            ? { ...item, ...plaintext, _decrypted: true }
            : item,
        ),
      );
    } catch {
      alert("That passphrase could not decrypt this entry.");
    }
  };
  const entryMatch = location.pathname.match(/^\/entries\/(\d+)$/);
  if (entryMatch)
    return <EntryPage user={user} logout={logout} entryId={entryMatch[1]} preferences={preferences} />;
  if (location.pathname === "/settings")
    return (
      <SettingsPage
        user={user}
        setUser={setUser}
        entries={entries}
        setEntries={setEntries}
        journals={journals}
        setJournals={setJournals}
        preferences={preferences}
        setPreferences={setPreferences}
        logout={logout}
      />
    );
  if (location.pathname === "/admin")
    return user.is_admin ? (
      <AdminPage user={user} logout={logout} />
    ) : (
      <SettingsPage
        user={user}
        setUser={setUser}
        entries={entries}
        setEntries={setEntries}
        journals={journals}
        setJournals={setJournals}
        preferences={preferences}
        setPreferences={setPreferences}
        logout={logout}
      />
    );
  return (
    <div className="site">
      {siteSettings.site_notice && (
        <div className="notice">
          {siteSettings.site_name.toUpperCase()} / {siteSettings.site_notice}
        </div>
      )}
      {!user.email_verified_at && (
        <div className="verification-notice">
          EMAIL NOT VERIFIED · CHECK MAILPIT OR YOUR INBOX
          <button
            onClick={async () => {
              const response = await fetch("/api/auth/verification/resend", {
                method: "POST",
              });
              alert(
                response.ok
                  ? "Verification message sent."
                  : "Could not send verification message.",
              );
            }}
          >
            RESEND
          </button>
        </div>
      )}
      <PageHeader
        user={user}
        logout={logout}
        newEntry={() => setCompose(true)}
        entries={entries}
        settings={siteSettings}
      />
      <div className="layout" id="diary">
        <aside className={side ? "open" : ""}>
          <div className="side-label">NAVIGATION</div>
          <div className="year-nav">
            <button onClick={() => setSelectedYear(selectedYear - 1)}>
              <ChevronLeft />
              {selectedYear - 1}
            </button>
            <strong>{selectedYear}</strong>
            <button onClick={() => setSelectedYear(selectedYear + 1)}>
              {selectedYear + 1}
              <ChevronRight />
            </button>
          </div>
          <div className="side-label">MONTHS</div>
          {[...monthNames].reverse().map((m) => {
            const monthEntries = shown.filter(
                (e) => fd(e.date, { month: "long" }) === m,
              ),
              count = monthEntries.length;
            return (
              <a
                key={m}
                className={count ? "" : "disabled"}
                href={count ? `#entry-${monthEntries[0].id}` : undefined}
              >
                <span>{m}</span>
                <i>{count}</i>
              </a>
            );
          })}
          <div className="side-label">TOPICS</div>
          <button
            className={tag === "all" ? "selected" : ""}
            onClick={() => setTag("all")}
          >
            all entries
          </button>
          {tags.map((t) => (
            <button
              key={t}
              className={tag === t ? "selected" : ""}
              onClick={() => setTag(t)}
            >
              #{t}
            </button>
          ))}
          <div className="side-label">JOURNALS</div>
          <button
            className={journalFilter === "all" ? "selected" : ""}
            onClick={() => setJournalFilter("all")}
          >
            <BookOpen /> all journals
          </button>
          {journals.map((journal) => (
            <button
              key={journal.id}
              className={
                journalFilter === String(journal.id)
                  ? "selected journal-link"
                  : "journal-link"
              }
              onClick={() => setJournalFilter(String(journal.id))}
            >
              <i style={{ background: journal.color }} /> {journal.name}
              <span>{journal.entryCount}</span>
            </button>
          ))}
          <DiscoveryPanel entries={entries} open={setPeek} />
        </aside>
        <main>
          <div className="tools">
            <button
              className="diary-menu-inline"
              onClick={() => setSide(!side)}
              aria-label="Open diary navigation"
            >
              <Menu />
            </button>
            <label>
              <Search />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search this diary..."
              />
            </label>
            <button
              className={
                filtersOpen ? "filter-control active" : "filter-control"
              }
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <SlidersHorizontal /> FILTERS
            </button>
            <label className="view-control">
              <span>VIEW</span>
              <select
                value={view}
                onChange={(event) => {
                  const nextView = event.target.value;
                  setView(nextView);
                  if (nextView !== "timeline" && timelineDate) {
                    setTimelineDate("");
                    window.history.replaceState(null, "", `/?view=${nextView}&year=${selectedYear}#diary`);
                  }
                }}
              >
                <option value="diary">Diary</option>
                <option value="calendar">Calendar</option>
                <option value="timeline">Timeline</option>
                <option value="gallery">Gallery</option>
                <option value="map">Map</option>
                <option value="stats">Statistics</option>
              </select>
            </label>
            <span className="entry-count">
              {
                (view === "timeline" && timelineDate ? shown.filter((entry) => entry.date === timelineDate) : ["map", "stats"].includes(view) ? matches : shown)
                  .length
              }{" "}
              ENTRIES
            </span>
          </div>
          {filtersOpen && (
            <AdvancedFilters
              value={filters}
              change={(key, value) => setFilters({ ...filters, [key]: value })}
              clear={() => setFilters({})}
            />
          )}
          {view === "diary" &&
            shown.slice(0, preferences?.entriesPerPage || shown.length).map((e) => (
              <DiaryEntry
                entry={e}
                preferences={preferences}
                key={e.id}
                onEdit={(entry) => {
                  setEditing(entry);
                  setCompose(true);
                }}
                onDelete={setDeleting}
                onHistory={openHistory}
                onShare={setShareEntry}
                onUnlock={unlockEntry}
              />
            ))}
          {view === "calendar" && shown.length > 0 && (
            <CalendarView entries={shown} year={selectedYear} preferences={preferences} openDay={(date) => {
              setTimelineDate(date);
              setView("timeline");
              setFiltersOpen(false);
              window.history.replaceState(null, "", `/?view=timeline&date=${date}&year=${date.slice(0, 4)}#diary`);
            }} />
          )}
          {view === "timeline" && <TimelineView entries={timelineDate ? shown.filter((entry) => entry.date === timelineDate) : shown} date={timelineDate} preferences={preferences} clearDate={() => {
            setTimelineDate("");
            window.history.replaceState(null, "", `/?view=timeline&year=${selectedYear}#diary`);
          }} />}
          {view === "gallery" && <GalleryView entries={shown} preferences={preferences} />}
          {view === "map" && <GlobalMap entries={matches} preferences={preferences} />}
          {view === "stats" && <StatisticsView entries={matches} preferences={preferences} userId={user.id} />}
          {(["map", "stats"].includes(view)
            ? !matches.length
            : !shown.length) && (
            <div className="nothing">NO MATCHING ENTRIES_</div>
          )}
        </main>
      </div>
      <footer id="about">
        <span>{siteSettings.site_name.toUpperCase()}</span>
        <span>{siteSettings.footer_text}</span>
        <a href="#top">BACK TO TOP ↑</a>
      </footer>
      {compose && (
        <Composer
          entry={editing}
          userId={user.id}
          journals={journals}
          preferences={preferences}
          close={() => {
            setCompose(false);
            setEditing(null);
          }}
          submit={add}
          uploadProgress={uploadProgress}
        />
      )}
      {history && (
        <HistoryPanel
          data={history}
          close={() => setHistory(null)}
          restore={async (revision) => {
            const r = await fetch(
              `/api/entries/${history.entry.id}/revisions/${revision.id}/restore`,
              { method: "POST" },
            );
            if (r.ok) {
              const restored = await r.json();
              setEntries(
                entries.map((e) => (e.id === restored.id ? restored : e)),
              );
              setHistory(null);
            }
          }}
        />
      )}
      {peek && <EntryPeek entry={peek} close={() => setPeek(null)} />}
      {shareEntry && (
        <SharePanel entry={shareEntry} preferences={preferences} close={() => setShareEntry(null)} />
      )}
      {deleting && (
        <DeleteEntryModal
          entry={deleting}
          close={() => setDeleting(null)}
          confirm={() => removeEntry(deleting)}
        />
      )}
    </div>
  );
}
function PageHeader({ user, logout, newEntry, entries, settings }) {
  const dates = entries?.map((entry) => entry.date).filter(Boolean).sort() || [],
    earliestYear = dates[0]?.slice(0, 4) || "—",
    latestDate = dates.at(-1),
    hasDiaryIdentity = !!settings && Array.isArray(entries);
  return (
    <header className={`top clean-top${hasDiaryIdentity ? " home-identity-header" : ""}`} id={hasDiaryIdentity ? "top" : undefined}>
      {hasDiaryIdentity ? <a className="diary-header-identity" href="/">
        <strong>{settings.site_name.toUpperCase()}_</strong>
        <p>{settings.site_tagline}</p>
        <span><b>{entries.length.toLocaleString()} ENTRIES</b><i>·</i><b>RECORDING SINCE {earliestYear}</b><i>·</i><b>{latestDate ? `LAST ENTRY ${fd(latestDate, { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}` : "NO ENTRIES YET"}</b></span>
      </a> : <a className="logo" href="/">GROG<span>.DIARY</span></a>}
      <nav>
        {newEntry && (
          <button className="header-action header-new-entry" onClick={newEntry}>
            <Plus /> NEW ENTRY
          </button>
        )}
        <a className="header-action" href="/settings">
          <Settings /> USER SETTINGS
        </a>
        {user.is_admin && (
          <a className="header-action" href="/admin">
            <Users /> ADMIN DASHBOARD
          </a>
        )}
        <button className="header-action" onClick={logout}>
          <LogOut /> SIGN OUT
        </button>
      </nav>
    </header>
  );
}
function PublicAuthorPage({ username }) {
  const [data, setData] = useState(null), [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/authors/${encodeURIComponent(username)}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Profile not found");
        setData(result);
      })
      .catch((reason) => setError(reason.message));
  }, [username]);
  if (error) return <div className="boot">{error.toUpperCase()}_</div>;
  if (!data) return <div className="boot">LOADING AUTHOR_</div>;
  return <div className="site public-author-page"><header className="public-author-header">
    {data.profile.avatarUrl && <img src={data.profile.avatarUrl} alt="" />}
    <div><span>PUBLIC AUTHOR / @{data.profile.username}</span><h1>{data.profile.displayName}</h1>{data.profile.pronouns && <small>{data.profile.pronouns}</small>}<p>{data.profile.bio}</p>{data.profile.personalWebsite && <a href={data.profile.personalWebsite} target="_blank" rel="noreferrer">WEBSITE ↗</a>}</div>
  </header><main>{data.entries.map((item) => <DiaryEntry key={item.id} entry={item} standalone />)}{!data.entries.length && <div className="nothing">NO PUBLIC ENTRIES_</div>}</main></div>;
}
function EntryPage({ user, logout, entryId, preferences }) {
  const [item, setItem] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/entries/${entryId}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Entry not found");
        setItem(result);
      })
      .catch((reason) => setError(reason.message));
  }, [entryId]);
  useEffect(() => {
    if (item && location.hash === "#discussion")
      requestAnimationFrame(() =>
        document.getElementById("discussion")?.scrollIntoView(),
      );
  }, [item]);
  const unlock = async (protectedEntry) => {
    const passphrase = prompt("Enter this entry's encryption passphrase");
    if (!passphrase) return;
    try {
      const plaintext = await decryptEntryPayload(
        protectedEntry.encryptedPayload,
        passphrase,
      );
      setItem({ ...protectedEntry, ...plaintext, _decrypted: true });
    } catch {
      alert("That passphrase could not decrypt this entry.");
    }
  };
  return (
    <div className="site single-entry-route">
      <PageHeader user={user} logout={logout} />
      <main className="single-entry-page">
        <a className="back-to-diary" href="/">
          ← BACK TO DIARY
        </a>
        {error && <div className="nothing">{error.toUpperCase()}_</div>}
        {!item && !error && <div className="nothing">LOADING ENTRY_</div>}
        {item && (
          <>
            <DiaryEntry entry={item} preferences={preferences} standalone onUnlock={unlock} />
            <SocialPanel entry={item} embedded />
          </>
        )}
      </main>
    </div>
  );
}
function SettingsPage({
  user,
  setUser,
  entries,
  setEntries,
  journals,
  setJournals,
  preferences,
  setPreferences,
  logout,
}) {
  const sections = [
      ["profile", "Profile", UserRound],
      ["diary", "Diary & editor", Pencil],
      ["organize", "Journals & tags", BookOpen],
      ["writing", "Writing", ListChecks],
      ["appearance", "Appearance", Eye],
      ["notifications", "Notifications", Bell],
      ["privacy", "Privacy & sharing", LockKeyhole],
      ["security-data", "Security", ShieldCheck],
      ["data", "Data & storage", HardDrive],
      ["trash", "Trash", Trash2],
    ],
    requested = location.hash.slice(1),
    legacySections = {
      journals: "organize",
      tags: "organize",
      editor: "diary",
      inbox: "notifications",
      activity: "notifications",
      links: "privacy",
      comments: "privacy",
      blocks: "privacy",
      storage: "data",
      backups: "data",
    },
    initialSection = legacySections[requested] || requested,
    [section, setSection] = useState(
      sections.some(([name]) => name === initialSection) ? initialSection : "profile",
    ),
    [trash, setTrash] = useState([]);
  useEffect(() => {
    if (section !== "trash") return;
    fetch("/api/trash")
      .then((response) => (response.ok ? response.json() : []))
      .then(setTrash);
  }, [section]);
  const choose = (name) => {
    setSection(name);
    window.history.replaceState(null, "", `/settings#${name}`);
  };
  const close = () => location.assign("/");
  return (
    <div className="site account-route">
      <PageHeader user={user} logout={logout} />
      <main className="settings-page">
        <header className="route-title">
          <span>ACCOUNT / USER SETTINGS</span>
          <h1>{user.display_name}</h1>
          <p>
            @{user.username} · {user.email}
          </p>
        </header>
        <div className="settings-layout">
          <aside className="settings-navigation">
            {sections.map(([name, label, Icon]) => <button key={name} className={section === name ? "active" : ""} onClick={() => choose(name)}><Icon /> {label}</button>)}
          </aside>
          <section className="settings-content settings-hub-content">
            {section === "profile" && <ProfileSettingsPanel user={user} preferences={preferences} update={setUser} updatePreferences={setPreferences} />}
            {section === "diary" && <div className="settings-section-stack"><UserPreferencePanel section="diary" preferences={preferences} journals={journals} update={setPreferences} /><UserPreferencePanel section="editor" preferences={preferences} journals={journals} update={setPreferences} /></div>}
            {section === "organize" && <div className="settings-section-stack"><JournalPanel journals={journals} update={setJournals} /><TagSettingsPanel /></div>}
            {section === "writing" && <WritingToolsPanel preferences={preferences} update={setPreferences} />}
            {section === "appearance" && <UserPreferencePanel section="appearance" preferences={preferences} journals={journals} update={setPreferences} />}
            {section === "notifications" && <div className="settings-section-stack"><UserPreferencePanel section="notifications" preferences={preferences} journals={journals} update={setPreferences} /><NotificationPanel close={close} /><ActivityPanel journals={journals} close={close} /></div>}
            {section === "privacy" && <div className="settings-section-stack"><UserPreferencePanel section="privacy" preferences={preferences} journals={journals} update={setPreferences} /><AccountPublicLinksPanel /><PendingCommentsPanel /><BlockedUsersPanel /></div>}
            {section === "security-data" && <SecurityPanel close={close} />}
            {section === "data" && <div className="settings-section-stack"><PersonalStoragePanel /><PersonalBackupsPanel /><DataPanel close={close} /></div>}
            {section === "trash" && <TrashPanel entries={trash} close={close} restore={async (item) => {
              const response = await fetch(`/api/entries/${item.id}/restore`, { method: "POST" });
              if (response.ok) {
                const restored = await response.json();
                setEntries([restored, ...entries]);
                setTrash((current) => current.filter((entry) => entry.id !== item.id));
              }
            }} destroy={async (item) => {
              if (!confirm(`Permanently delete “${item.title}”? This cannot be undone.`)) return;
              const response = await fetch(`/api/entries/${item.id}/permanent`, { method: "DELETE" });
              if (response.ok) setTrash((current) => current.filter((entry) => entry.id !== item.id));
            }} />}
          </section>
        </div>
      </main>
    </div>
  );
}
function ProfileSettingsPanel({ user, preferences, update, updatePreferences }) {
  const [message, setMessage] = useState("");
  const save = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget)),
      response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || "Could not update profile.");
    let avatarUrl = values.avatarUrl;
    if (values.avatarFile?.size) {
      const uploadBody = new FormData();
      uploadBody.append("media", values.avatarFile);
      uploadBody.append("captions", "[]");
      const uploadResponse = await fetch("/api/media", { method: "POST", body: uploadBody });
      if (!uploadResponse.ok) return setMessage((await uploadResponse.json()).error || "Could not upload profile image.");
      avatarUrl = (await uploadResponse.json())[0]?.url || avatarUrl;
    }
    const preferenceResponse = await fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...preferences, avatarUrl, pronouns: values.pronouns, personalWebsite: values.personalWebsite, homeLocation: values.homeLocation, language: values.language, timezone: values.timezone }),
    });
    update(result);
    if (preferenceResponse.ok) updatePreferences(await preferenceResponse.json());
    setMessage("Profile updated.");
    setTimeout(() => setMessage(""), 3000);
  };
  return <form className="user-preference-panel profile-settings-panel" onSubmit={save}>
    <header><div className="profile-settings-heading">{preferences?.avatarUrl && <img src={preferences.avatarUrl} alt="Profile" />}<span>PROFILE</span><p>Manage the identity shown beside your entries and comments.</p></div></header>
    <div className="user-preference-grid">
      <label>DISPLAY NAME<input name="displayName" required minLength="2" maxLength="100" defaultValue={user.display_name} /><small>Your visible author name throughout the diary.</small></label>
      <label>USERNAME<input disabled value={user.username} /><small>Usernames are permanent account identifiers.</small></label>
      <label>EMAIL<input disabled value={user.email} /><small>{user.email_verified_at ? "Verified email address." : "Email verification is still required."}</small></label>
      <label>PROFILE IMAGE URL<input name="avatarUrl" defaultValue={preferences?.avatarUrl || ""} placeholder="https://…" /><small>Displayed on your profile and public author page.</small></label>
      <label>UPLOAD PROFILE IMAGE<input name="avatarFile" type="file" accept="image/*" /><small>Uploads an image to your included private media storage.</small></label>
      <label>PERSONAL WEBSITE<input name="personalWebsite" type="url" defaultValue={preferences?.personalWebsite || ""} placeholder="https://…" /></label>
      <label>LANGUAGE<select name="language" defaultValue={preferences?.language || "auto"}><option value="auto">Device language</option><option value="en">English</option><option value="de">Deutsch</option><option value="pt">Português</option></select></label>
      <label>TIMEZONE<input name="timezone" defaultValue={preferences?.timezone || "auto"} placeholder="auto or Europe/Berlin" /></label>
      <label className="wide">BIO<textarea name="bio" maxLength="2000" defaultValue={user.bio || ""} /><small>A short personal description associated with your account.</small></label>
    </div>
    <footer><span className={message === "Profile updated." ? "saved" : ""}>{message || "Your profile is visible only where diary permissions allow it."}</span><button><UserRound /> SAVE PROFILE</button></footer>
  </form>;
}
function TagSettingsPanel() {
  const [items, setItems] = useState([]), load = () => fetch("/api/tags").then((response) => response.json()).then(setItems);
  useEffect(load, []);
  return <section className="settings-list-panel"><header><span>PERSONAL TAGS</span><p>Rename, merge, or remove tags from all of your entries.</p></header>{items.map((item) => <article key={item.tag}><span><strong>#{item.tag}</strong><small>{item.count} ENTRIES</small></span><div><button onClick={async () => { const name = prompt("Rename or merge this tag into:", item.tag); if (!name || name === item.tag) return; await fetch(`/api/tags/${encodeURIComponent(item.tag)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); load(); }}>RENAME / MERGE</button><button className="danger" onClick={async () => { if (!confirm(`Remove #${item.tag} from every entry?`)) return; await fetch(`/api/tags/${encodeURIComponent(item.tag)}`, { method: "DELETE" }); load(); }}>REMOVE</button></div></article>)}{!items.length && <p className="trash-empty">NO TAGS YET_</p>}</section>;
}
function WritingToolsPanel({ preferences, update }) {
  const save = async (changes) => {
    const response = await fetch("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...preferences, ...changes }) });
    if (response.ok) update(await response.json());
  };
  const templates = preferences.customTemplates || [], prompts = preferences.customPrompts || [], goals = preferences.writingGoals || {};
  return <div className="writing-settings">
    <section className="settings-list-panel"><header><span>CUSTOM TEMPLATES</span><p>Add reusable structures to the entry composer.</p></header><form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget, data = Object.fromEntries(new FormData(form)); save({ customTemplates: [...templates, { id: crypto.randomUUID(), name: data.name, body: data.body }] }); form.reset(); }}><input name="name" required placeholder="Template name" /><textarea name="body" required placeholder="Markdown template" /><button>ADD TEMPLATE</button></form>{templates.map((item) => <article key={item.id}><span><strong>{item.name}</strong><small>{item.body.slice(0, 100)}</small></span><button className="danger" onClick={() => save({ customTemplates: templates.filter((entry) => entry.id !== item.id) })}>REMOVE</button></article>)}</section>
    <section className="settings-list-panel"><header><span>CUSTOM PROMPTS</span><p>Add personal prompts to the random prompt button.</p></header><form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget, promptText = new FormData(form).get("prompt"); save({ customPrompts: [...prompts, String(promptText)] }); form.reset(); }}><input name="prompt" required placeholder="What do you want to remember?" /><button>ADD PROMPT</button></form>{prompts.map((item, index) => <article key={`${item}-${index}`}><span><strong>{item}</strong></span><button className="danger" onClick={() => save({ customPrompts: prompts.filter((_, itemIndex) => itemIndex !== index) })}>REMOVE</button></article>)}</section>
    <form className="user-preference-panel writing-goals" onSubmit={async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); if (data.recurringPromptTime && "Notification" in window && Notification.permission === "default") await Notification.requestPermission(); save({ writingGoals: { weeklyEntries: Number(data.weeklyEntries), monthlyWords: Number(data.monthlyWords) }, recurringPromptTime: data.recurringPromptTime, recurringPromptDays: [...event.currentTarget.querySelectorAll('[name="promptDay"]:checked')].map((item) => item.value) }); }}><header><div><span>GOALS & RECURRING PROMPTS</span><p>Set writing targets and the days when your prompt reminder should appear.</p></div></header><div className="user-preference-grid"><label>WEEKLY ENTRIES<input name="weeklyEntries" type="number" min="0" max="100" defaultValue={goals.weeklyEntries || 0} /></label><label>MONTHLY WORDS<input name="monthlyWords" type="number" min="0" max="1000000" defaultValue={goals.monthlyWords || 0} /></label><label>PROMPT TIME<input name="recurringPromptTime" type="time" defaultValue={preferences.recurringPromptTime || ""} /></label><label className="prompt-days">PROMPT DAYS<div>{["sun","mon","tue","wed","thu","fri","sat"].map((day) => <span key={day}><input name="promptDay" type="checkbox" value={day} defaultChecked={(preferences.recurringPromptDays || []).includes(day)} /> {day.toUpperCase()}</span>)}</div></label></div><footer><span>Goals appear in diary statistics.</span><button><Settings /> SAVE WRITING TOOLS</button></footer></form>
  </div>;
}
const readableBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024, index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[index]}`;
};
function PersonalStoragePanel() {
  const [data, setData] = useState(null), [message, setMessage] = useState(""),
    load = () => fetch("/api/storage/details").then((response) => response.json()).then(setData);
  useEffect(load, []);
  if (!data) return <div className="nothing">LOADING STORAGE_</div>;
  const remove = async (file) => {
    if (!confirm(`Remove ${file.name} from every entry and storage?`)) return;
    const response = await fetch("/api/storage/files", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: file.key }) });
    setMessage(response.ok ? "File removed." : (await response.json()).error || "Could not remove file.");
    if (response.ok) load();
  };
  return <section className="personal-storage-panel">
    <header><span>PERSONAL STORAGE</span><p>See what uses your space and clean up attachments without opening every entry.</p></header>
    <div className="storage-total"><strong>{readableBytes(data.used)}</strong><span>of {readableBytes(data.quota)} used</span><i><b style={{ width: `${Math.min(100, data.used / data.quota * 100)}%` }} /></i></div>
    <div className="storage-categories">{Object.entries(data.categories).map(([name, bytes]) => <article key={name}><span>{name.toUpperCase()}</span><strong>{readableBytes(bytes)}</strong><i><b style={{ width: `${data.used ? bytes / data.used * 100 : 0}%` }} /></i></article>)}</div>
    <div className="storage-columns"><section className="settings-list-panel"><header><span>LARGEST FILES</span><p>Your 25 largest diary attachments.</p></header>{data.files.slice(0, 25).map((file) => <article key={`${file.entryId}-${file.key}`}><span><strong>{file.name}</strong><small>{file.entryTitle} · {readableBytes(file.size)} · {file.type}</small></span><button className="danger" onClick={() => remove(file)}>REMOVE</button></article>)}{!data.files.length && <p className="trash-empty">NO ATTACHMENTS_</p>}</section>
    <section className="settings-list-panel"><header><span>EXACT DUPLICATES</span><p>Files with identical content and size.</p></header>{data.duplicates.map((group, index) => <article key={index}><span><strong>{group.length} COPIES · {readableBytes(group[0].size)}</strong><small>{group.map((file) => file.name).join(" · ")}</small></span><button onClick={() => remove(group[group.length - 1])}>REMOVE ONE</button></article>)}{!data.duplicates.length && <p className="trash-empty">NO EXACT DUPLICATES_</p>}</section></div>
    {message && <p className="storage-message">{message}</p>}
  </section>;
}
function PersonalBackupsPanel() {
  const [items, setItems] = useState([]), [working, setWorking] = useState(false), [message, setMessage] = useState(""),
    load = () => fetch("/api/user-backups").then((response) => response.json()).then(setItems);
  useEffect(load, []);
  const create = async () => { setWorking(true); setMessage("Creating a complete backup…"); const response = await fetch("/api/user-backups", { method: "POST" }); setWorking(false); setMessage(response.ok ? "Backup created." : (await response.json()).error || "Backup failed."); if (response.ok) load(); };
  return <section className="settings-list-panel personal-backups-panel"><header><span>PERSONAL BACKUPS</span><p>Create restorable archives containing account data, Markdown entries, and original media.</p><button onClick={create} disabled={working}><Archive /> {working ? "CREATING_" : "CREATE BACKUP"}</button></header>{items.map((item) => <article key={item.id}><span><strong>{new Date(item.created_at).toLocaleString()}</strong><small>{readableBytes(item.bytes)} · COMPLETE ACCOUNT ARCHIVE</small></span><div><a className="button-link" href={`/api/user-backups/${item.id}/download`}><Download /> DOWNLOAD</a><button className="danger" onClick={async () => { if (!confirm("Delete this personal backup?")) return; await fetch(`/api/user-backups/${item.id}`, { method: "DELETE" }); load(); }}>DELETE</button></div></article>)}{!items.length && <p className="trash-empty">NO PERSONAL BACKUPS_</p>}{message && <p className="storage-message">{message}</p>}</section>;
}
function AccountPublicLinksPanel() {
  const [items, setItems] = useState([]), load = () => fetch("/api/public-links").then((response) => response.json()).then(setItems);
  useEffect(load, []);
  return <section className="settings-list-panel"><header><span>ALL PUBLIC LINKS</span><p>Review and revoke links across every journal.</p></header>{items.map((item) => <article key={item.id}><span><strong>{item.title}</strong><small>{item.revoked_at ? "REVOKED" : new Date(item.expires_at) <= new Date() ? "EXPIRED" : `EXPIRES ${new Date(item.expires_at).toLocaleString()}`} · {item.view_count} VIEWS</small></span>{!item.revoked_at && <button onClick={async () => { await fetch(`/api/public-links/${item.id}`, { method: "DELETE" }); load(); }}>REVOKE</button>}</article>)}{!items.length && <p className="trash-empty">NO PUBLIC LINKS_</p>}</section>;
}
function PendingCommentsPanel() {
  const [items, setItems] = useState([]), load = () => fetch("/api/comments/pending").then((response) => response.json()).then(setItems);
  useEffect(load, []);
  return <section className="settings-list-panel"><header><span>COMMENT REVIEW</span><p>Approve or remove comments held by your privacy policy.</p></header>{items.map((item) => <article key={item.id}><span><strong>{item.display_name} / {item.title}</strong><small>{item.body} · {new Date(item.created_at).toLocaleString()}</small></span><div><button onClick={async () => { await fetch(`/api/comments/${item.id}/approve`, { method: "POST" }); load(); }}>APPROVE</button><button className="danger" onClick={async () => { await fetch(`/api/comments/${item.id}`, { method: "DELETE" }); load(); }}>DELETE</button></div></article>)}{!items.length && <p className="trash-empty">NO COMMENTS WAITING_</p>}</section>;
}
function BlockedUsersPanel() {
  const [items, setItems] = useState([]), [error, setError] = useState(""), load = () => fetch("/api/blocks").then((response) => response.json()).then(setItems);
  useEffect(load, []);
  return <section className="settings-list-panel"><header><span>BLOCKED USERS</span><p>Blocked accounts cannot interact with your entries or comments.</p></header><form onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget, response = await fetch("/api/blocks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); if (!response.ok) return setError((await response.json()).error); form.reset(); setError(""); load(); }}><input name="username" required placeholder="Username to block" /><button>BLOCK USER</button></form>{error && <p className="form-error">{error}</p>}{items.map((item) => <article key={item.id}><span><strong>{item.display_name}</strong><small>@{item.username}</small></span><button onClick={async () => { await fetch(`/api/blocks/${item.id}`, { method: "DELETE" }); load(); }}>UNBLOCK</button></article>)}{!items.length && <p className="trash-empty">NO BLOCKED USERS_</p>}</section>;
}
function UserPreferencePanel({ section, preferences, journals, update }) {
  const [message, setMessage] = useState("");
  if (!preferences) return <div className="nothing">LOADING PREFERENCES_</div>;
  const titles = {
    diary: ["DIARY", "Choose how entries are created and how your diary opens."],
    editor: ["EDITOR", "Configure writing, drafts, media, and remembered entry options."],
    appearance: ["APPEARANCE", "Adjust the interface scale, density, motion, and entry layout."],
    notifications: ["NOTIFICATIONS", "Choose which diary events should reach your inbox."],
    privacy: ["PRIVACY", "Control profile visibility, location precision, comments, and sharing defaults."],
  };
  const save = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const next = { ...preferences };
    for (const element of form.elements) {
      if (!element.name) continue;
      if (element.type === "file") continue;
      next[element.name] = element.type === "checkbox" ? element.checked : element.type === "number" ? Number(element.value) : element.value;
    }
    const headerFile = form.elements.headerFile?.files?.[0];
    if (headerFile) {
      const uploadBody = new FormData();
      uploadBody.append("media", headerFile);
      uploadBody.append("captions", "[]");
      const uploadResponse = await fetch("/api/media", { method: "POST", body: uploadBody });
      if (!uploadResponse.ok) return setMessage((await uploadResponse.json()).error || "Could not upload diary cover.");
      next.headerImage = (await uploadResponse.json())[0]?.url || next.headerImage;
    }
    if (next.notificationBrowser && "Notification" in window && Notification.permission === "default")
      await Notification.requestPermission();
    const response = await fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!response.ok) return setMessage("Could not save preferences.");
    update(await response.json());
    setMessage("Preferences saved.");
    setTimeout(() => setMessage(""), 3000);
  };
  return (
    <form className="user-preference-panel" onSubmit={save} key={section}>
      <header><div><span>{titles[section][0]}</span><p>{titles[section][1]}</p></div></header>
      <div className="user-preference-grid">
        {section === "diary" && <>
          <label>DEFAULT VISIBILITY<select name="defaultVisibility" defaultValue={preferences.defaultVisibility}><option value="private">Private</option><option value="public">Shared</option></select><small>Applied when creating a new entry.</small></label>
          <label>DEFAULT JOURNAL<select name="defaultJournal" defaultValue={preferences.defaultJournal || ""}><option value="">Current default journal</option>{journals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Preselect this journal in the composer.</small></label>
          <label>OPENING VIEW<select name="defaultView" defaultValue={preferences.defaultView}><option value="diary">Diary</option><option value="calendar">Calendar</option><option value="timeline">Timeline</option><option value="gallery">Gallery</option><option value="map">Map</option></select><small>The first view shown after sign-in.</small></label>
          <label>ENTRIES PER PAGE<input name="entriesPerPage" type="number" min="5" max="100" step="5" defaultValue={preferences.entriesPerPage} /><small>Controls the length of diary listings.</small></label>
          <label>DATE FORMAT<select name="dateFormat" defaultValue={preferences.dateFormat}><option value="locale">Device locale</option><option value="eu">Day / month / year</option><option value="us">Month / day / year</option><option value="iso">ISO year-month-day</option></select></label>
          <label>TIME FORMAT<select name="timeFormat" defaultValue={preferences.timeFormat}><option value="24h">24 hour</option><option value="12h">12 hour</option></select></label>
          <label>TIMEZONE<input name="timezone" defaultValue={preferences.timezone} placeholder="auto or Europe/Berlin" /><small>Used for reminders, exports, and activity dates.</small></label>
          <label>WEEK STARTS ON<select name="weekStartsOn" defaultValue={preferences.weekStartsOn}><option value="monday">Monday</option><option value="sunday">Sunday</option><option value="saturday">Saturday</option></select></label>
          <label>TEMPERATURE<select name="temperatureUnit" defaultValue={preferences.temperatureUnit}><option value="celsius">Celsius</option><option value="fahrenheit">Fahrenheit</option></select></label>
          <label>DISTANCE AND WIND<select name="distanceUnit" defaultValue={preferences.distanceUnit}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label>
        </>}
        {section === "editor" && <>
          <label>DEFAULT EDITOR<select name="editorMode" defaultValue={preferences.editorMode}><option value="markdown">Markdown writing</option><option value="rich">Rich preview</option></select><small>Choose the initial composer mode.</small></label>
          <label>UPLOAD QUALITY<select name="imageQuality" defaultValue={preferences.imageQuality}><option value="original">Original</option><option value="high">High</option><option value="balanced">Balanced</option><option value="compact">Compact</option></select><small>Controls compression for future image uploads.</small></label>
          <label>DEFAULT MAP ZOOM<input name="mapZoom" type="number" min="2" max="18" defaultValue={preferences.mapZoom} /><small>Used when an entry is the only point on the map.</small></label>
          <label className="preference-toggle"><input name="autosave" type="checkbox" defaultChecked={preferences.autosave} /><span>AUTOMATIC DRAFT SAVING<small>Continuously preserve unfinished entries.</small></span></label>
          <label className="preference-toggle"><input name="spellcheck" type="checkbox" defaultChecked={preferences.spellcheck} /><span>BROWSER SPELLCHECK<small>Check spelling while writing.</small></span></label>
          <label className="preference-toggle"><input name="rememberEntryOptions" type="checkbox" defaultChecked={preferences.rememberEntryOptions} /><span>REMEMBER ENTRY OPTIONS<small>Reuse recent tags, journal, visibility, and weather choices.</small></span></label>
        </>}
        {section === "appearance" && <>
          <label>THEME<select name="theme" defaultValue={preferences.theme}><option value="tokyo-night">Tokyo Night</option><option value="midnight">Midnight</option><option value="oled">OLED Black</option><option value="nord">Nord</option><option value="dracula">Dracula</option><option value="gruvbox">Gruvbox</option><option value="solarized">Solarized Dark</option><option value="forest">Forest</option><option value="rose">Rose Pine</option><option value="monochrome">Monochrome</option><option value="paper">Paper</option><option value="system">Follow system</option></select><small>Colour scheme for your account.</small></label>
          <label>INTERFACE SCALE<input name="fontScale" type="number" min="85" max="130" step="5" defaultValue={preferences.fontScale} /><small>Percentage scale for type and controls.</small></label>
          <label>DENSITY<select name="density" defaultValue={preferences.density}><option value="comfortable">Comfortable</option><option value="compact">Compact</option><option value="spacious">Spacious</option></select></label>
          <label>ACCENT COLOUR<input name="accentColor" type="color" defaultValue={preferences.accentColor} /><small>Applied to primary controls and active navigation.</small></label>
          <label>DIARY HEADER IMAGE<input name="headerImage" defaultValue={preferences.headerImage} placeholder="https://…" /><small>Optional cover image shown behind the diary masthead.</small></label>
          <label>UPLOAD DIARY COVER<input name="headerFile" type="file" accept="image/*" /><small>Store a cover image in your included private media storage.</small></label>
          <label className="preference-toggle"><input name="reduceMotion" type="checkbox" defaultChecked={preferences.reduceMotion} /><span>REDUCE MOTION<small>Minimize interface animation and transitions.</small></span></label>
          <label className="preference-toggle"><input name="compactEntries" type="checkbox" defaultChecked={preferences.compactEntries} /><span>COMPACT ENTRIES<small>Use tighter spacing in diary lists.</small></span></label>
        </>}
        {section === "notifications" && <>
          <label className="preference-toggle"><input name="notificationInApp" type="checkbox" defaultChecked={preferences.notificationInApp} /><span>IN-APP INBOX<small>Keep notifications in the account inbox.</small></span></label>
          <label className="preference-toggle"><input name="notificationBrowser" type="checkbox" defaultChecked={preferences.notificationBrowser} /><span>BROWSER NOTIFICATIONS<small>Show native notifications while the diary is open.</small></span></label>
          <label className="preference-toggle"><input name="notificationEmail" type="checkbox" defaultChecked={preferences.notificationEmail} /><span>EMAIL DELIVERY<small>Send notifications to the verified account email.</small></span></label>
          <label>EMAIL FREQUENCY<select name="digestFrequency" defaultValue={preferences.digestFrequency}><option value="instant">Instant</option><option value="daily">Daily digest</option><option value="weekly">Weekly digest</option><option value="off">Never</option></select></label>
          <label>DIGEST TIME<input name="digestTime" type="time" defaultValue={preferences.digestTime} /><small>Preferred local delivery time for future scheduled digests.</small></label>
          <label>QUIET HOURS START<input name="quietHoursStart" type="time" defaultValue={preferences.quietHoursStart} /></label>
          <label>QUIET HOURS END<input name="quietHoursEnd" type="time" defaultValue={preferences.quietHoursEnd} /></label>
          {[['notifyComments','NEW COMMENTS'],['notifyReplies','REPLIES'],['notifyMentions','MENTIONS'],['notifyShares','SHARED-ENTRY ACTIVITY'],['notifySecurity','SECURITY & NEW DEVICES']].map(([name, label]) => <label className="preference-toggle" key={name}><input name={name} type="checkbox" defaultChecked={preferences[name]} /><span>{label}<small>Deliver this event through enabled channels.</small></span></label>)}
        </>}
        {section === "privacy" && <>
          <label>PROFILE VISIBILITY<select name="profileVisibility" defaultValue={preferences.profileVisibility}><option value="private">Private</option><option value="public">Public author page</option></select><small>{preferences.profileVisibility === "public" ? `Available at /authors/your-username` : "Your author profile is not publicly accessible."}</small></label>
          <label>LOCATION PRECISION<select name="locationPrecision" defaultValue={preferences.locationPrecision}><option value="exact">Exact location</option><option value="approximate">Approximate area</option><option value="city">City or region only</option><option value="hidden">Hide coordinates</option></select><small>Applied when new entries include a map location.</small></label>
          <label>COMMENT POLICY<select name="commentPolicy" defaultValue={preferences.commentPolicy}><option value="nobody">Nobody</option><option value="members">Journal members</option><option value="signed-in">Any signed-in user</option><option value="public">Public-link visitors</option></select><small>Default discussion access for new entries.</small></label>
          <label>SHARE LINK EXPIRY (DAYS)<input name="shareExpiryDays" type="number" min="1" max="365" defaultValue={preferences.shareExpiryDays} /><small>Default lifetime for newly created public links.</small></label>
          <label className="preference-toggle"><input name="approveComments" type="checkbox" defaultChecked={preferences.approveComments} /><span>REVIEW COMMENTS FIRST<small>Hold comments from other users until you approve them.</small></span></label>
        </>}
      </div>
      <footer><span className={message ? "saved" : ""}>{message || "Preferences follow your account across devices."}</span><button><Settings /> SAVE PREFERENCES</button></footer>
    </form>
  );
}
function AdminPage({ user, logout }) {
  const sections = [
      ["overview", "Overview", BarChart3],
      ["alerts", "Alerts", Bell],
      ["users", "Users", Users],
      ["moderation", "Moderation", ShieldCheck],
      ["website", "Website", Eye],
      ["registration", "Registration", KeyRound],
      ["activity", "Security activity", Activity],
      ["audit", "Admin audit", History],
      ["backups", "Backups", FolderOpen],
      ["reports", "Reports", Download],
      ["maintenance", "Maintenance", SlidersHorizontal],
      ["system", "System", Settings],
    ],
    requested = location.hash.slice(1),
    [section, setSection] = useState(
      sections.some(([name]) => name === requested) ? requested : "overview",
    ),
    choose = (name) => {
      setSection(name);
      window.history.replaceState(null, "", `/admin#${name}`);
    };
  return (
    <div className="site account-route">
      <PageHeader user={user} logout={logout} />
      <main className="settings-page admin-page">
        <header className="route-title">
          <span>SYSTEM / ADMINISTRATION</span>
          <h1>Admin dashboard</h1>
          <p>Registration, users, permissions, and system totals.</p>
        </header>
        <div className="settings-layout">
          <aside className="settings-navigation">
            {sections.map(([name, label, Icon]) => (
              <button
                key={name}
                className={section === name ? "active" : ""}
                onClick={() => choose(name)}
              >
                <Icon /> {label}
              </button>
            ))}
          </aside>
          <section className="settings-content">
            <AdminPanel currentUser={user} section={section} />
          </section>
        </div>
      </main>
    </div>
  );
}
function KnowledgeView({ journals }) {
  const [data, setData] = useState({
      entries: [],
      links: [],
      people: [],
      collections: [],
    }),
    [selected, setSelected] = useState("");
  const load = () =>
    fetch("/api/knowledge")
      .then((response) => response.json())
      .then((result) => {
        setData(result);
        setSelected(
          (current) => current || String(result.entries[0]?.id || ""),
        );
      });
  useEffect(load, []);
  const request = async (path, options) => {
    const response = await fetch(path, options);
    if (!response.ok) {
      const result = await response.json();
      alert(result.error || "Could not update knowledge graph");
      return false;
    }
    await load();
    return true;
  };
  const postForm = (path, event) => {
    event.preventDefault();
    const form = event.currentTarget;
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    }).then((ok) => ok && form.reset());
  };
  const selectedId = +selected,
    selectedEntry = data.entries.find((item) => item.id === selectedId),
    graphEntries = data.entries.slice(0, 60),
    positioned = new Map(),
    place = (items, radius, prefix, offset = 0) =>
      items.forEach((item, index) =>
        positioned.set(`${prefix}${item.id}`, {
          x:
            500 +
            Math.cos(
              (index / Math.max(1, items.length)) * Math.PI * 2 + offset,
            ) *
              radius,
          y:
            300 +
            Math.sin(
              (index / Math.max(1, items.length)) * Math.PI * 2 + offset,
            ) *
              radius,
        }),
      );
  place(graphEntries, 255, "e");
  place(data.people.slice(0, 30), 165, "p", 0.25);
  place(data.collections.slice(0, 20), 75, "c", 0.5);
  const graphEdges = [
    ...data.links.map((item) => ({
      from: `e${item.sourceId}`,
      to: `e${item.targetId}`,
      kind: "link",
    })),
    ...data.people.flatMap((person) =>
      person.entryIds.map((entryId) => ({
        from: `p${person.id}`,
        to: `e${entryId}`,
        kind: "person",
      })),
    ),
    ...data.collections.flatMap((collection) =>
      collection.entryIds.map((entryId) => ({
        from: `c${collection.id}`,
        to: `e${entryId}`,
        kind: "collection",
      })),
    ),
  ];
  return (
    <section className="knowledge-view">
      <div className="knowledge-controls">
        <label>
          ACTIVE ENTRY
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {data.entries.map((item) => (
              <option key={item.id} value={item.id}>
                {item.date || item.entry_date} · {item.title}
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={(event) =>
            postForm(`/api/entries/${selectedId}/links`, event)
          }
        >
          <strong>LINK AN ENTRY</strong>
          <select name="targetId" required>
            {data.entries
              .filter((item) => item.id !== selectedId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
          </select>
          <input
            name="label"
            placeholder="relationship"
            defaultValue="related"
          />
          <button disabled={!selectedId}>LINK</button>
        </form>
        <form onSubmit={(event) => postForm("/api/people", event)}>
          <strong>NEW PERSON</strong>
          <input name="name" placeholder="Name" required />
          <input name="notes" placeholder="Notes" />
          <button>
            <UserRound /> ADD
          </button>
        </form>
        <form onSubmit={(event) => postForm("/api/collections", event)}>
          <strong>NEW COLLECTION</strong>
          <input name="name" placeholder="Collection" required />
          <select name="journalId">
            {journals
              .filter((journal) => ["owner", "editor"].includes(journal.role))
              .map((journal) => (
                <option key={journal.id} value={journal.id}>
                  {journal.name}
                </option>
              ))}
          </select>
          <input name="color" type="color" defaultValue="#bb9af7" />
          <button>
            <FolderOpen /> ADD
          </button>
        </form>
      </div>
      <div className="knowledge-associations">
        <article>
          <h3>PEOPLE IN “{selectedEntry?.title || "ENTRY"}”</h3>
          {data.people.map((person) => (
            <button
              className={person.entryIds.includes(selectedId) ? "active" : ""}
              key={person.id}
              onClick={() =>
                request(`/api/entries/${selectedId}/people/${person.id}`, {
                  method: "POST",
                })
              }
            >
              @{person.name}
            </button>
          ))}
        </article>
        <article>
          <h3>COLLECTIONS</h3>
          {data.collections
            .filter(
              (collection) =>
                collection.journalId === selectedEntry?.journal_id,
            )
            .map((collection) => (
              <button
                style={{ borderColor: collection.color }}
                className={
                  collection.entryIds.includes(selectedId) ? "active" : ""
                }
                key={collection.id}
                onClick={() =>
                  request(
                    `/api/collections/${collection.id}/entries/${selectedId}`,
                    { method: "POST" },
                  )
                }
              >
                {collection.name}
              </button>
            ))}
        </article>
        <article>
          <h3>LINKS / BACKLINKS</h3>
          {data.links
            .filter(
              (link) =>
                link.sourceId === selectedId || link.targetId === selectedId,
            )
            .map((link) => {
              const outbound = link.sourceId === selectedId,
                other = data.entries.find(
                  (item) =>
                    item.id === (outbound ? link.targetId : link.sourceId),
                );
              return (
                <span key={link.id}>
                  <b>
                    {outbound ? "→" : "←"} {link.label}
                  </b>
                  {other?.title}
                  <button
                    onClick={() =>
                      request(`/api/entry-links/${link.id}`, {
                        method: "DELETE",
                      })
                    }
                  >
                    <X />
                  </button>
                </span>
              );
            })}
        </article>
      </div>
      <div className="graph-canvas">
        <svg
          viewBox="0 0 1000 600"
          role="img"
          aria-label="Entry knowledge graph"
        >
          {graphEdges.map((edge, index) => {
            const from = positioned.get(edge.from),
              to = positioned.get(edge.to);
            return from && to ? (
              <line
                key={index}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className={edge.kind}
              />
            ) : null;
          })}
          {graphEntries.map((item) => {
            const point = positioned.get(`e${item.id}`);
            return (
              <g
                key={`e${item.id}`}
                className={
                  item.id === selectedId ? "entry-node selected" : "entry-node"
                }
                onClick={() => setSelected(String(item.id))}
              >
                <circle cx={point.x} cy={point.y} r="11" />
                <text x={point.x + 15} y={point.y + 4}>
                  {item.title.slice(0, 18)}
                </text>
              </g>
            );
          })}
          {data.people.slice(0, 30).map((item) => {
            const point = positioned.get(`p${item.id}`);
            return (
              <g key={`p${item.id}`} className="person-node">
                <circle cx={point.x} cy={point.y} r="8" />
                <text x={point.x + 11} y={point.y + 3}>
                  @{item.name.slice(0, 14)}
                </text>
              </g>
            );
          })}
          {data.collections.slice(0, 20).map((item) => {
            const point = positioned.get(`c${item.id}`);
            return (
              <g key={`c${item.id}`} className="collection-node">
                <rect
                  x={point.x - 8}
                  y={point.y - 8}
                  width="16"
                  height="16"
                  style={{ fill: item.color }}
                />
                <text x={point.x + 12} y={point.y + 3}>
                  {item.name.slice(0, 14)}
                </text>
              </g>
            );
          })}
        </svg>
        <footer>
          <span>● ENTRIES</span>
          <span>● PEOPLE</span>
          <span>■ COLLECTIONS</span>
          <span>
            {data.links.length} LINKS · {data.people.length} PEOPLE ·{" "}
            {data.collections.length} COLLECTIONS
          </span>
        </footer>
      </div>
    </section>
  );
}
function StatisticsView({ entries, preferences, userId }) {
  const personalEntries = entries.filter((item) => !item.userId || Number(item.userId) === Number(userId)),
    dates = [...new Set(personalEntries.map((entry) => entry.date))]
      .sort()
      .reverse(),
    day = 86400000,
    gap = (a, b) =>
      Math.round(
        (new Date(a + "T12:00:00Z") - new Date(b + "T12:00:00Z")) / day,
      ),
    streaks = dates.reduce(
      (result, date, index) => {
        if (index === 0 || gap(dates[index - 1], date) === 1)
          result[result.length - 1].push(date);
        else result.push([date]);
        return result;
      },
      [[]],
    ),
    now = new Date(),
    today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    currentStreak =
      dates[0] && gap(today, dates[0]) <= 1 ? streaks[0]?.length || 0 : 0,
    longestStreak = Math.max(0, ...streaks.map((streak) => streak.length)),
    words = personalEntries.reduce(
      (sum, entry) =>
        sum + entry.body.join(" ").trim().split(/\s+/).filter(Boolean).length,
      0,
    ),
    media = personalEntries.reduce((sum, entry) => sum + (entry.media?.length || 0), 0),
    tagCounts = personalEntries
      .flatMap((entry) => entry.tags)
      .reduce(
        (counts, tag) => ({ ...counts, [tag]: (counts[tag] || 0) + 1 }),
        {},
      ),
    months = personalEntries.reduce(
      (counts, entry) => ({
        ...counts,
        [entry.date.slice(0, 7)]: (counts[entry.date.slice(0, 7)] || 0) + 1,
      }),
      {},
    ),
    monthRows = Array.from({ length: 12 }, (_, index) => {
      const value = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1), key = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
      return [key, months[key] || 0, value.toLocaleDateString(undefined, { month: "short" }).toUpperCase()];
    }),
    maxMonth = Math.max(1, ...monthRows.map(([, count]) => count)),
    weekdayCounts = personalEntries.reduce((counts, entry) => { counts[new Date(`${entry.date}T12:00:00`).getDay()] += 1; return counts; }, [0, 0, 0, 0, 0, 0, 0]),
    maxWeekday = Math.max(1, ...weekdayCounts),
    visibilityCounts = personalEntries.reduce((counts, entry) => { counts[entry.visibility === "public" ? "shared" : "private"] += 1; return counts; }, { private: 0, shared: 0 }),
    privatePercent = personalEntries.length ? Math.round((visibilityCounts.private / personalEntries.length) * 100) : 0,
    topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10),
    maxTag = Math.max(1, ...topTags.map(([, count]) => count)),
    weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)),
    weeklyEntries = personalEntries.filter((item) => new Date(`${item.date}T12:00:00`) >= weekStart).length,
    monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    monthlyWords = personalEntries.filter((item) => item.date.startsWith(monthPrefix)).reduce((sum, item) => sum + item.body.join(" ").trim().split(/\s+/).filter(Boolean).length, 0),
    goals = preferences?.writingGoals || {};
  return (
    <section className="statistics-view">
      <div className="stat-cards">
        <article>
          <strong>{personalEntries.length}</strong>
          <span>ENTRIES</span>
        </article>
        <article>
          <strong>{words.toLocaleString()}</strong>
          <span>WORDS</span>
        </article>
        <article>
          <strong>{currentStreak}</strong>
          <span>CURRENT STREAK</span>
        </article>
        <article>
          <strong>{longestStreak}</strong>
          <span>LONGEST STREAK</span>
        </article>
        <article>
          <strong>{media}</strong>
          <span>ATTACHMENTS</span>
        </article>
        <article>
          <strong>{Object.keys(tagCounts).length}</strong>
          <span>TOPICS</span>
        </article>
      </div>
      <div className="goal-progress-grid">
        <article><header><span>WEEKLY ENTRY GOAL</span><strong>{weeklyEntries} / {goals.weeklyEntries || 0}</strong></header><i><b style={{ width: `${goals.weeklyEntries ? Math.min(100, weeklyEntries / goals.weeklyEntries * 100) : 0}%` }} /></i></article>
        <article><header><span>MONTHLY WORD GOAL</span><strong>{monthlyWords.toLocaleString()} / {Number(goals.monthlyWords || 0).toLocaleString()}</strong></header><i><b style={{ width: `${goals.monthlyWords ? Math.min(100, monthlyWords / goals.monthlyWords * 100) : 0}%` }} /></i></article>
      </div>
      <div className="stats-grid">
        <article className="monthly-stat-chart">
          <header><h3>LAST 12 MONTHS</h3><span>{personalEntries.length} ENTRIES TOTAL</span></header>
          <div className="vertical-stat-chart">{monthRows.map(([month, count, label]) => <div key={month}><strong>{count}</strong><i><b style={{ height: `${(count / maxMonth) * 100}%` }} /></i><span>{label}</span></div>)}</div>
        </article>
        <article className="visibility-stat-chart">
          <header><h3>VISIBILITY</h3><span>ENTRY PRIVACY</span></header>
          <div><i style={{ background: `conic-gradient(#9ece6a 0 ${privatePercent}%, #7aa2f7 ${privatePercent}% 100%)` }}><strong>{privatePercent}%</strong><small>PRIVATE</small></i><ul><li><b className="private" />PRIVATE <strong>{visibilityCounts.private}</strong></li><li><b className="shared" />SHARED <strong>{visibilityCounts.shared}</strong></li></ul></div>
        </article>
        <article className="weekday-stat-chart">
          <header><h3>WRITING DAYS</h3><span>ENTRIES BY WEEKDAY</span></header>
          <div className="vertical-stat-chart weekday-bars">{["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((label, index) => <div key={label}><strong>{weekdayCounts[index]}</strong><i><b style={{ height: `${weekdayCounts[index] / maxWeekday * 100}%` }} /></i><span>{label}</span></div>)}</div>
        </article>
        <article className="topic-stat-chart">
          <header><h3>MOST USED TOPICS</h3><span>{Object.keys(tagCounts).length} UNIQUE</span></header>
          {topTags.map(([tag, count]) => <div className="topic-stat" key={tag}><span>#{tag}</span><i><b style={{ width: `${count / maxTag * 100}%` }} /></i><strong>{count}</strong></div>)}
          {!topTags.length && <p className="trash-empty">NO TOPICS YET_</p>}
        </article>
      </div>
    </section>
  );
}
function DiscoveryPanel({ entries, open }) {
  const today = new Date(),
    monthDay = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
    memories = entries.filter((entry) => entry.date.slice(5) === monthDay);
  return (
    <div className="discovery-panel">
      <header>
        <span>ARCHIVE</span>
        <strong>{entries.length.toLocaleString()} DAYS</strong>
      </header>
      <article className="random-discovery">
        <button
          disabled={!entries.length}
          onClick={() =>
            open(entries[Math.floor(Math.random() * entries.length)])
          }
        >
          RANDOM ENTRY <span aria-hidden="true">→</span>
        </button>
      </article>
      <article>
        <span>ON THIS DAY / {monthDay}</span>
        {memories.length ? (
          memories.map((entry) => (
            <button key={entry.id} onClick={() => open(entry)}>
              {entry.date.slice(0, 4)} · {entry.title}
            </button>
          ))
        ) : (
          <p>No memories for this date yet.</p>
        )}
      </article>
    </div>
  );
}
function EntryPeek({ entry, close }) {
  return (
    <div
      className="modal peek-modal"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <article>
        <header>
          <span>
            {entry.date} · {entry.author || "YOU"}
          </span>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <h2>{entry.title}</h2>
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {entry.body.join("\n\n")}
          </ReactMarkdown>
        </div>
        {entry.media?.length > 0 && <Media items={entry.media} />}
        <footer>
          {entry.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </footer>
      </article>
    </div>
  );
}
function AdvancedFilters({ value, change, clear }) {
  return (
    <section className="advanced-filters">
      <label>
        FROM
        <input
          type="date"
          value={value.from || ""}
          onChange={(event) => change("from", event.target.value)}
        />
      </label>
      <label>
        TO
        <input
          type="date"
          value={value.to || ""}
          onChange={(event) => change("to", event.target.value)}
        />
      </label>
      <label>
        MOOD
        <input
          placeholder="Any mood"
          value={value.mood || ""}
          onChange={(event) => change("mood", event.target.value)}
        />
      </label>
      <label>
        VISIBILITY
        <select
          value={value.visibility || ""}
          onChange={(event) => change("visibility", event.target.value)}
        >
          <option value="">Any</option>
          <option value="private">Private</option>
          <option value="public">Shared</option>
        </select>
      </label>
      <label className="filter-check">
        <input
          type="checkbox"
          checked={value.media === "true"}
          onChange={(event) =>
            change("media", event.target.checked ? "true" : "")
          }
        />
        HAS MEDIA
      </label>
      <label className="filter-check">
        <input
          type="checkbox"
          checked={value.located === "true"}
          onChange={(event) =>
            change("located", event.target.checked ? "true" : "")
          }
        />
        HAS LOCATION
      </label>
      <label className="filter-check">
        <input
          type="checkbox"
          checked={value.owner === "mine"}
          onChange={(event) =>
            change("owner", event.target.checked ? "mine" : "")
          }
        />
        ONLY MINE
      </label>
      <button onClick={clear}>CLEAR FILTERS</button>
    </section>
  );
}
function CalendarView({ entries, year, preferences, openDay }) {
  const byDay = entries.reduce((days, entry) => {
    (days[entry.date] ||= []).push(entry);
    return days;
  }, {});
  const weekStart = preferences?.weekStartsOn || "monday",
    weekdays = weekStart === "sunday" ? ["S", "M", "T", "W", "T", "F", "S"] : weekStart === "saturday" ? ["S", "S", "M", "T", "W", "T", "F"] : ["M", "T", "W", "T", "F", "S", "S"],
    offsetFor = (day) => weekStart === "sunday" ? day : weekStart === "saturday" ? (day + 1) % 7 : (day + 6) % 7;
  return (
    <section className="calendar-view">
      {monthNames.map((month, monthIndex) => {
        const totalDays = new Date(+year, monthIndex + 1, 0).getDate(),
          offset = offsetFor(new Date(+year, monthIndex, 1).getDay());
        return (
          <article className="calendar-month" key={month}>
            <h3>{month.toUpperCase()}</h3>
            <div className="calendar-weekdays">
              {weekdays.map((day, i) => (
                <span key={`${day}${i}`}>{day}</span>
              ))}
            </div>
            <div className="calendar-days">
              {Array.from({ length: offset }, (_, i) => (
                <i key={`blank-${i}`} />
              ))}
              {Array.from({ length: totalDays }, (_, index) => {
                const day = index + 1,
                  key = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
                  dayEntries = byDay[key] || [];
                if (!dayEntries.length) return <span key={key}>{day}</span>;
                return <button type="button" className="recorded" key={key} title={`Open ${dayEntries.length} ${dayEntries.length === 1 ? "entry" : "entries"}: ${dayEntries.map((entry) => entry.title).join(" / ")}`} onClick={() => openDay(key)}>{day}<b>{dayEntries.length}</b></button>;
              })}
            </div>
          </article>
        );
      })}
    </section>
  );
}
function TimelineView({ entries, date, clearDate, preferences }) {
  const locale = preferences?.dateFormat === "us" ? "en-US" : preferences?.dateFormat === "iso" ? "sv-SE" : undefined,
    parts = (entry) => {
      const value = new Date(`${entry.date}T12:00:00`),
        time = entry.time && preferences?.timeFormat === "12h"
          ? new Date(`2000-01-01T${entry.time}`).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
          : entry.time;
      return { day: String(value.getDate()).padStart(2, "0"), monthYear: new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(value).toUpperCase(), time };
    };
  return (
    <section className="timeline-view">
      {date && <header className="timeline-day-header"><div><span>SHOWING ONE DAY</span><strong>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</strong></div><button onClick={clearDate}>SHOW ALL DATES</button></header>}
      {entries.map((entry) => {
        const stamp = parts(entry);
        return <article className="timeline-entry-link" key={entry.id} role="link" tabIndex="0" onClick={() => location.assign(`/entries/${entry.id}`)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); location.assign(`/entries/${entry.id}`); } }}>
          <time dateTime={`${entry.date}${entry.time ? `T${entry.time}` : ""}`}><strong>{stamp.day}</strong><span>{stamp.monthYear}{stamp.time && <small>{stamp.time}</small>}</span></time>
          <div>
            <div className="timeline-title-row">
              <h3>{entry.title}</h3>
              {entry.pinned && <span className="pinned-entry-indicator" title="Pinned entry" aria-label="Pinned entry"><Pin /> PINNED</span>}
              {!!entry.media?.length && <span className="timeline-attachment-indicator" title={`${entry.media.length} attachment${entry.media.length === 1 ? "" : "s"}`} aria-label={`${entry.media.length} attachment${entry.media.length === 1 ? "" : "s"}`}><Paperclip /></span>}
            </div>
            <p>
              {entry.body.join(" ").slice(0, 220)}
              {entry.body.join(" ").length > 220 ? "…" : ""}
            </p>
          </div>
          <span>{entry.tags.map((tag) => `#${tag}`).join(" ")}</span>
        </article>;
      })}
    </section>
  );
}
function GalleryView({ entries, preferences }) {
  const [openImage, setOpenImage] = useState(null),
    items = entries.flatMap((entry) =>
    (entry.media || [])
      .filter(
        (media) =>
          media.type?.startsWith("image") || media.type?.startsWith("video"),
      )
      .map((media) => ({ ...media, entry })),
  ),
    groups = Object.entries(items.reduce((result, item) => {
      (result[item.entry.date] ||= []).push(item);
      return result;
    }, {})).sort(([first], [second]) => second.localeCompare(first)),
    locale = preferences?.dateFormat === "us" ? "en-US" : preferences?.dateFormat === "iso" ? "sv-SE" : undefined,
    formatDate = (date) => new Intl.DateTimeFormat(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${date}T12:00:00`));
  useEffect(() => {
    if (!openImage) return;
    const close = (event) => event.key === "Escape" && setOpenImage(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [openImage]);
  if (!items.length)
    return <div className="nothing">NO PHOTOS OR VIDEOS IN THIS YEAR_</div>;
  return (
    <section className="gallery-view">
      {groups.map(([date, dayItems]) => <section className="gallery-day" key={date}>
        <header><h3>{formatDate(date)}</h3><span>{dayItems.length} {dayItems.length === 1 ? "ITEM" : "ITEMS"}</span></header>
        <div className="gallery-grid">{dayItems.map((item, index) => <figure key={`${item.entry.id}-${index}`}>
          {item.type.startsWith("video") ? <video src={item.url} controls /> : <button className="gallery-image-button" type="button" title="Open full-size image" onClick={() => setOpenImage(item)}><img src={item.thumbUrl || item.url} loading="lazy" alt={item.name || item.entry.title} /></button>}
          <figcaption><a href={`/entries/${item.entry.id}`}><strong>{item.entry.title}</strong><span>{item.name}</span></a></figcaption>
        </figure>)}</div>
      </section>)}
      {openImage && <div className="gallery-lightbox" role="dialog" aria-modal="true" aria-label={openImage.name || "Gallery image"} onMouseDown={(event) => event.target === event.currentTarget && setOpenImage(null)}><button className="gallery-lightbox-close" onClick={() => setOpenImage(null)} aria-label="Close full-size image"><X /></button><img src={openImage.url} alt={openImage.name || openImage.entry.title} /><span>{openImage.name || openImage.entry.title}</span></div>}
    </section>
  );
}
function GlobalMap({ entries, preferences }) {
  const located = entries.filter(
    (entry) =>
      Number.isFinite(+entry.latitude) && Number.isFinite(+entry.longitude),
  );
  if (!located.length)
    return <div className="nothing">NO GEO-TAGGED ENTRIES_</div>;
  const center = [
    located.reduce((sum, entry) => sum + +entry.latitude, 0) / located.length,
    located.reduce((sum, entry) => sum + +entry.longitude, 0) / located.length,
  ];
  return (
    <section className="global-map">
      <MapContainer
        center={center}
        zoom={located.length === 1 ? Number(preferences?.mapZoom || 11) : 3}
        scrollWheelZoom
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {located.map((entry) => (
          <CircleMarker
            key={entry.id}
            center={[+entry.latitude, +entry.longitude]}
            radius={8}
            pathOptions={{
              color: "#9ece6a",
              fillColor: "#7aa2f7",
              fillOpacity: 0.85,
            }}
          >
            <Popup>
              <strong>{entry.title}</strong>
              <br />
              {entry.date}
              <br />
              {entry.location}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      <p>{located.length} LOCATIONS · ALL YEARS · MAP DATA © OPENSTREETMAP</p>
    </section>
  );
}
function DiaryEntry({
  entry,
  preferences,
  onEdit,
  onDelete,
  onHistory,
  onShare,
  onUnlock,
  standalone = false,
}) {
  const locked = entry.encrypted && !entry._decrypted,
    locale = preferences?.dateFormat === "us" ? "en-US" : preferences?.dateFormat === "iso" ? "sv-SE" : undefined,
    formatEntryDate = (options) => new Intl.DateTimeFormat(locale, options).format(new Date(`${entry.date}T12:00:00`)),
    displayTime = entry.time && preferences?.timeFormat === "12h"
      ? new Date(`2000-01-01T${entry.time}`).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
      : entry.time,
    imperial = preferences?.distanceUnit === "imperial",
    fahrenheit = preferences?.temperatureUnit === "fahrenheit",
    temperature = (value) => fahrenheit ? Math.round((Number(value) * 9) / 5 + 32) : value,
    formatTimestamp = (value) => {
      try {
        return new Date(value).toLocaleString(locale, preferences?.timezone && preferences.timezone !== "auto" ? { timeZone: preferences.timezone } : undefined);
      } catch {
        return new Date(value).toLocaleString(locale);
      }
    },
    map =
      entry.latitude && entry.longitude
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${+entry.longitude - 0.02}%2C${+entry.latitude - 0.015}%2C${+entry.longitude + 0.02}%2C${+entry.latitude + 0.015}&layer=mapnik&marker=${entry.latitude}%2C${entry.longitude}`
        : null;
  return (
    <article className="diary-entry" id={`entry-${entry.id}`}>
      <header>
        <div className="date">
          <strong>
            {String(new Date(entry.date + "T12:00:00").getDate()).padStart(
              2,
              "0",
            )}
          </strong>
          <span>
            {formatEntryDate({ month: "short" }).toUpperCase()}
            <br />
            {formatEntryDate({ year: "numeric" })}
            {entry.time && (
              <>
                <br />
                <time>{displayTime}</time>
              </>
            )}
          </span>
        </div>
        <div className="entry-heading">
          <div className="entry-title-row">
            <div className="entry-title-group">
              <h2>
                <a href={`/entries/${entry.id}`}>{entry.title}</a>
              </h2>
              {entry.pinned && (
                <span className="pinned-entry-indicator" title="Pinned entry" aria-label="Pinned entry">
                  <Pin /> PINNED
                </span>
              )}
            </div>
            {!standalone && (
              <div className="entry-actions">
                {locked && (
                  <button onClick={() => onUnlock(entry)}>
                    <LockKeyhole /> UNLOCK
                  </button>
                )}
                {entry.owner !== false && (
                  <>
                    {!locked && (
                      <>
                        <button onClick={() => onEdit(entry)}>
                          <Pencil /> EDIT
                        </button>
                        <button onClick={() => onHistory(entry)}>
                          <History /> HISTORY
                        </button>
                        {!entry.encrypted && (
                          <button onClick={() => onShare(entry)}>
                            <Link2 /> SHARE
                          </button>
                        )}
                      </>
                    )}
                    <button className="danger" onClick={() => onDelete(entry)}>
                      <Trash2 /> DELETE
                    </button>
                    {entry.visibility === "private" && <span className="private-entry-indicator" title="Private entry" aria-label="Private entry"><LockKeyhole /></span>}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="entry-meta-row">
            <span className="weekday">
              {formatEntryDate({ weekday: "long" }).toUpperCase()} ·{" "}
              {entry.author || "YOU"}
              {entry.encrypted && " · END-TO-END ENCRYPTED"}
            </span>
            {entry.location && (
              <span className="header-location">
                <MapPin /> {entry.location}
              </span>
            )}
          </div>
        </div>
      </header>
      <div className="entry-body">
        {locked ? (
          <div className="encrypted-placeholder">
            <LockKeyhole />
            <strong>CLIENT-SIDE ENCRYPTED ENTRY</strong>
            <span>
              The server stores only opaque ciphertext. Enter the passphrase in
              this browser to read it.
            </span>
            <button onClick={() => onUnlock(entry)}>UNLOCK ENTRY</button>
          </div>
        ) : (
          <>
            {entry.mood && (
              <div className="entry-context">
                <span>MOOD: {entry.mood}</span>
              </div>
            )}
            {entry.reminderAt && (
              <div className="entry-context">
                <span>
                  <Bell /> REMINDER:{" "}
                  {formatTimestamp(entry.reminderAt)}
                </span>
              </div>
            )}
            {entry.weather && (
              <div className="entry-context weather-summary">
                <span>
                  WEATHER: WMO {entry.weather.code} ·{" "}
                  {temperature(entry.weather.temperatureMin)}–{temperature(entry.weather.temperatureMax)}
                  °{fahrenheit ? "F" : "C"} · {imperial ? (Number(entry.weather.precipitation) / 25.4).toFixed(2) : entry.weather.precipitation} {imperial ? "in" : "mm"} precipitation ·{" "}
                  {imperial ? Math.round(Number(entry.weather.windMax) * 0.621371) : entry.weather.windMax} {imperial ? "mph" : "km/h"} wind
                </span>
              </div>
            )}
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {entry.body.join("\n\n")}
              </ReactMarkdown>
            </div>
            {entry.media?.length > 0 && <Media items={entry.media} />}{" "}
            {map && (
              <iframe
                className="map"
                title={entry.location || "Entry location"}
                src={map}
              />
            )}
            {entry.link && <LinkPreview url={entry.link} />}
            <div className="entry-tags">
              {entry.tags.map((t) => (
                <a
                  key={t}
                  href={`/?tag=${encodeURIComponent(t)}&year=${entry.date.slice(0, 4)}#diary`}
                >
                  #{t}
                </a>
              ))}
              {!standalone && (
                <a
                  className="discuss-link"
                  href={`/entries/${entry.id}#discussion`}
                >
                  <MessageSquare /> DISCUSS
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  );
}
function DeleteEntryModal({ entry, close, confirm }) {
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const onKeyDown = (event) => event.key === "Escape" && !working && close();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, working]);
  return (
    <div className="modal delete-entry-modal" role="dialog" aria-modal="true" aria-labelledby="delete-entry-title" onMouseDown={(event) => event.target === event.currentTarget && !working && close()}>
      <section>
        <header>
          <div><Trash2 /><span>MOVE ENTRY TO TRASH</span></div>
          <button type="button" onClick={close} disabled={working} aria-label="Close"><X /></button>
        </header>
        <div className="delete-entry-copy">
          <span>ENTRY</span>
          <h2 id="delete-entry-title">{entry.title}</h2>
          <p>This entry will be moved to Trash. You can restore it later from your data settings.</p>
        </div>
        <footer>
          <button type="button" onClick={close} disabled={working}>CANCEL</button>
          <button type="button" className="danger" autoFocus disabled={working} onClick={async () => { setWorking(true); await confirm(); setWorking(false); }}><Trash2 /> {working ? "MOVING_" : "MOVE TO TRASH"}</button>
        </footer>
      </section>
    </div>
  );
}
function LinkPreview({ url }) {
  const [preview, setPreview] = useState(null),
    youtube = url.match(
      /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/,
    )?.[1],
    vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
  useEffect(() => {
    if (youtube || vimeo) return;
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then(setPreview)
      .catch(() => {});
  }, [url, youtube, vimeo]);
  if (youtube || vimeo)
    return (
      <div className="video-embed">
        <iframe
          src={
            youtube
              ? `https://www.youtube-nocookie.com/embed/${youtube}`
              : `https://player.vimeo.com/video/${vimeo}`
          }
          title="Embedded video"
          loading="lazy"
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
        <a href={url} target="_blank" rel="noreferrer">
          OPEN ORIGINAL VIDEO ↗
        </a>
      </div>
    );
  if (!preview)
    return (
      <p className="external">
        LINK: <a href={url}>{url}</a>
      </p>
    );
  return (
    <a className="link-preview" href={url} target="_blank" rel="noreferrer">
      {preview.image && (
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      <span>
        <small>{preview.siteName}</small>
        <strong>{preview.title}</strong>
        {preview.description && <p>{preview.description}</p>}
      </span>
    </a>
  );
}
function Media({ items }) {
  const exposureLabel = (value) => {
      const exposure = Number(value);
      if (!exposure) return "";
      return exposure < 1 ? `1/${Math.round(1 / exposure)} s` : `${exposure} s`;
    },
    photoRows = (item) => {
      const info = item.metadata || {};
      return [
        ["CAMERA", [info.make, info.model].filter(Boolean).join(" ")],
        ["LENS", info.lens],
        ["EXPOSURE", exposureLabel(info.exposure)],
        ["APERTURE", info.aperture ? `f/${info.aperture}` : ""],
        ["ISO", info.iso],
        ["FOCAL LENGTH", info.focalLength ? `${info.focalLength} mm` : ""],
        ["DIMENSIONS", info.width && info.height ? `${info.width} × ${info.height}` : ""],
        ["CAPTURED", info.capturedAt ? new Date(info.capturedAt).toLocaleString() : ""],
        ["FILE", `${item.name || "Image"}${item.size ? ` · ${readableBytes(item.size)}` : ""}`],
      ].filter(([, value]) => value !== "" && value !== null && value !== undefined);
    };
  return (
    <div className="media">
      {items.map((m, i) =>
        m.type.startsWith("image") ? (
          <figure key={i}>
            <div className="media-photo-wrap">
              <a href={m.url} target="_blank" title="Open original">
                <img src={m.thumbUrl || m.url} loading="lazy" alt={m.caption || m.name} />
              </a>
              <div className="photo-information" aria-label="Photo information">
                <header><Camera /> PHOTO INFORMATION</header>
                <dl>{photoRows(m).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              </div>
            </div>
            <figcaption>
              {m.caption || `IMG_${String(i + 1).padStart(3, "0")} — ${m.name}`}
            </figcaption>
          </figure>
        ) : m.type.startsWith("video") ? (
          <video key={i} src={m.url} controls />
        ) : m.type.startsWith("audio") ? (
          <audio key={i} src={m.url} controls />
        ) : (
          <a key={i} href={m.url} download={m.name}>
            <Paperclip />
            {m.name}
          </a>
        ),
      )}
    </div>
  );
}
function Composer({ close, submit, entry, userId, uploadProgress, journals, preferences }) {
  const shared = new URLSearchParams(location.search),
    sharedTitle = shared.has("share") ? shared.get("title") || "" : "",
    sharedContent = shared.has("share")
      ? [shared.get("text"), shared.get("url")].filter(Boolean).join("\n\n")
      : "",
    draftKey = `field-log:draft:${userId}:${entry?.id || "new"}`,
    savedDraft = (() => {
      try {
        return JSON.parse(localStorage.getItem(draftKey)) || {};
      } catch {
        return {};
      }
    })(),
    rememberedOptions = (() => {
      if (!preferences?.rememberEntryOptions || entry) return {};
      try {
        return JSON.parse(localStorage.getItem(`field-log:entry-defaults:${userId}`)) || {};
      } catch {
        return {};
      }
    })(),
    [files, setFiles] = useState([]),
    [captions, setCaptions] = useState([]),
    [mediaMetadata, setMediaMetadata] = useState([]),
    [storage, setStorage] = useState(null),
    [existingMedia, setExistingMedia] = useState(entry?.media || []),
    [title, setTitle] = useState(
      savedDraft.title ?? entry?.title ?? sharedTitle,
    ),
    [content, setContent] = useState(
      savedDraft.content ?? entry?.body?.join("\n\n") ?? sharedContent,
    ),
    [preview, setPreview] = useState(preferences?.editorMode === "rich" && !!(savedDraft.content ?? entry?.body?.length)),
    [fullscreen, setFullscreen] = useState(false),
    [encrypted, setEncrypted] = useState(entry?.encrypted || false),
    [recording, setRecording] = useState(false),
    [entryDate, setEntryDate] = useState(
      entry?.date || new Date().toISOString().slice(0, 10),
    ),
    [entryTime, setEntryTime] = useState(
      entry?.time || new Date().toTimeString().slice(0, 5),
    ),
    [locationName, setLocationName] = useState(entry?.location || ""),
    [latitude, setLatitude] = useState(entry?.latitude ?? ""),
    [longitude, setLongitude] = useState(entry?.longitude ?? ""),
    [placeResults, setPlaceResults] = useState([]),
    [weather] = useState(entry?.weather || rememberedOptions.weather || null),
    [transcribeAudio, setTranscribeAudio] = useState(false),
    [ocrProgress, setOcrProgress] = useState(null),
    textareaRef = useRef(null),
    formRef = useRef(null),
    recorderRef = useRef(null),
    recognitionRef = useRef(null),
    transcriptRef = useRef(""),
    wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      recorder?.stream?.getTracks().forEach((track) => track.stop());
      recognitionRef.current?.stop();
    },
    [],
  );
  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      recognitionRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }),
        chunks = [],
        recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) =>
        event.data.size && chunks.push(event.data);
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm",
          extension = type.includes("ogg") ? "ogg" : "webm",
          file = new File(chunks, `voice-${Date.now()}.${extension}`, { type });
        setFiles((current) => [...current, file]);
        setCaptions((current) => [...current, "Voice note"]);
        setMediaMetadata((current) => [...current, {}]);
        if (transcriptRef.current.trim()) {
          const transcript = transcriptRef.current.trim();
          setContent(
            (current) =>
              `${current}${current.trim() ? "\n\n" : ""}## Voice transcript\n\n${transcript}`,
          );
        }
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
      };
      recorderRef.current = recorder;
      transcriptRef.current = "";
      if (transcribeAudio) {
        const SpeechRecognition =
          window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = false;
          recognition.lang = navigator.language || "en-US";
          recognition.onresult = (event) => {
            for (
              let index = event.resultIndex;
              index < event.results.length;
              index += 1
            )
              if (event.results[index].isFinal)
                transcriptRef.current += `${event.results[index][0].transcript} `;
          };
          recognition.start();
          recognitionRef.current = recognition;
        }
      }
      recorder.start();
      setRecording(true);
    } catch {
      alert("Microphone access is unavailable or was denied.");
    }
  };
  const recognizeImage = async (file) => {
    setOcrProgress({ file: file.name, progress: 0 });
    let worker;
    try {
      worker = await createWorker("eng", 1, {
        logger: (message) =>
          message.status === "recognizing text" &&
          setOcrProgress({
            file: file.name,
            progress: Math.round(message.progress * 100),
          }),
      });
      const result = await worker.recognize(file),
        recognized = result.data.text.trim();
      if (!recognized) throw new Error("No text was detected in this image");
      setContent(
        (current) =>
          `${current}${current.trim() ? "\n\n" : ""}## Text from ${file.name}\n\n${recognized}`,
      );
    } catch (error) {
      alert(error.message || "OCR failed");
    } finally {
      await worker?.terminate();
      setOcrProgress(null);
    }
  };
  const readPhotoMetadata = async (file) => {
    if (!file?.type.startsWith("image/")) return {};
    try {
      const metadata = await exifr.parse(file, {
        gps: true,
        tiff: true,
        exif: true,
      });
      if (Number.isFinite(metadata?.latitude)) setLatitude(metadata.latitude);
      if (Number.isFinite(metadata?.longitude))
        setLongitude(metadata.longitude);
      if (metadata?.DateTimeOriginal && !entry) {
        const capturedAt = new Date(metadata.DateTimeOriginal);
        setEntryDate(capturedAt.toISOString().slice(0, 10));
        setEntryTime(capturedAt.toTimeString().slice(0, 5));
      }
      return {
        make: String(metadata?.Make || "").slice(0, 100),
        model: String(metadata?.Model || "").slice(0, 100),
        lens: String(metadata?.LensModel || metadata?.Lens || "").slice(0, 140),
        aperture: Number(metadata?.FNumber) || null,
        exposure: Number(metadata?.ExposureTime) || null,
        iso: Number(metadata?.ISO) || null,
        focalLength: Number(metadata?.FocalLength) || null,
        width: Number(metadata?.ExifImageWidth || metadata?.ImageWidth) || null,
        height: Number(metadata?.ExifImageHeight || metadata?.ImageHeight) || null,
        capturedAt: metadata?.DateTimeOriginal ? new Date(metadata.DateTimeOriginal).toISOString() : null,
      };
    } catch {
      return {};
    }
  };
  const searchPlaces = async () => {
    if (locationName.trim().length < 3) return;
    const response = await fetch(
      `/api/places?q=${encodeURIComponent(locationName)}`,
    );
    if (response.ok) setPlaceResults(await response.json());
  };
  const prepareUpload = async (file) => {
    const qualitySetting = preferences?.imageQuality || "high";
    if (!file.type.startsWith("image/") || qualitySetting === "original" || file.type === "image/gif") return file;
    const settings = {
      high: [2560, 0.9],
      balanced: [1920, 0.8],
      compact: [1280, 0.7],
    }[qualitySetting] || [2560, 0.9];
    const bitmap = await createImageBitmap(file),
      scale = Math.min(1, settings[0] / Math.max(bitmap.width, bitmap.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", settings[1]));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg", lastModified: file.lastModified }) : file;
  };
  useEffect(() => {
    if (preferences?.autosave === false) return;
    const timer = setTimeout(
      () => localStorage.setItem(draftKey, JSON.stringify({ title, content })),
      500,
    );
    return () => clearTimeout(timer);
  }, [draftKey, title, content, preferences?.autosave]);
  useEffect(() => {
    fetch("/api/storage")
      .then((response) => (response.ok ? response.json() : null))
      .then(setStorage);
  }, []);
  const format = (before, after = before, fallback = "text") => {
    const field = textareaRef.current;
    if (!field) return;
    const start = field.selectionStart,
      end = field.selectionEnd,
      selected = content.slice(start, end) || fallback;
    setContent(
      `${content.slice(0, start)}${before}${selected}${after}${content.slice(end)}`,
    );
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(
        start + before.length,
        start + before.length + selected.length,
      );
    });
  };
  const keyDown = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      formRef.current?.requestSubmit();
    } else if (key === "b" || key === "i") {
      event.preventDefault();
      format(key === "b" ? "**" : "_");
    }
  };
  return (
    <div
      className={`modal composer-modal${fullscreen ? " fullscreen" : ""}`}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <form
        ref={formRef}
        onSubmit={(event) => submit(event, files, captions, mediaMetadata)}
        onKeyDown={keyDown}
      >
        <header>
          <span>{entry ? "EDIT_ENTRY" : "NEW_ENTRY"}</span>
          <div>
            <button
              type="button"
              title="Toggle full screen"
              onClick={() => setFullscreen(!fullscreen)}
            >
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
            </button>
            <button type="button" title="Close" onClick={close}>
              <X />
            </button>
          </div>
        </header>
        <input type="hidden" name="draftKey" value={draftKey} />
        <label>
          TITLE
          <input
            name="title"
            placeholder="What happened?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </label>
        <div className="form-grid">
          <label>
            DATE
            <input
              name="date"
              type="date"
              value={entryDate}
              onChange={(event) => setEntryDate(event.target.value)}
              required
            />
          </label>
          <label>
            TIME
            <input
              name="time"
              type="time"
              value={entryTime}
              onChange={(event) => setEntryTime(event.target.value)}
              required
            />
          </label>
        </div>
        <label>
          JOURNAL
          <select
            name="journalId"
            defaultValue={
              entry?.journalId ||
              rememberedOptions.journalId ||
              preferences?.defaultJournal ||
              journals.find((journal) => journal.isDefault)?.id
            }
            required
          >
            {journals
              .filter((journal) => journal.role !== "viewer")
              .map((journal) => (
                <option key={journal.id} value={journal.id}>
                  {journal.name}
                </option>
              ))}
          </select>
        </label>
        <div className="entry-editor-field">
          <span className="entry-editor-label">ENTRY</span>
          <div className="editor-toolbar">
            <button
              type="button"
              title="Bold (Ctrl+B)"
              onClick={() => format("**")}
            >
              <Bold />
            </button>
            <button
              type="button"
              title="Italic (Ctrl+I)"
              onClick={() => format("_")}
            >
              <Italic />
            </button>
            <button
              type="button"
              title="Heading"
              onClick={() => format("## ", "", "Heading")}
            >
              <Heading />
            </button>
            <button
              type="button"
              title="List"
              onClick={() => format("- ", "", "item")}
            >
              <List />
            </button>
            <button
              type="button"
              title="Checklist"
              onClick={() => format("- [ ] ", "", "task")}
            >
              <ListChecks />
            </button>
            <button type="button" title="Quote" onClick={() => format("> ")}>
              <Quote />
            </button>
            <button type="button" title="Code" onClick={() => format("`")}>
              <Code />
            </button>
            <button
              type="button"
              title="Link"
              onClick={() => format("[", "](https://)", "label")}
            >
              <Link2 />
            </button>
            <button
              type="button"
              className={preview ? "active" : ""}
              title="Preview"
              onClick={() => setPreview(!preview)}
            >
              <Eye />
            </button>
          </div>
          {preview ? (
            <div className="editor-preview markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content || "_Nothing to preview yet._"}
              </ReactMarkdown>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              name="body"
              rows="12"
              placeholder="Write it down... Markdown is supported."
              value={content}
              spellCheck={preferences?.spellcheck !== false}
              onChange={(e) => setContent(e.target.value)}
            />
          )}
          {preview && <input type="hidden" name="body" value={content} />}
          <small className="editor-status">
            {wordCount} WORDS / {content.length} CHARACTERS / DRAFT SAVED
            LOCALLY
          </small>
        </div>
        <label className="upload">
          <Paperclip /> ATTACH PHOTOS / VIDEO / AUDIO / FILES
          <input
            name="media"
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.txt"
            onChange={async (e) => {
              const selected = [...e.target.files];
              setMediaMetadata(await Promise.all(selected.map(readPhotoMetadata)));
              setFiles(await Promise.all(selected.map(prepareUpload)));
              setCaptions(selected.map(() => ""));
            }}
          />
        </label>
        <div className="mobile-capture">
          <label>
            <Camera /> TAKE PHOTO
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={async (event) => {
                const captured = [...event.target.files];
                const capturedMetadata = await Promise.all(captured.map(readPhotoMetadata));
                const prepared = await Promise.all(captured.map(prepareUpload));
                setFiles((current) => [...current, ...prepared]);
                setMediaMetadata((current) => [...current, ...capturedMetadata]);
                setCaptions((current) => [
                  ...current,
                  ...captured.map(() => "Mobile photo"),
                ]);
              }}
            />
          </label>
          <button
            type="button"
            className={recording ? "recording" : ""}
            onClick={toggleRecording}
          >
            {recording ? <Square /> : <Mic />}{" "}
            {recording ? "STOP RECORDING" : "RECORD VOICE"}
          </button>
        </div>
        <label className="check transcription-option">
          <input
            type="checkbox"
            checked={transcribeAudio}
            onChange={(event) => setTranscribeAudio(event.target.checked)}
            disabled={
              !(
                "SpeechRecognition" in window ||
                "webkitSpeechRecognition" in window
              )
            }
          />{" "}
          TRANSCRIBE VOICE WHILE RECORDING
          <small>
            Uses the browser speech service when available; leave off for
            private audio-only recording.
          </small>
        </label>
        {files.map((f, index) => (
          <div className="pending-file" key={`${f.name}-${f.lastModified}`}>
            <span>
              <Paperclip /> {f.name} / {(f.size / 1048576).toFixed(1)}MB
            </span>
            <input
              placeholder="Optional caption"
              value={captions[index] || ""}
              onChange={(event) =>
                setCaptions(
                  captions.map((caption, item) =>
                    item === index ? event.target.value : caption,
                  ),
                )
              }
            />
            {f.type.startsWith("image/") && (
              <button
                type="button"
                className="ocr-button"
                disabled={!!ocrProgress}
                onClick={() => recognizeImage(f)}
                title="Extract text from image"
              >
                {ocrProgress?.file === f.name
                  ? `OCR ${ocrProgress.progress}%`
                  : "OCR TEXT"}
              </button>
            )}
            <button
              type="button"
              title="Remove attachment"
              onClick={() => {
                setFiles(files.filter((_, item) => item !== index));
                setCaptions(captions.filter((_, item) => item !== index));
                setMediaMetadata(mediaMetadata.filter((_, item) => item !== index));
              }}
            >
              <X />
            </button>
          </div>
        ))}
        {uploadProgress > 0 && (
          <div className="upload-progress">
            <i style={{ width: `${uploadProgress}%` }} />
            <span>{uploadProgress}%</span>
          </div>
        )}
        {storage && (
          <small className="storage-usage">
            STORAGE: {(storage.used / 1073741824).toFixed(2)} /{" "}
            {(storage.quota / 1073741824).toFixed(0)} GB
          </small>
        )}
        <input
          type="hidden"
          name="existingMedia"
          value={JSON.stringify(existingMedia)}
        />
        {existingMedia.length > 0 && (
          <div className="existing-files">
            {existingMedia.map((m, i) => (
              <span key={i}>
                <Paperclip />
                <input
                  aria-label={`Caption for ${m.name}`}
                  placeholder={m.name}
                  value={m.caption || ""}
                  onChange={(event) =>
                    setExistingMedia(
                      existingMedia.map((item, x) =>
                        x === i
                          ? { ...item, caption: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setExistingMedia(existingMedia.filter((_, x) => x !== i))
                  }
                >
                  <X />
                </button>
              </span>
            ))}
          </div>
        )}
        <label>
          LINK
          <input
            name="link"
            type="url"
            placeholder="https://..."
            defaultValue={entry?.link || ""}
          />
        </label>
        <label>
          TAGS
          <input
            name="tags"
            placeholder="life, making, travel"
            defaultValue={entry?.tags?.join(", ") || rememberedOptions.tags || ""}
          />
        </label>
        <input type="hidden" name="mood" value={entry?.mood || ""} />
        <div className="form-grid single-control">
          <label>
            VISIBILITY
            <select
              name="visibility"
              defaultValue={entry?.visibility || rememberedOptions.visibility || preferences?.defaultVisibility || "private"}
            >
              <option value="private">Private</option>
              <option value="public">Shared</option>
            </select>
          </label>
        </div>
        <label>
          LOCATION SEARCH
          <div className="location-search">
            <input
              name="location"
              placeholder="Berlin, Germany"
              value={locationName}
              onChange={(event) => setLocationName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  searchPlaces();
                }
              }}
            />
            <button type="button" onClick={searchPlaces}>
              <Search /> FIND
            </button>
          </div>
        </label>
        {placeResults.length > 0 && (
          <div className="place-results">
            {placeResults.map((place) => (
              <button
                type="button"
                key={place.id}
                onClick={() => {
                  setLocationName(place.name);
                  setLatitude(place.latitude);
                  setLongitude(place.longitude);
                  setPlaceResults([]);
                }}
              >
                <MapPin /> {place.name}
              </button>
            ))}
          </div>
        )}
        <input type="hidden" name="latitude" value={latitude} />
        <input type="hidden" name="longitude" value={longitude} />
        <input type="hidden" name="weather" value={JSON.stringify(weather)} />
        <div className="entry-options-row">
          <label className="entry-option-toggle">
            <input
              name="encrypted"
              type="checkbox"
              checked={encrypted}
              onChange={(event) => setEncrypted(event.target.checked)}
            />{" "}
            <LockKeyhole /> ENCRYPT TEXT
          </label>
          <label className="entry-option-toggle">
            <input name="pinned" type="checkbox" defaultChecked={entry?.pinned || false} />
            <Pin /> PIN ENTRY
          </label>
        </div>
        {encrypted && (
            <label className="encryption-passphrase">
              ENCRYPTION PASSPHRASE
              <input
                name="encryptionPassphrase"
                type="password"
                minLength="12"
                autoComplete="new-password"
                required
                placeholder="12+ characters · never sent to the server"
              />
              <small>
                Required every time you save or unlock. There is no recovery if
                you lose it. Attachments remain separately protected by your
                account permissions.
              </small>
            </label>
        )}
        <label>
          REMINDER
          <input
            name="reminderAt"
            type="datetime-local"
            defaultValue={
              entry?.reminderAt
                ? new Date(
                    new Date(entry.reminderAt).getTime() -
                      new Date().getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16)
                : ""
            }
          />
          <small>Shown by this installed PWA while it is running.</small>
        </label>
        <div className="form-actions">
          <span>FILES MAX 50MB / CTRL+S TO SAVE</span>
          <button>SAVE ENTRY →</button>
        </div>
      </form>
    </div>
  );
}
function AdminPanel({ currentUser, section }) {
  const [data, setData] = useState(null),
    [code, setCode] = useState(""),
    [query, setQuery] = useState(""),
    [userFilter, setUserFilter] = useState("all"),
    [message, setMessage] = useState(""),
    [editingUser, setEditingUser] = useState(null),
    [creatingUser, setCreatingUser] = useState(false),
    [backups, setBackups] = useState({ running: false, backups: [] }),
    [backupBusy, setBackupBusy] = useState(false),
    [moderation, setModeration] = useState({ comments: [], links: [] }),
    [moderationType, setModerationType] = useState("comments"),
    [moderationQuery, setModerationQuery] = useState(""),
    [reportDays, setReportDays] = useState("30"),
    [reportBusy, setReportBusy] = useState("");
  const load = () =>
    fetch("/api/admin")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load admin dashboard");
        return result;
      })
      .then(setData)
      .catch((error) => setMessage(error.message));
  useEffect(load, []);
  useEffect(() => setMessage(""), [section]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 4500);
    return () => clearTimeout(timer);
  }, [message]);
  const loadBackups = () =>
    fetch("/api/admin/backups")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setBackups(result);
      })
      .catch((error) => setMessage(error.message));
  useEffect(() => {
    if (section === "backups") loadBackups();
  }, [section]);
  const loadModeration = () =>
    fetch("/api/admin/moderation")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setModeration(result);
      })
      .catch((error) => setMessage(error.message));
  useEffect(() => {
    if (section === "moderation") loadModeration();
  }, [section]);
  const setMode = async (registrationMode) => {
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationMode }),
    });
    if (!response.ok) return setMessage((await response.json()).error);
    setMessage("Registration mode updated.");
    load();
  };
  const saveSiteSettings = async (event) => {
    event.preventDefault();
    const response = await fetch("/api/admin/site-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      }),
      result = await response.json();
    if (!response.ok) return setMessage(result.error);
    setMessage("Website settings saved. Reload the diary to see them everywhere.");
    load();
  };
  const saveAlertSettings = async (event) => {
    event.preventDefault();
    const response = await fetch("/api/admin/alert-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      }),
      result = await response.json();
    if (!response.ok) return setMessage(result.error);
    setMessage("Operational alert thresholds updated.");
    load();
  };
  const createInvite = async (event) => {
    event.preventDefault();
    const response = await fetch("/api/admin/registration-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      }),
      result = await response.json();
    if (!response.ok) return alert(result.error);
    setCode(result.code);
    navigator.clipboard?.writeText(result.code).catch(() => {});
    setMessage("Registration code created and copied.");
    event.currentTarget.reset();
    load();
  };
  const updateUser = async (user, changes) => {
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    if (!response.ok) return alert((await response.json()).error);
    const pending = response.status === 202;
    setMessage(`${user.display_name} updated.`);
    load();
  };
  const revokeInvite = async (invite) => {
    if (!confirm("Revoke this registration code?")) return;
    const response = await fetch(
      `/api/admin/registration-invites/${invite.id}`,
      { method: "DELETE" },
    );
    if (!response.ok) return setMessage((await response.json()).error);
    setMessage("Registration code revoked.");
    load();
  };
  const revokeSessions = async (target) => {
    if (!confirm(`Sign out ${target.display_name} on every device?`)) return;
    const response = await fetch(`/api/admin/users/${target.id}/sessions`, {
      method: "DELETE",
    });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error);
    setMessage(`${result.revoked} active session(s) revoked.`);
    load();
  };
  const saveAccount = async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      values = Object.fromEntries(new FormData(form)),
      creating = creatingUser,
      response = await fetch(
        creating
          ? "/api/admin/users"
          : `/api/admin/users/${editingUser.id}/details`,
        {
          method: creating ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...values,
            isAdmin: form.elements.isAdmin.checked,
            verified: form.elements.verified.checked,
            disabled: form.elements.disabled.checked,
          }),
        },
      ),
      result = await response.json();
    if (!response.ok) return setMessage(result.error);
    setMessage(creating ? "User account created." : "User account updated.");
    setEditingUser(null);
    setCreatingUser(false);
    load();
  };
  const deleteAccount = async (target) => {
    if (
      !confirm(
        `Permanently delete ${target.display_name}, all owned journals, entries, and media? This cannot be undone.`,
      )
    )
      return;
    const typed = prompt(`Type ${target.username} to confirm deletion.`);
    if (typed !== target.username) return setMessage("Deletion cancelled.");
    const response = await fetch(`/api/admin/users/${target.id}`, {
        method: "DELETE",
      }),
      result = await response.json();
    if (!response.ok) return setMessage(result.error);
    setMessage("User and owned data permanently deleted.");
    setEditingUser(null);
    load();
  };
  const createBackup = async () => {
    setBackupBusy(true);
    setMessage("Creating database and media backup…");
    try {
      const response = await fetch("/api/admin/backups", { method: "POST" }),
        result = await response.json();
      if (!response.ok) throw new Error(result.error || "Backup failed");
      setMessage("Backup completed successfully.");
      loadBackups();
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBackupBusy(false);
    }
  };
  const deleteBackup = async (backup) => {
    if (!confirm(`Delete backup ${backup.stamp} permanently?`)) return;
    const response = await fetch(`/api/admin/backups/${backup.stamp}`, {
        method: "DELETE",
      }),
      result = await response.json();
    if (!response.ok) return setMessage(result.error);
    setMessage("Backup deleted.");
    loadBackups();
    load();
  };
  const removeModeratedComment = async (comment) => {
    if (!confirm(`Delete this comment by ${comment.display_name}?`)) return;
    const response = await fetch(
        `/api/admin/moderation/comments/${comment.id}`,
        { method: "DELETE" },
      ),
      result = await response.json();
    if (!response.ok) return setMessage(result.error);
    setMessage("Comment removed by moderation.");
    loadModeration();
    load();
  };
  const revokeModeratedLink = async (link) => {
    if (!confirm(`Revoke the public link for “${link.entry_title}”?`)) return;
    const response = await fetch(
        `/api/admin/moderation/public-links/${link.id}`,
        { method: "DELETE" },
      ),
      result = await response.json();
    if (!response.ok) return setMessage(result.error);
    setMessage("Public link revoked by moderation.");
    loadModeration();
    load();
  };
  const downloadAdminReport = async (format) => {
    setReportBusy(format);
    setMessage(`Generating ${format.toUpperCase()} analytics report…`);
    try {
      const response = await fetch(
        `/api/admin/reports/${format}?days=${reportDays}`,
        { method: "POST" },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Could not generate report");
      }
      const blob = await response.blob(),
        disposition = response.headers.get("Content-Disposition") || "",
        fileName = disposition.match(/filename=([^;]+)/)?.[1] || `diary-admin-report.${format}`,
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`${format.toUpperCase()} report downloaded.`);
      load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setReportBusy("");
    }
  };
  const saveMaintenance = async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      values = Object.fromEntries(new FormData(form)),
      response = await fetch("/api/admin/maintenance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, enabled: form.elements.enabled.checked }),
      }),
      result = await response.json();
    if (!response.ok) return setMessage(result.error);
    setMessage(result.maintenance_enabled ? "Maintenance schedule enabled." : "Maintenance mode disabled.");
    load();
  };
  const localDateTime = (value) => {
    if (!value) return "";
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  const formatBytes = (bytes) => {
    if (!bytes) return "0 B";
    const unit = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
  };
  const formatDuration = (seconds) => {
    const days = Math.floor(seconds / 86400),
      hours = Math.floor((seconds % 86400) / 3600),
      minutes = Math.floor((seconds % 3600) / 60);
    return `${days ? `${days}d ` : ""}${hours}h ${minutes}m`;
  };
  const filteredUsers = (data?.users || []).filter((item) => {
    const matches = [item.display_name, item.username, item.email]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase());
    return (
      matches &&
      (userFilter === "all" ||
        (userFilter === "admins" && item.is_admin) ||
        (userFilter === "disabled" && item.disabled_at) ||
        (userFilter === "unverified" && !item.email_verified_at))
    );
  });
  const sectionTitles = {
    overview: ["OVERVIEW", "Site health and recent status at a glance."],
    alerts: ["OPERATIONAL ALERTS", "Monitor live risks and configure warning thresholds."],
    users: ["USERS", "Find accounts, manage access, and revoke sessions."],
    moderation: ["MODERATION", "Review and manage comments and externally shared entries."],
    website: ["WEBSITE", "Configure the public identity and descriptive text."],
    registration: ["REGISTRATION", "Control sign-up access and invitation codes."],
    activity: ["SECURITY ACTIVITY", "Review recent successful and failed sign-ins."],
    audit: ["ADMIN AUDIT", "Review privileged changes made by administrators."],
    backups: ["BACKUPS", "Create, inspect, download, and remove database and media snapshots."],
    reports: ["REPORTS", "Export administrator analytics for review and record keeping."],
    maintenance: ["MAINTENANCE", "Schedule downtime while keeping administrator access available."],
    system: ["SYSTEM", "Runtime, database, storage, and service information."],
  };
  return (
    <div className="modal admin-modal">
      <section>
        <header>
          <div>
            <span>{sectionTitles[section][0]}</span>
            <p>{sectionTitles[section][1]}</p>
          </div>
          <button onClick={load} title="Refresh dashboard">
            <RotateCcw /> REFRESH
          </button>
        </header>
        {message && <div className="admin-message">{message}</div>}
        {!data ? (
          <p className="trash-empty">LOADING ADMIN DASHBOARD_</p>
        ) : (
          <>
            {section === "overview" && (
              <>
                <div className="admin-totals admin-overview-totals">
                  {[
                    ["users", data.totals.users],
                    ["entries", data.totals.entries],
                    ["journals", data.totals.journals],
                    ["comments", data.totals.comments],
                    ["active sessions", data.totals.active_sessions],
                    ["failed logins / 24h", data.totals.failed_logins_24h],
                    ["active alerts", data.alerts.length],
                  ].map(([name, count]) => (
                    <article key={name}>
                      <strong>{Number(count).toLocaleString()}</strong>
                      <span>{name.toUpperCase()}</span>
                    </article>
                  ))}
                </div>
                <div className="admin-summary-grid">
                  <article>
                    <span>REGISTRATION</span>
                    <strong>{data.settings.registration_mode.toUpperCase()}</strong>
                    <small>{data.invitations.filter((item) => new Date(item.expires_at) > new Date() && item.use_count < item.max_uses).length} active codes</small>
                  </article>
                  <article>
                    <span>MEDIA STORAGE</span>
                    <strong>{formatBytes(data.media.bytes)}</strong>
                    <small>{data.media.files.toLocaleString()} uploaded files</small>
                  </article>
                  <article>
                    <span>ACCOUNTS</span>
                    <strong>{data.totals.active_users} ACTIVE</strong>
                    <small>{data.totals.users - data.totals.active_users} disabled</small>
                  </article>
                  <article>
                    <span>TRASH</span>
                    <strong>{data.totals.trashed_entries}</strong>
                    <small>soft-deleted entries</small>
                  </article>
                </div>
                <div className="admin-section-label">LAST 30 DAYS</div>
                <div className="admin-chart-grid">
                  <AdminTrendChart
                    title="CONTENT ACTIVITY"
                    data={data.analytics.daily}
                    lines={[
                      ["entries", "Entries", "#7aa2f7"],
                      ["comments", "Comments", "#9ece6a"],
                      ["users", "New users", "#e0af68"],
                    ]}
                  />
                  <AdminTrendChart
                    title="SIGN-IN ACTIVITY"
                    data={data.analytics.daily}
                    lines={[
                      ["successful_logins", "Successful", "#9ece6a"],
                      ["failed_logins", "Failed", "#f7768e"],
                    ]}
                  />
                  <AdminBarChart
                    title="ENTRY VISIBILITY"
                    data={data.analytics.visibility.map((item) => ({
                      label: item.visibility,
                      value: item.count,
                    }))}
                    color="#bb9af7"
                  />
                  <AdminBarChart
                    title="TOP CONTRIBUTORS"
                    data={data.analytics.contributors.map((item) => ({
                      label: item.display_name,
                      value: item.entries,
                      detail: `${item.comments} comments`,
                    }))}
                    color="#7dcfff"
                  />
                </div>
              </>
            )}
            {section === "alerts" && (
              <>
                <div className="admin-alerts">
                  <header>
                    <span>ACTIVE ALERTS</span>
                    <strong>{data.alerts.length}</strong>
                  </header>
                  {data.alerts.map((alert) => (
                    <article key={alert.id} className={alert.severity}>
                      <i>{alert.severity.toUpperCase()}</i>
                      <span><strong>{alert.title}</strong><small>{alert.detail}</small></span>
                    </article>
                  ))}
                  {!data.alerts.length && <div className="admin-all-clear"><ShieldCheck /> ALL MONITORED SYSTEMS ARE WITHIN THRESHOLDS</div>}
                </div>
                <form className="admin-alert-settings" onSubmit={saveAlertSettings}>
                  <div className="admin-section-label">ALERT THRESHOLDS</div>
                  <div>
                    <label>HOST MEMORY (%)<input name="memory" type="number" min="10" max="100" required defaultValue={data.settings.alert_memory_percent} /><small>Alert when used host memory reaches this percentage.</small></label>
                    <label>DATABASE CONNECTIONS (%)<input name="connections" type="number" min="10" max="100" required defaultValue={data.settings.alert_db_connections_percent} /><small>Alert when PostgreSQL connections reach this percentage.</small></label>
                    <label>FAILED LOGINS / 24H<input name="failedLogins" type="number" min="1" max="10000" required defaultValue={data.settings.alert_failed_logins} /><small>Critical alert after this many failed sign-ins.</small></label>
                    <label>MAXIMUM BACKUP AGE (HOURS)<input name="backupHours" type="number" min="1" max="720" required defaultValue={data.settings.alert_backup_hours} /><small>Alert when no complete backup is newer than this.</small></label>
                    <label>USER STORAGE (%)<input name="storage" type="number" min="10" max="100" required defaultValue={data.settings.alert_storage_percent} /><small>Alert when an account reaches this quota percentage.</small></label>
                  </div>
                  <footer><span>Alerts are recalculated whenever the dashboard refreshes.</span><button><Bell /> SAVE ALERT SETTINGS</button></footer>
                </form>
              </>
            )}
            {section === "registration" && (
              <>
                <div className="registration-controls">
                  <section>
                    <header>
                      <span>ACCESS POLICY</span>
                      <p>Choose who can create a new account.</p>
                    </header>
                    <label>
                      REGISTRATION MODE
                      <select value={data.settings.registration_mode} onChange={(event) => setMode(event.target.value)}>
                        <option value="open">Open to everyone</option>
                        <option value="invite">Invitation code required</option>
                        <option value="closed">Registration closed</option>
                      </select>
                    </label>
                  </section>
                  <form onSubmit={createInvite}>
                    <header>
                      <span>NEW INVITATION CODE</span>
                      <p>Create a limited-use code with an expiry date.</p>
                    </header>
                    <div>
                      <label>
                        MAXIMUM USES
                        <input name="maxUses" type="number" min="1" max="100" defaultValue="1" />
                      </label>
                      <label>
                        VALID FOR
                        <select name="days" defaultValue="7">
                          <option value="1">1 day</option>
                          <option value="7">7 days</option>
                          <option value="30">30 days</option>
                          <option value="90">90 days</option>
                        </select>
                      </label>
                    </div>
                    <button><Plus /> CREATE CODE</button>
                  </form>
                </div>
                {code && (
                  <div className="admin-code">
                    <code>{code}</code>
                    <button onClick={() => navigator.clipboard?.writeText(code)}>COPY</button>
                  </div>
                )}
                <div className="admin-list">
                  <header><span>REGISTRATION CODES</span><small>{data.invitations.length} shown</small></header>
                  {data.invitations.map((invite) => {
                    const active = new Date(invite.expires_at) > new Date() && invite.use_count < invite.max_uses;
                    return (
                      <article key={invite.id} className={active ? "" : "disabled"}>
                        <span><strong>CODE #{invite.id}</strong><small>Created by {invite.created_by_name || "deleted user"} · {new Date(invite.created_at).toLocaleString()}</small></span>
                        <span>{invite.use_count} / {invite.max_uses} USES<small>Expires {new Date(invite.expires_at).toLocaleString()}</small></span>
                        <button onClick={() => revokeInvite(invite)}>REVOKE</button>
                      </article>
                    );
                  })}
                  {!data.invitations.length && <p className="trash-empty">NO REGISTRATION CODES_</p>}
                </div>
              </>
            )}
            {section === "website" && (
              <form className="admin-site-settings" onSubmit={saveSiteSettings}>
                <label>
                  SITE NAME
                  <input name="siteName" required maxLength="80" defaultValue={data.settings.site_name} />
                  <small>The primary name displayed above the diary.</small>
                </label>
                <label>
                  MASTHEAD DESCRIPTION
                  <textarea name="siteTagline" required maxLength="240" defaultValue={data.settings.site_tagline} />
                  <small>A short sentence explaining what this site records.</small>
                </label>
                <label>
                  TOP NOTICE
                  <input name="siteNotice" maxLength="160" defaultValue={data.settings.site_notice} />
                  <small>Shown beside the site name in the top announcement strip. Leave blank to hide the strip.</small>
                </label>
                <label>
                  FOOTER TEXT
                  <input name="footerText" maxLength="160" defaultValue={data.settings.footer_text} />
                  <small>A short signature displayed at the bottom of the diary.</small>
                </label>
                <footer>
                  <span>Changes are stored in PostgreSQL and apply to every user.</span>
                  <button><Settings /> SAVE WEBSITE SETTINGS</button>
                </footer>
              </form>
            )}
            {section === "users" && (
              <>
                <div className="admin-toolbar">
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, username, or email…" />
                  <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
                    <option value="all">All users</option>
                    <option value="admins">Administrators</option>
                    <option value="disabled">Disabled</option>
                    <option value="unverified">Unverified email</option>
                  </select>
                  <button
                    onClick={() => {
                      setEditingUser(null);
                      setCreatingUser(true);
                    }}
                  >
                    <Plus /> ADD USER
                  </button>
                </div>
                {(creatingUser || editingUser) && (
                  <div
                    className="admin-user-editor-backdrop"
                    onMouseDown={(event) => {
                      if (event.target === event.currentTarget) {
                        setCreatingUser(false);
                        setEditingUser(null);
                      }
                    }}
                  >
                    <form
                      className="admin-user-editor"
                      key={creatingUser ? "new" : editingUser.id}
                      onSubmit={saveAccount}
                    >
                      <header>
                        <span>{creatingUser ? "CREATE USER" : `EDIT / ${editingUser.display_name}`}</span>
                        <button
                          type="button"
                          aria-label="Close user editor"
                          onClick={() => {
                            setCreatingUser(false);
                            setEditingUser(null);
                          }}
                        >
                          <X />
                        </button>
                      </header>
                      <div>
                        <label>DISPLAY NAME<input name="displayName" required defaultValue={editingUser?.display_name || ""} /></label>
                        <label>USERNAME<input name="username" required minLength="3" maxLength="30" pattern="[A-Za-z0-9_-]+" defaultValue={editingUser?.username || ""} /></label>
                        <label>EMAIL<input name="email" type="email" required defaultValue={editingUser?.email || ""} /></label>
                        <label>PASSWORD<input name="password" type="password" minLength="10" required={creatingUser} placeholder={creatingUser ? "At least 10 characters" : "Leave blank to keep current password"} /></label>
                        <label>STORAGE QUOTA (GB)<input name="storageQuotaGb" type="number" min="0.1" max="1024" step="0.1" required defaultValue={editingUser ? (editingUser.storage_quota / 1073741824).toFixed(1) : "5.0"} /></label>
                        <label className="wide">BIO<textarea name="bio" maxLength="2000" defaultValue={editingUser?.bio || ""} /></label>
                      </div>
                      <footer>
                        <label><input name="verified" type="checkbox" defaultChecked={!!editingUser?.email_verified_at} /> EMAIL VERIFIED</label>
                        <label><input name="isAdmin" type="checkbox" defaultChecked={!!editingUser?.is_admin} disabled={editingUser?.id === currentUser.id} /> ADMINISTRATOR</label>
                        <label><input name="disabled" type="checkbox" defaultChecked={!!editingUser?.disabled_at} disabled={editingUser?.id === currentUser.id} /> DISABLED</label>
                        {!creatingUser && editingUser.id !== currentUser.id && <button type="button" className="danger" onClick={() => deleteAccount(editingUser)}><Trash2 /> DELETE USER</button>}
                        <button><Settings /> {creatingUser ? "CREATE ACCOUNT" : "SAVE CHANGES"}</button>
                      </footer>
                    </form>
                  </div>
                )}
                <div className="admin-users">
              {filteredUsers.map((user) => (
                <article
                  key={user.id}
                  className={user.disabled_at ? "disabled" : ""}
                >
                  <span>
                    <strong>
                      {user.display_name}{" "}
                      {user.id === currentUser.id && "(YOU)"}
                    </strong>
                    @{user.username} · {user.email}
                    <small>
                      {user.entry_count} entries ·{" "}
                      {user.email_verified_at ? "verified" : "unverified"} ·
                      last login{" "}
                      {user.last_login
                        ? new Date(user.last_login).toLocaleString()
                        : "never"}
                      {" · "}{formatBytes(user.storage_used)} / {formatBytes(user.storage_quota)} storage
                    </small>
                  </span>
                  <div className="admin-user-status">
                    <label>
                      <input
                        type="checkbox"
                        checked={user.is_admin}
                        disabled={user.id === currentUser.id}
                        onChange={(event) =>
                          updateUser(user, {
                            isAdmin: event.target.checked,
                            disabled: !!user.disabled_at,
                          })
                        }
                      />
                      ADMIN
                    </label>
                    <i className={user.email_verified_at ? "verified" : ""}>
                      {user.email_verified_at ? "VERIFIED" : "UNVERIFIED"}
                    </i>
                    {user.disabled_at && <i className="disabled">DISABLED</i>}
                  </div>
                  <div className="admin-user-actions">
                    <button
                      disabled={user.id === currentUser.id}
                      onClick={() =>
                        updateUser(user, { disabled: !user.disabled_at })
                      }
                    >
                      {user.disabled_at ? "ENABLE" : "DISABLE"}
                    </button>
                    <button
                      disabled={user.id === currentUser.id}
                      onClick={() => revokeSessions(user)}
                    >
                      SIGN OUT
                    </button>
                    <button
                      onClick={() => {
                        setCreatingUser(false);
                        setEditingUser(user);
                      }}
                    >
                      EDIT
                    </button>
                  </div>
                </article>
              ))}
                  {!filteredUsers.length && <p className="trash-empty">NO MATCHING USERS_</p>}
                </div>
              </>
            )}
            {section === "moderation" && (
              <>
                <div className="admin-toolbar moderation-toolbar">
                  <input value={moderationQuery} onChange={(event) => setModerationQuery(event.target.value)} placeholder="Search author, entry, or content…" />
                  <select value={moderationType} onChange={(event) => setModerationType(event.target.value)}>
                    <option value="comments">Comments ({moderation.comments.length})</option>
                    <option value="links">Public links ({moderation.links.length})</option>
                  </select>
                  <button onClick={loadModeration}><RotateCcw /> REFRESH</button>
                </div>
                {moderationType === "comments" && (
                  <div className="admin-moderation admin-list">
                    <header><span>RECENT COMMENTS</span><small>Latest 200</small></header>
                    {moderation.comments.filter((item) => [item.body, item.display_name, item.username, item.entry_title, item.journal_name].join(" ").toLowerCase().includes(moderationQuery.toLowerCase())).map((comment) => (
                      <article key={comment.id}>
                        <span>
                          <strong>{comment.display_name} <small>@{comment.username}</small></strong>
                          <small>{comment.journal_name} / {comment.entry_title} · {new Date(comment.created_at).toLocaleString()}</small>
                        </span>
                        <p>{comment.body}</p>
                        <a href={`/entries/${comment.entry_id}#discussion`}><Eye /> VIEW</a>
                        <button onClick={() => removeModeratedComment(comment)}><Trash2 /> DELETE</button>
                      </article>
                    ))}
                  </div>
                )}
                {moderationType === "links" && (
                  <div className="admin-moderation admin-list">
                    <header><span>PUBLIC LINKS</span><small>Latest 200</small></header>
                    {moderation.links.filter((item) => [item.entry_title, item.display_name, item.username].join(" ").toLowerCase().includes(moderationQuery.toLowerCase())).map((link) => {
                      const active = !link.revoked_at && new Date(link.expires_at) > new Date();
                      return (
                        <article key={link.id} className={active ? "" : "disabled"}>
                          <span>
                            <strong>{link.entry_title}</strong>
                            <small>Created by {link.display_name || "deleted user"} · expires {new Date(link.expires_at).toLocaleString()}</small>
                          </span>
                          <p>{link.view_count} views · {link.password_protected ? "password protected" : "no password"} · {active ? "active" : link.revoked_at ? "revoked" : "expired"}</p>
                          <a href={`/entries/${link.entry_id}`}><Eye /> ENTRY</a>
                          <button disabled={!active} onClick={() => revokeModeratedLink(link)}><LockKeyhole /> REVOKE</button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            {section === "activity" && (
              <div className="admin-activity admin-list">
                <header><span>RECENT SIGN-IN ATTEMPTS</span><small>Latest 50 events</small></header>
                {data.loginActivity.map((event) => (
                  <article key={event.id} className={event.success ? "success" : "failure"}>
                    <i>{event.success ? "SUCCESS" : "FAILED"}</i>
                    <span><strong>{event.display_name || event.identifier || "Unknown account"}</strong><small>{event.username ? `@${event.username} · ` : ""}{event.method.toUpperCase()} · {event.ip_address || "unknown IP"}</small></span>
                    <time>{new Date(event.created_at).toLocaleString()}</time>
                  </article>
                ))}
                {!data.loginActivity.length && <p className="trash-empty">NO LOGIN ACTIVITY_</p>}
              </div>
            )}
            {section === "audit" && (
              <div className="admin-audit admin-list">
                <header>
                  <span>RECENT ADMINISTRATOR ACTIONS</span>
                  <small>Latest 100 events</small>
                </header>
                {data.adminAudit.map((event) => (
                  <article key={event.id}>
                    <i>{event.action.replaceAll(".", " / ").toUpperCase()}</i>
                    <span>
                      <strong>{event.display_name || "Deleted administrator"}</strong>
                      <small>
                        {event.username ? `@${event.username} · ` : ""}
                        {event.target_type || "system"}
                        {event.target_id ? ` #${event.target_id}` : ""}
                        {event.ip_address ? ` · ${event.ip_address}` : ""}
                      </small>
                    </span>
                    <time>{new Date(event.created_at).toLocaleString()}</time>
                    {Object.keys(event.details || {}).length > 0 && (
                      <code>{JSON.stringify(event.details)}</code>
                    )}
                  </article>
                ))}
                {!data.adminAudit.length && (
                  <p className="trash-empty">NO ADMINISTRATOR ACTIONS YET_</p>
                )}
              </div>
            )}
            {section === "backups" && (
              <>
                <div className="admin-backup-summary">
                  <div>
                    <span>AVAILABLE BACKUPS</span>
                    <strong>{backups.backups.length}</strong>
                    <small>{formatBytes(backups.backups.reduce((sum, item) => sum + item.bytes, 0))} total storage</small>
                  </div>
                  <div>
                    <span>STATUS</span>
                    <strong>{backupBusy || backups.running ? "RUNNING" : "READY"}</strong>
                    <small>Database and MinIO media are saved as a matched pair.</small>
                  </div>
                  <button disabled={backupBusy || backups.running} onClick={createBackup}>
                    <Download /> {backupBusy || backups.running ? "CREATING BACKUP…" : "CREATE BACKUP NOW"}
                  </button>
                </div>
                <div className="admin-backups admin-list">
                  <header>
                    <span>BACKUP HISTORY</span>
                    <small>Automatic and manual snapshots</small>
                  </header>
                  {backups.backups.map((backup) => (
                    <article key={backup.stamp} className={backup.complete ? "" : "failure"}>
                      <i>{backup.complete ? "COMPLETE" : "INCOMPLETE"}</i>
                      <span>
                        <strong>{new Date(backup.createdAt).toLocaleString()}</strong>
                        <small>{backup.stamp} · {formatBytes(backup.bytes)}</small>
                      </span>
                      <div>
                        {backup.database && <a href={`/api/admin/backups/${backup.stamp}/database`}><Download /> DATABASE</a>}
                        {backup.media && <a href={`/api/admin/backups/${backup.stamp}/media`}><Download /> MEDIA</a>}
                        <button onClick={() => deleteBackup(backup)}><Trash2 /> DELETE</button>
                      </div>
                    </article>
                  ))}
                  {!backups.backups.length && <p className="trash-empty">NO BACKUPS FOUND_</p>}
                </div>
              </>
            )}
            {section === "reports" && (
              <>
                <div className="admin-report-controls">
                  <label>
                    REPORTING PERIOD
                    <select value={reportDays} onChange={(event) => setReportDays(event.target.value)}>
                      <option value="7">Last 7 days</option>
                      <option value="30">Last 30 days</option>
                      <option value="90">Last 90 days</option>
                      <option value="180">Last 180 days</option>
                      <option value="365">Last 365 days</option>
                    </select>
                  </label>
                  <p>Every export includes current site totals, daily activity, visibility, user/storage data, and the latest administrator audit events.</p>
                </div>
                <div className="admin-report-grid">
                  <article>
                    <div><span>CSV DATASET</span><strong>Structured analytics</strong><small>Spreadsheet-ready UTF-8 rows for summaries, daily trends, users, storage, visibility, and audit activity.</small></div>
                    <button disabled={!!reportBusy} onClick={() => downloadAdminReport("csv")}><Download /> {reportBusy === "csv" ? "GENERATING…" : "DOWNLOAD CSV"}</button>
                  </article>
                  <article>
                    <div><span>PDF REPORT</span><strong>Readable operations report</strong><small>Formatted site summary, daily activity, content distribution, user storage, and administrator activity.</small></div>
                    <button disabled={!!reportBusy} onClick={() => downloadAdminReport("pdf")}><Download /> {reportBusy === "pdf" ? "GENERATING…" : "DOWNLOAD PDF"}</button>
                  </article>
                </div>
              </>
            )}
            {section === "maintenance" && (
              <form className="admin-maintenance" onSubmit={saveMaintenance}>
                <div className={`maintenance-status ${data.settings.maintenance_enabled ? "enabled" : ""}`}>
                  <div>
                    <span>SCHEDULE STATUS</span>
                    <strong>{data.settings.maintenance_enabled ? "ENABLED" : "DISABLED"}</strong>
                    <small>Administrators can continue to sign in and use the dashboard during an active window.</small>
                  </div>
                  <label><input name="enabled" type="checkbox" defaultChecked={data.settings.maintenance_enabled} /> ENABLE MAINTENANCE SCHEDULE</label>
                </div>
                <div className="maintenance-schedule-grid">
                  <label>STARTS AT<input name="startsAt" type="datetime-local" defaultValue={localDateTime(data.settings.maintenance_starts_at)} /><small>Leave blank to begin immediately when enabled.</small></label>
                  <label>ENDS AT<input name="endsAt" type="datetime-local" defaultValue={localDateTime(data.settings.maintenance_ends_at)} /><small>Leave blank to keep maintenance active until disabled manually.</small></label>
                </div>
                <label className="maintenance-message">VISITOR MESSAGE<textarea name="message" required maxLength="500" defaultValue={data.settings.maintenance_message} /><small>Shown to signed-out visitors and non-administrator users.</small></label>
                <div className="maintenance-behavior">
                  <span><ShieldCheck /> ADMINISTRATORS</span><p>May sign in and use all application and admin features.</p>
                  <span><LockKeyhole /> OTHER USERS</span><p>See the maintenance page and receive HTTP 503 from protected APIs.</p>
                  <span><History /> AUTOMATIC END</span><p>Access returns automatically when the configured end time passes.</p>
                </div>
                <footer><span>Saving an enabled schedule can make the site unavailable to users immediately.</span><button><Settings /> SAVE MAINTENANCE SCHEDULE</button></footer>
              </form>
            )}
            {section === "system" && (
              <>
                <div className="admin-section-label">HOST / CONTAINER</div>
                <div className="admin-system-grid">
                  <article><span>HOSTNAME</span><strong>{data.system.host.hostname}</strong><small>{data.system.host.platform}</small></article>
                  <article><span>PROCESS</span><strong>{data.system.host.node_version}</strong><small>Application uptime {formatDuration(data.system.host.process_uptime)}</small></article>
                  <article><span>CPU</span><strong>{data.system.host.cpu_cores} CORES</strong><small>{data.system.host.cpu_model}</small></article>
                  <article><span>LOAD AVERAGE</span><strong>{data.system.host.load.map((value) => Number(value).toFixed(2)).join(" / ")}</strong><small>1 / 5 / 15 minute load</small></article>
                  <article><span>HOST MEMORY</span><strong>{formatBytes(data.system.host.total_memory - data.system.host.free_memory)} USED</strong><small>{formatBytes(data.system.host.free_memory)} free of {formatBytes(data.system.host.total_memory)}</small></article>
                  <article><span>APP MEMORY</span><strong>{formatBytes(data.system.host.process_memory)}</strong><small>Resident Node.js process memory</small></article>
                  <article><span>SYSTEM UPTIME</span><strong>{formatDuration(data.system.host.system_uptime)}</strong><small>Reported by the container host namespace</small></article>
                  <article><span>SERVER TIME</span><strong>{new Date(data.system.server_time).toLocaleTimeString()}</strong><small>{new Date(data.system.server_time).toLocaleDateString()}</small></article>
                </div>
                <div className="admin-section-label">POSTGRESQL</div>
                <div className="admin-system-grid">
                  <article><span>DATABASE</span><strong>{data.system.database}</strong><small>PostgreSQL {data.system.database_version}</small></article>
                  <article><span>DATABASE SIZE</span><strong>{formatBytes(data.system.database_bytes)}</strong><small>Tables, indexes, and auxiliary data</small></article>
                  <article><span>CONNECTIONS</span><strong>{data.system.connections} / {data.system.max_connections}</strong><small>Current / configured maximum</small></article>
                  <article><span>ACTIVE SESSIONS</span><strong>{data.totals.active_sessions}</strong><small>Unexpired application sessions</small></article>
                  <article><span>MEDIA OBJECTS</span><strong>{data.media.files.toLocaleString()}</strong><small>{formatBytes(data.media.bytes)} indexed in entries</small></article>
                  <article><span>DEFAULT STORAGE LIMIT</span><strong>5 GB</strong><small>Individual quotas are managed per user</small></article>
                </div>
                <div className="admin-list admin-database-tables">
                  <header><span>LARGEST DATABASE TABLES</span><small>Estimated live rows</small></header>
                  {data.system.tables.map((table) => (
                    <article key={table.name}>
                      <span><strong>{table.name}</strong><small>PostgreSQL relation</small></span>
                      <span>{table.rows.toLocaleString()} ROWS</span>
                      <span>{formatBytes(table.bytes)}</span>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
function AdminTrendChart({ title, data, lines }) {
  const width = 640,
    height = 220,
    left = 34,
    right = 12,
    top = 18,
    bottom = 28,
    plotWidth = width - left - right,
    plotHeight = height - top - bottom,
    maximum = Math.max(
      1,
      ...data.flatMap((item) => lines.map(([key]) => Number(item[key]) || 0)),
    ),
    point = (value, index) =>
      `${left + (index * plotWidth) / Math.max(1, data.length - 1)},${top + plotHeight - ((Number(value) || 0) / maximum) * plotHeight}`;
  return (
    <article className="admin-chart">
      <header>
        <span>{title}</span>
        <div>
          {lines.map(([key, label, color]) => (
            <i key={key} style={{ "--chart-color": color }}>{label}</i>
          ))}
        </div>
      </header>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}, last 30 days`}>
        {[0, 0.25, 0.5, 0.75, 1].map((part) => {
          const y = top + plotHeight - part * plotHeight;
          return <g key={part}><line x1={left} y1={y} x2={width - right} y2={y} className="chart-grid-line" /><text x={left - 7} y={y + 3} textAnchor="end">{Math.round(maximum * part)}</text></g>;
        })}
        {lines.map(([key, label, color]) => (
          <g key={key}>
            <polyline points={data.map((item, index) => point(item[key], index)).join(" ")} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
            {data.map((item, index) => {
              const [cx, cy] = point(item[key], index).split(",");
              return <circle key={item.date} cx={cx} cy={cy} r="3" fill={color}><title>{`${item.date}: ${item[key]} ${label.toLowerCase()}`}</title></circle>;
            })}
          </g>
        ))}
        <text x={left} y={height - 6}>{data[0]?.date?.slice(5)}</text>
        <text x={width - right} y={height - 6} textAnchor="end">{data.at(-1)?.date?.slice(5)}</text>
      </svg>
    </article>
  );
}
function AdminBarChart({ title, data, color }) {
  const maximum = Math.max(1, ...data.map((item) => Number(item.value) || 0));
  return (
    <article className="admin-chart admin-bar-chart">
      <header><span>{title}</span><small>{data.reduce((sum, item) => sum + Number(item.value || 0), 0).toLocaleString()} TOTAL</small></header>
      <div>
        {data.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <div><i style={{ width: `${(Number(item.value) / maximum) * 100}%`, background: color }} /></div>
            <strong>{Number(item.value).toLocaleString()}</strong>
            {item.detail && <small>{item.detail}</small>}
          </div>
        ))}
        {!data.length && <p className="trash-empty">NO DATA YET_</p>}
      </div>
    </article>
  );
}
function SecurityPanel({ close }) {
  const [status, setStatus] = useState(null),
    [setup, setSetup] = useState(null),
    [codes, setCodes] = useState([]),
    [error, setError] = useState(""),
    [sessions, setSessions] = useState([]),
    [loginHistory, setLoginHistory] = useState([]);
  const load = () =>
    Promise.all([
      fetch("/api/security").then((response) => response.json()),
      fetch("/api/security/sessions").then((response) => response.json()),
      fetch("/api/security/login-history").then((response) => response.json()),
    ]).then(([security, sessionData, historyData]) => {
      setStatus(security);
      setSessions(sessionData);
      setLoginHistory(historyData);
    });
  useEffect(load, []);
  const begin = async (event) => {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/security/2fa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      }),
      data = await response.json();
    response.ok ? setSetup(data) : setError(data.error);
  };
  const confirmSetup = async (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code"),
      response = await fetch("/api/security/2fa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: setup.challenge, code }),
      }),
      data = await response.json();
    if (!response.ok) return setError(data.error);
    setCodes(data.recoveryCodes);
    setSetup(null);
    load();
  };
  const disable = async (event) => {
    event.preventDefault();
    if (!confirm("Disable two-factor authentication?")) return;
    const response = await fetch("/api/security/2fa", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        Object.fromEntries(new FormData(event.currentTarget)),
      ),
    });
    if (!response.ok) return setError((await response.json()).error);
    setCodes([]);
    load();
  };
  const registerPasskey = async () => {
    setError("");
    try {
      const optionsResponse = await fetch("/api/security/passkeys/options", {
          method: "POST",
        }),
        setupData = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(setupData.error);
      const response = await startRegistration({
          optionsJSON: setupData.options,
        }),
        name = prompt("Name this passkey", "My passkey") || "Passkey",
        verifyResponse = await fetch("/api/security/passkeys/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeToken: setupData.challengeToken,
            response,
            name,
          }),
        }),
        result = await verifyResponse.json();
      if (!verifyResponse.ok) throw new Error(result.error);
      load();
    } catch (reason) {
      setError(reason.message || "Passkey registration was cancelled");
    }
  };
  const removePasskey = async (id) => {
    if (!confirm("Remove this passkey?")) return;
    await fetch(`/api/security/passkeys/${id}`, { method: "DELETE" });
    load();
  };
  const revokeSession = async (session) => {
    if (
      !confirm(`Sign out ${session.current ? "this session" : "this device"}?`)
    )
      return;
    await fetch(`/api/security/sessions/${session.id}`, { method: "DELETE" });
    session.current ? location.reload() : load();
  };
  return (
    <div
      className="modal security-modal"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section>
        <header>
          <span>ACCOUNT_SECURITY</span>
          <button onClick={close}>
            <X />
          </button>
        </header>
        {!status ? (
          <p className="trash-empty">LOADING SECURITY STATUS_</p>
        ) : (
          <>
            <article className="security-status">
              <ShieldCheck />
              <div>
                <strong>TWO-FACTOR AUTHENTICATION</strong>
                <span>
                  {status.twoFactorEnabled
                    ? `ENABLED · ${status.recoveryCodes} RECOVERY CODES REMAIN`
                    : "NOT ENABLED"}
                </span>
              </div>
            </article>
            <article className="passkey-section">
              <header>
                <div>
                  <strong>PASSKEYS</strong>
                  <span>PHISHING-RESISTANT PASSWORDLESS LOGIN</span>
                </div>
                <button
                  onClick={registerPasskey}
                  disabled={!browserSupportsWebAuthn()}
                >
                  <KeyRound /> ADD PASSKEY
                </button>
              </header>
              {status.passkeys?.map((passkey) => (
                <div key={passkey.id}>
                  <span>
                    <strong>{passkey.name}</strong>
                    {passkey.device_type || "Authenticator"} · added{" "}
                    {new Date(passkey.created_at).toLocaleDateString()}
                  </span>
                  <button onClick={() => removePasskey(passkey.id)}>
                    <Trash2 />
                  </button>
                </div>
              ))}
              {!status.passkeys?.length && <p>NO PASSKEYS REGISTERED_</p>}
            </article>
            <article className="device-section">
              <header>
                <div>
                  <strong>ACTIVE DEVICES</strong>
                  <span>{sessions.length} VALID SESSIONS</span>
                </div>
                <button
                  onClick={async () => {
                    await fetch("/api/security/sessions", { method: "DELETE" });
                    load();
                  }}
                >
                  SIGN OUT OTHER DEVICES
                </button>
              </header>
              {sessions.map((session) => (
                <div key={session.id}>
                  <span>
                    <strong>
                      {session.current
                        ? "THIS DEVICE"
                        : session.user_agent || "Unknown device"}
                    </strong>
                    {session.ip_address || "Unknown IP"} · last seen{" "}
                    {new Date(session.last_seen_at).toLocaleString()}
                  </span>
                  <button onClick={() => revokeSession(session)}>
                    SIGN OUT
                  </button>
                </div>
              ))}
            </article>
            <article className="login-history">
              <header>
                <div><strong>LOGIN HISTORY</strong><span>LAST 100 ATTEMPTS</span></div>
                <a className="button-link" href="/api/security/login-history.csv"><Download /> DOWNLOAD CSV</a>
              </header>
              {loginHistory.map((item) => (
                <div
                  className={item.success ? "success" : "failure"}
                  key={item.id}
                >
                  <i>{item.success ? "OK" : "FAIL"}</i>
                  <span>
                    <strong>{item.method}</strong>
                    {item.ip_address || "Unknown IP"} ·{" "}
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </article>
            {!status.twoFactorEnabled && !setup && (
              <form onSubmit={begin}>
                <label>
                  CONFIRM CURRENT PASSWORD
                  <input name="password" type="password" required />
                </label>
                <button>SET UP AUTHENTICATOR</button>
              </form>
            )}
            {setup && (
              <div className="totp-setup">
                <p>
                  Scan this QR code with your authenticator, or enter the secret
                  manually.
                </p>
                <img src={setup.qr} alt="Authenticator QR code" />
                <code>{setup.secret}</code>
                <form onSubmit={confirmSetup}>
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    placeholder="6-digit code"
                    required
                    autoFocus
                  />
                  <button>ENABLE 2FA</button>
                </form>
              </div>
            )}
            {status.twoFactorEnabled && (
              <form onSubmit={disable}>
                <label>
                  CURRENT PASSWORD
                  <input name="password" type="password" required />
                </label>
                <label>
                  AUTHENTICATOR CODE
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    required
                  />
                </label>
                <button className="danger">DISABLE 2FA</button>
              </form>
            )}
            {codes.length > 0 && (
              <div className="recovery-codes">
                <strong>SAVE THESE ONE-TIME RECOVERY CODES NOW</strong>
                <div>
                  {codes.map((code) => (
                    <code key={code}>{code}</code>
                  ))}
                </div>
                <button
                  onClick={() =>
                    navigator.clipboard?.writeText(codes.join("\n"))
                  }
                >
                  COPY ALL CODES
                </button>
              </div>
            )}
            {error && <div className="auth-error">{error}</div>}
          </>
        )}
      </section>
    </div>
  );
}
function AccountTokenPage({ mode, token }) {
  const [status, setStatus] = useState(
      mode === "verify" ? "VERIFYING EMAIL_" : "",
    ),
    [error, setError] = useState("");
  useEffect(() => {
    if (mode !== "verify") return;
    fetch(`/api/auth/verify/${encodeURIComponent(token)}`, { method: "POST" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setStatus("EMAIL VERIFIED. YOU CAN RETURN TO DAYMARK.");
      })
      .catch((reason) => setError(reason.message));
  }, [mode, token]);
  const reset = async (event) => {
    event.preventDefault();
    setError("");
    const form = Object.fromEntries(new FormData(event.currentTarget));
    if (form.password !== form.confirmPassword)
      return setError("Passwords do not match");
    const response = await fetch(
        `/api/auth/password/reset/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: form.password }),
        },
      ),
      data = await response.json();
    if (!response.ok) return setError(data.error);
    setStatus("PASSWORD RESET. RETURN TO LOGIN.");
  };
  return (
    <main className="auth account-token">
      <div className="auth-logo">DAYMARK_</div>
      <p>{mode === "verify" ? "EMAIL VERIFICATION" : "PASSWORD RECOVERY"}</p>
      {mode === "reset" && !status && (
        <form onSubmit={reset}>
          <label>
            NEW PASSWORD
            <input
              name="password"
              type="password"
              minLength="10"
              required
              autoFocus
            />
          </label>
          <label>
            CONFIRM PASSWORD
            <input
              name="confirmPassword"
              type="password"
              minLength="10"
              required
            />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button>RESET PASSWORD →</button>
        </form>
      )}
      {mode === "verify" && error && <div className="auth-error">{error}</div>}
      {status && <div className="account-status">{status}</div>}
      <a href="/">RETURN TO DAYMARK →</a>
    </main>
  );
}
function MaintenancePage({ settings, adminAccess }) {
  return (
    <main className="maintenance-page">
      <section>
        <span>SCHEDULED MAINTENANCE</span>
        <h1>{settings.site_name}_</h1>
        <p>{settings.maintenance_message}</p>
        <div>
          {settings.maintenance_ends_at ? (
            <><strong>EXPECTED TO END</strong>{new Date(settings.maintenance_ends_at).toLocaleString()}</>
          ) : (
            <><strong>STATUS</strong>We will be back as soon as maintenance is complete.</>
          )}
        </div>
        <button onClick={adminAccess}><LockKeyhole /> ADMINISTRATOR ACCESS</button>
      </section>
    </main>
  );
}
function Auth({ onAuth }) {
  const [mode, setMode] = useState("login"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [twoFactor, setTwoFactor] = useState(null),
    [registrationMode, setRegistrationMode] = useState("open"),
    loginRef = useRef(null);
  useEffect(() => {
    fetch("/api/auth/registration")
      .then((response) => response.json())
      .then((data) => setRegistrationMode(data.mode));
  }, []);
  const go = async (e) => {
    e.preventDefault();
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (mode === "forgot") {
      const response = await fetch("/api/auth/password/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const data = await response.json();
      setMessage(
        data.message || "If that address exists, a reset link has been sent",
      );
      return;
    }
    const r = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      }),
      data = await r.json();
    if (!r.ok) setError(data.error || "Request failed");
    else if (data.requiresTwoFactor) setTwoFactor(data.challenge);
    else onAuth(data);
  };
  const finishTwoFactor = async (event) => {
    event.preventDefault();
    setError("");
    const code = new FormData(event.currentTarget).get("code"),
      response = await fetch("/api/auth/2fa/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: twoFactor, code }),
      }),
      data = await response.json();
    response.ok
      ? onAuth(data)
      : setError(data.error || "Authentication failed");
  };
  const passkeyLogin = async () => {
    setError("");
    try {
      const login = loginRef.current?.value.trim();
      if (!login) throw new Error("Enter your username or email first");
      const optionsResponse = await fetch("/api/auth/passkey/options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login }),
        }),
        optionsData = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(optionsData.error);
      const response = await startAuthentication({
          optionsJSON: optionsData.options,
        }),
        verifyResponse = await fetch("/api/auth/passkey/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeToken: optionsData.challengeToken,
            response,
          }),
        }),
        user = await verifyResponse.json();
      if (!verifyResponse.ok) throw new Error(user.error);
      onAuth(user);
    } catch (reason) {
      setError(reason.message || "Passkey login was cancelled");
    }
  };
  if (twoFactor)
    return (
      <main className="auth">
        <div className="auth-logo">DAYMARK_</div>
        <p>TWO-FACTOR AUTHENTICATION</p>
        <form onSubmit={finishTwoFactor}>
          <label>
            AUTHENTICATOR OR RECOVERY CODE
            <input
              name="code"
              autoComplete="one-time-code"
              required
              autoFocus
            />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button>VERIFY →</button>
        </form>
        <button
          className="auth-switch"
          onClick={() => {
            setTwoFactor(null);
            setError("");
          }}
        >
          BACK TO LOGIN
        </button>
      </main>
    );
  return (
    <main className="auth">
      <div className="auth-logo">DAYMARK_</div>
      <p>
        {mode === "login"
          ? "SIGN IN TO YOUR PRIVATE LOG"
          : mode === "reactivate"
            ? "REACTIVATE A SELF-DEACTIVATED ACCOUNT"
          : mode === "register"
            ? "CREATE YOUR DAYMARK ACCOUNT"
            : "REQUEST A PASSWORD RESET"}
      </p>
      <form onSubmit={go}>
        {mode === "forgot" ? (
          <label>
            EMAIL
            <input name="email" type="email" required autoFocus />
          </label>
        ) : (
          <>
            {mode === "register" && (
              <>
                <label>
                  DISPLAY NAME
                  <input name="displayName" required />
                </label>
                <label>
                  EMAIL
                  <input name="email" type="email" required />
                </label>
                {registrationMode === "invite" && (
                  <label>
                    INVITATION CODE
                    <input name="inviteCode" required />
                  </label>
                )}
              </>
            )}
            <label>
              {mode === "login" || mode === "reactivate" ? "USERNAME OR EMAIL" : "USERNAME"}
              <input
                name={mode === "login" || mode === "reactivate" ? "login" : "username"}
                ref={mode === "login" ? loginRef : undefined}
                required
                autoFocus
              />
            </label>
            <label>
              PASSWORD
              <input name="password" type="password" minLength="10" required />
            </label>
          </>
        )}
        {error && <div className="auth-error">{error}</div>}
        {message && <div className="auth-success">{message}</div>}
        <button>
          {mode === "login"
            ? "LOGIN →"
            : mode === "reactivate"
              ? "REACTIVATE ACCOUNT →"
            : mode === "register"
              ? "CREATE ACCOUNT →"
              : "SEND RESET LINK →"}
        </button>
        {mode === "login" && browserSupportsWebAuthn() && (
          <button
            type="button"
            className="passkey-login"
            onClick={passkeyLogin}
          >
            <KeyRound /> LOGIN WITH PASSKEY
          </button>
        )}
      </form>
      {(registrationMode !== "closed" || mode !== "login") && (
        <button
          className="auth-switch"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
            setMessage("");
          }}
        >
          {mode === "login"
            ? "Need an account? Register"
            : "Already registered? Login"}
        </button>
      )}
      {mode === "login" && (
        <>
          <button className="auth-switch" onClick={() => setMode("forgot")}>Forgot your password?</button>
          <button className="auth-switch" onClick={() => setMode("reactivate")}>Reactivate a deactivated account</button>
        </>
      )}
    </main>
  );
}
function TrashPanel({ entries, close, restore, destroy }) {
  return (
    <div
      className="modal trash-modal"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section>
        <header>
          <span>TRASH / {entries.length} ENTRIES</span>
          <button onClick={close}>
            <X />
          </button>
        </header>
        {!entries.length && <p className="trash-empty">TRASH IS EMPTY_</p>}
        {entries.map((e) => (
          <article key={e.id}>
            <div>
              <strong>{e.title}</strong>
              <small>
                {e.date} · {e.tags.join(", ")}
              </small>
            </div>
            <button onClick={() => restore(e)}>
              <RotateCcw /> RESTORE
            </button>
            <button className="destroy" onClick={() => destroy(e)}>
              <Trash2 /> DELETE FOREVER
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
function HistoryPanel({ data, close, restore }) {
  return (
    <div
      className="modal trash-modal"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section>
        <header>
          <span>REVISION_HISTORY / {data.entry.title}</span>
          <button onClick={close}>
            <X />
          </button>
        </header>
        {!data.revisions.length && (
          <p className="trash-empty">NO EARLIER VERSIONS_</p>
        )}
        {data.revisions.map((r, i) => (
          <article key={r.id}>
            <div>
              <strong>{r.title || "Untitled"}</strong>
              <small>
                {new Date(r.created_at).toLocaleString()} · VERSION{" "}
                {data.revisions.length - i}
              </small>
            </div>
            <button onClick={() => restore(r)}>
              <RotateCcw /> RESTORE VERSION
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
function PublicEntry({ token }) {
  const [entry, setEntry] = useState(null),
    [passwordRequired, setPasswordRequired] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/public/${encodeURIComponent(token)}`).then(async (response) => {
      const data = await response.json();
      if (response.ok) setEntry(data);
      else if (response.status === 401) setPasswordRequired(true);
      else setError(data.error || "Shared entry unavailable");
    });
  }, [token]);
  const unlock = async (event) => {
    event.preventDefault();
    setError("");
    const password = new FormData(event.currentTarget).get("password"),
      response = await fetch(
        `/api/public/${encodeURIComponent(token)}/access`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      ),
      data = await response.json();
    if (response.ok) {
      setEntry(data);
      setPasswordRequired(false);
    } else setError(data.error || "Could not unlock entry");
  };
  if (error && !passwordRequired)
    return (
      <main className="public-error">
        <div className="auth-logo">DAYMARK_</div>
        <p>{error}</p>
      </main>
    );
  if (passwordRequired)
    return (
      <main className="auth public-unlock">
        <div className="auth-logo">DAYMARK_</div>
        <p>THIS SHARED ENTRY IS PASSWORD PROTECTED</p>
        <form onSubmit={unlock}>
          <label>
            PASSWORD
            <input name="password" type="password" required autoFocus />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button>UNLOCK →</button>
        </form>
      </main>
    );
  if (!entry) return <div className="boot">OPENING SHARED ENTRY_</div>;
  return (
    <main className="public-page">
      <header>
        <a className="logo" href="/">
          FIELD<span>.LOG</span>
        </a>
        <span>SHARED ENTRY · READ ONLY</span>
      </header>
      <article>
        <time>
          {entry.date} · {entry.author}
        </time>
        <h1>{entry.title}</h1>
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {entry.body.join("\n\n")}
          </ReactMarkdown>
        </div>
        {entry.media?.length > 0 && <Media items={entry.media} />}
        {entry.link && (
          <p>
            <a href={entry.link} target="_blank" rel="noreferrer">
              {entry.link}
            </a>
          </p>
        )}
        <footer>
          {entry.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </footer>
      </article>
    </main>
  );
}
function SharePanel({ entry, preferences, close }) {
  const [links, setLinks] = useState([]),
    [created, setCreated] = useState(""),
    [copied, setCopied] = useState(false),
    [preparing, setPreparing] = useState(true);
  const load = async () => {
    const response = await fetch(`/api/entries/${entry.id}/public-links`),
      data = await response.json();
    setLinks(data);
    return data;
  };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await load(),
          reusable = existing.find((link) => link.url && !link.password_protected);
        if (cancelled) return;
        if (reusable) setCreated(`${location.origin}${reusable.url}`);
        else {
          const response = await fetch(`/api/entries/${entry.id}/public-links/automatic`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ days: preferences?.shareExpiryDays || 7 }),
            }),
            data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not prepare a share link");
          if (!cancelled) {
            setCreated(`${location.origin}${data.url}`);
            await load();
          }
        }
      } catch (error) {
        if (!cancelled) alert(error.message);
      } finally {
        if (!cancelled) setPreparing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entry.id]);
  const create = async (event) => {
    event.preventDefault();
    const response = await fetch(`/api/entries/${entry.id}/public-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      }),
      data = await response.json();
    if (!response.ok) return alert(data.error);
    const url = `${location.origin}${data.url}`;
    setCreated(url);
    navigator.clipboard?.writeText(url).catch(() => {});
    load();
  };
  const copyLink = async () => {
    if (!created) return;
    await navigator.clipboard?.writeText(created);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const shareText = `Read “${entry.title}”`,
    encodedUrl = encodeURIComponent(created),
    encodedText = encodeURIComponent(shareText),
    shareTargets = created ? [
      ["EMAIL", `mailto:?subject=${encodeURIComponent(entry.title)}&body=${encodedText}%0A%0A${encodedUrl}`],
      ["WHATSAPP", `https://wa.me/?text=${encodedText}%20${encodedUrl}`],
      ["FACEBOOK", `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`],
      ["X", `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`],
      ["REDDIT", `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodeURIComponent(entry.title)}`],
    ] : [];
  const nativeShare = async () => {
    if (!created || !navigator.share) return;
    try {
      await navigator.share({ title: entry.title, text: shareText, url: created });
    } catch (error) {
      if (error.name !== "AbortError") alert("This link could not be shared.");
    }
  };
  const revoke = async (id) => {
    if (!confirm("Revoke this public link?")) return;
    await fetch(`/api/public-links/${id}`, { method: "DELETE" });
    load();
  };
  return (
    <div
      className="modal share-modal"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section>
        <header>
          <span>SHARE / {entry.title}</span>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <form onSubmit={create}>
          <label>
            EXPIRES
            <select name="days" defaultValue={String(preferences?.shareExpiryDays || 7)}>
              {![1, 7, 30, 365].includes(Number(preferences?.shareExpiryDays)) && <option value={preferences?.shareExpiryDays}>{preferences?.shareExpiryDays} days</option>}
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="365">1 year</option>
            </select>
          </label>
          <label>
            OPTIONAL PASSWORD
            <input
              name="password"
              type="password"
              minLength="8"
              placeholder="At least 8 characters"
            />
          </label>
          <button disabled={preparing}>{preparing ? "PREPARING…" : "CREATE ANOTHER LINK"}</button>
        </form>
        {preparing && <div className="share-preparing">PREPARING A SECURE SHARE LINK_</div>}
        {created && (
          <div className="share-ready">
            <span>YOUR LINK IS READY</span>
            <div className="invite-link">
              <input readOnly value={created} onFocus={(event) => event.currentTarget.select()} />
              <button onClick={copyLink}><Copy /> {copied ? "COPIED" : "COPY LINK"}</button>
            </div>
            <div className="share-destinations">
              {navigator.share && <button onClick={nativeShare}><Share2 /> SHARE…</button>}
              {shareTargets.map(([label, href]) => (
                <a key={label} href={href} target={label === "EMAIL" ? undefined : "_blank"} rel="noreferrer">
                  {label === "EMAIL" ? <Mail /> : <Send />} {label}
                </a>
              ))}
            </div>
          </div>
        )}
        {!created && <p className="share-guidance">Create a secure public link first, then choose where to share it. Private entries remain private until a link is created.</p>}
        <div className="share-history-heading"><span>ACTIVE &amp; PREVIOUS LINKS</span><b>{links.filter((link) => !link.revoked_at).length} ACTIVE</b></div>
        <div className="public-links">
          {links.map((link) => (
            <article key={link.id} className={link.revoked_at ? "revoked" : ""}>
              <span>
                <strong>
                  {link.password_protected
                    ? "PASSWORD PROTECTED"
                    : "NO PASSWORD"}
                </strong>
                Expires {new Date(link.expires_at).toLocaleString()} ·{" "}
                {link.view_count} views
              </span>
              {link.revoked_at ? (
                <b>REVOKED</b>
              ) : (
                <button onClick={() => revoke(link.id)}>REVOKE</button>
              )}
            </article>
          ))}
          {!links.length && <p className="trash-empty">NO PUBLIC LINKS_</p>}
        </div>
      </section>
    </div>
  );
}
function ReactionPicker({ reactions, emojis, onReact, entryLevel = false, iconOnly = false }) {
  const [open, setOpen] = useState(false),
    picker = useRef(null),
    closeTimer = useRef(null),
    mine = reactions.find((reaction) => reaction.mine),
    total = reactions.length;
  useEffect(() => {
    if (!open) return;
    const dismiss = (event) => !picker.current?.contains(event.target) && setOpen(false);
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const openPicker = () => {
      clearTimeout(closeTimer.current);
      setOpen(true);
    },
    scheduleClose = () => {
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setOpen(false), 180);
    };
  return (
    <div className={`reaction-picker ${entryLevel ? "entry-level" : ""}`} ref={picker} onMouseEnter={openPicker} onMouseLeave={scheduleClose}>
      <button type="button" className={`reaction-trigger ${mine ? "active" : ""}`} onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        {entryLevel ? <><ThumbsUp /><span>{total}</span></> : <><ThumbsUp />{!iconOnly && <span>{mine ? "REACTED" : "LIKE"}</span>}</>}
      </button>
      {open && (
        <div className="reaction-menu">
          {emojis.map((emoji) => {
            const matches = reactions.filter((reaction) => reaction.emoji === emoji);
            return <button type="button" key={emoji} className={!entryLevel && matches.some((reaction) => reaction.mine) ? "active" : ""} onClick={() => { onReact(emoji); setOpen(false); }} title={`React with ${emoji}`}>{emoji}{!entryLevel && matches.length ? <small>{matches.length}</small> : null}</button>;
          })}
        </div>
      )}
    </div>
  );
}
function SocialPanel({ entry, close, embedded = false }) {
  const [data, setData] = useState({ comments: [], reactions: [] }),
    [replyTo, setReplyTo] = useState(null),
    [deletingComment, setDeletingComment] = useState(null),
    emojis = ["👍", "❤️", "✨", "😂", "🤔"];
  const load = () =>
    fetch(`/api/entries/${entry.id}/social`)
      .then((response) => response.json())
      .then(setData);
  useEffect(load, [entry.id]);
  const react = async (emoji, commentId = null) => {
    await fetch(`/api/entries/${entry.id}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji, commentId }),
    });
    load();
  };
  const comment = async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      body = String(new FormData(form).get("body") || "");
    const response = await fetch(`/api/entries/${entry.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, parentId: replyTo }),
    });
    if (!response.ok) return alert((await response.json()).error);
    form.reset();
    setReplyTo(null);
    load();
    if (pending) alert("Your comment is waiting for approval.");
  };
  const remove = async (commentId) => {
    const response = await fetch(`/api/comments/${commentId}`, { method: "DELETE" });
    if (response.ok) {
      setDeletingComment(null);
      load();
    }
    return response.ok;
  };
  const reactionButtons = (commentId = null, entryLevel = false, iconOnly = false) => (
    <ReactionPicker
      emojis={emojis}
      reactions={data.reactions.filter((reaction) => (reaction.comment_id ? +reaction.comment_id : null) === commentId)}
      onReact={(emoji) => react(emoji, commentId)}
      entryLevel={entryLevel}
      iconOnly={iconOnly}
    />
  );
  const entryReactionGroups = emojis.map((emoji) => ({
    emoji,
    reactions: data.reactions.filter((reaction) => !reaction.comment_id && reaction.emoji === emoji),
  })).filter((group) => group.reactions.length);
  const commentIds = new Set(data.comments.map((item) => +item.id)),
    childrenByParent = new Map();
  for (const item of data.comments) {
    const parentId = item.parent_id && commentIds.has(+item.parent_id) ? +item.parent_id : null;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(item);
  }
  const renderComment = (item, depth = 0, ancestry = new Set()) => {
    if (ancestry.has(+item.id)) return null;
    const nextAncestry = new Set(ancestry).add(+item.id),
      commentReactionGroups = emojis.map((emoji) => ({
        emoji,
        reactions: data.reactions.filter((reaction) => +reaction.comment_id === +item.id && reaction.emoji === emoji),
      })).filter((group) => group.reactions.length);
    return <React.Fragment key={item.id}>
      <article className={depth ? "reply" : ""} style={depth ? { "--reply-depth": Math.min(depth, 6) } : undefined}>
        <header className={item.deleted ? "deleted-comment-header" : ""}>
          {!item.deleted && <strong>{item.display_name} <small>@{item.username}</small></strong>}
          <div className="comment-header-meta">
            <time>{new Date(item.created_at).toLocaleString()}</time>
            {!item.deleted && <div className="comment-actions">
              <button onClick={() => setReplyTo(item.id)}>REPLY</button>
              {item.can_delete && <button className="danger" onClick={() => setDeletingComment({ ...item, hasReplies: (childrenByParent.get(+item.id) || []).length > 0 })}>DELETE</button>}
            </div>}
          </div>
        </header>
        {item.deleted ? <p className="deleted-comment-body"><Trash2 /> This message was deleted.</p> : <p>{item.body}</p>}
        {!item.deleted && !item.approved && <i className="pending-comment">WAITING FOR APPROVAL</i>}
        {!item.deleted && <footer>
          <div className="comment-reactions">{reactionButtons(+item.id, false, depth > 0)}</div>
          {commentReactionGroups.length > 0 && (
            <div className="entry-reaction-breakdown comment-reaction-breakdown" aria-label="Comment reactions">
              {commentReactionGroups.map((group) => (
                <span key={group.emoji} data-tooltip={[...new Set(group.reactions.map((reaction) => reaction.display_name))].join(", ")} aria-label={`${group.emoji}: ${[...new Set(group.reactions.map((reaction) => reaction.display_name))].join(", ")}`}>
                  {group.emoji}
                </span>
              ))}
            </div>
          )}
        </footer>}
      </article>
      {(childrenByParent.get(+item.id) || []).map((child) => renderComment(child, depth + 1, nextAncestry))}
    </React.Fragment>;
  };
  return (
    <div
      id={embedded ? "discussion" : undefined}
      className={embedded ? "entry-discussion" : "modal social-modal"}
      onMouseDown={(event) =>
        !embedded && event.target === event.currentTarget && close()
      }
    >
      <section>
        <header>
          <span>DISCUSSION</span>
          {!embedded && (
            <button onClick={close}>
              <X />
            </button>
          )}
        </header>
        <div className="entry-social-bar">
          <div className="entry-social-counts">
            {reactionButtons(null, true)}
            <span><MessageSquare /> {data.comments.filter((item) => !item.deleted).length}</span>
          </div>
          {entryReactionGroups.length > 0 && (
            <div className="entry-reaction-breakdown" aria-label="Entry reactions">
              {entryReactionGroups.map((group) => (
                <span key={group.emoji} data-tooltip={[...new Set(group.reactions.map((reaction) => reaction.display_name))].join(", ")} aria-label={`${group.emoji}: ${[...new Set(group.reactions.map((reaction) => reaction.display_name))].join(", ")}`}>
                  {group.emoji}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="comments-list">
          {(childrenByParent.get(null) || []).map((item) => renderComment(item))}
          {!data.comments.length && (
            <p className="trash-empty">NO COMMENTS YET_</p>
          )}
        </div>
        <form className="comment-form" onSubmit={comment}>
          {replyTo && (
            <span>
              REPLYING TO COMMENT {replyTo}{" "}
              <button type="button" onClick={() => setReplyTo(null)}>
                CANCEL
              </button>
            </span>
          )}
          <textarea
            name="body"
            maxLength="5000"
            required
            placeholder="Write a comment… Use @username to mention a journal member."
          />
          <button>POST COMMENT →</button>
        </form>
      </section>
      {deletingComment && <DeleteCommentModal comment={deletingComment} close={() => setDeletingComment(null)} confirm={() => remove(deletingComment.id)} />}
    </div>
  );
}
function DeleteCommentModal({ comment, close, confirm }) {
  const [working, setWorking] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const onKeyDown = (event) => event.key === "Escape" && !working && close();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, working]);
  return <div className="modal delete-entry-modal delete-comment-modal" role="dialog" aria-modal="true" aria-labelledby="delete-comment-title" onMouseDown={(event) => event.target === event.currentTarget && !working && close()}>
    <section>
      <header><div><Trash2 /><span>DELETE COMMENT</span></div><button type="button" onClick={close} disabled={working} aria-label="Close"><X /></button></header>
      <div className="delete-entry-copy">
        <span>COMMENT BY {comment.display_name.toUpperCase()}</span>
        <h2 id="delete-comment-title">Delete this comment?</h2>
        <blockquote>{comment.body.length > 220 ? `${comment.body.slice(0, 220)}…` : comment.body}</blockquote>
        <p>{comment.hasReplies ? "The comment text, author details, and reactions will be removed. Replies will remain in their current thread." : "This comment has no replies and will be permanently deleted. This action cannot be undone."}</p>
        {error && <p className="form-error">{error}</p>}
      </div>
      <footer><button type="button" onClick={close} disabled={working}>CANCEL</button><button type="button" className="danger" autoFocus disabled={working} onClick={async () => { setWorking(true); setError(""); if (!(await confirm())) { setError("The comment could not be deleted."); setWorking(false); } }}><Trash2 /> {working ? "DELETING_" : "DELETE COMMENT"}</button></footer>
    </section>
  </div>;
}
function ActivityPanel({ journals, close }) {
  const [journalId, setJournalId] = useState(journals[0]?.id || ""),
    [items, setItems] = useState([]);
  useEffect(() => {
    if (journalId)
      fetch(`/api/journals/${journalId}/activity`)
        .then((response) => response.json())
        .then(setItems);
  }, [journalId]);
  return (
    <div
      className="modal activity-modal"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section>
        <header>
          <span>JOURNAL_ACTIVITY</span>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <select
          value={journalId}
          onChange={(event) => setJournalId(event.target.value)}
        >
          {journals.map((journal) => (
            <option key={journal.id} value={journal.id}>
              {journal.name}
            </option>
          ))}
        </select>
        <div>
          {items.map((item) => (
            <article key={item.id}>
              <Activity />
              <span>
                <strong>{item.display_name || "Former member"}</strong>{" "}
                {item.action.replaceAll("_", " ")}{" "}
                {item.entry_title && <b>“{item.entry_title}”</b>}
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </span>
            </article>
          ))}
          {!items.length && <p className="trash-empty">NO ACTIVITY YET_</p>}
        </div>
      </section>
    </div>
  );
}
function NotificationPanel({ close }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    fetch("/api/notifications")
      .then((response) => response.json())
      .then(setItems);
    fetch("/api/notifications/read", { method: "POST" });
  }, []);
  return (
    <div
      className="modal activity-modal"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section>
        <header>
          <span>INBOX / NOTIFICATIONS</span>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <div>
          {items.map((item) => (
            <article className={item.read_at ? "" : "unread"} key={item.id}>
              <Bell />
              <span>
                <strong>{item.actor || "Security"}</strong>{" "}{item.type === "reply" ? "replied to your comment in" : item.type === "comment" ? "commented on" : item.type === "mention" ? "mentioned you in" : item.type === "shared_entry_created" ? "created a shared entry" : item.type === "shared_entry_updated" ? "updated a shared entry" : item.type === "security_new_device" ? "recorded a sign-in from a new device" : "reported a failed sign-in"}{" "}
                <b>“{item.entry_title}”</b>
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </span>
            </article>
          ))}
          {!items.length && <p className="trash-empty">NO NOTIFICATIONS_</p>}
        </div>
      </section>
    </div>
  );
}
function JournalPanel({ journals, update }) {
  const [sharing, setSharing] = useState(null),
    journalItems = Array.isArray(journals) ? journals.filter((item) => item?.id) : [];
  const create = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)),
      response = await fetch("/api/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    if (!response.ok) return alert((await response.json()).error);
    update([...journalItems, await response.json()]);
    event.currentTarget.reset();
  };
  const save = async (item, changes) => {
    const response = await fetch(`/api/journals/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item, ...changes }),
    });
    if (!response.ok) return alert((await response.json()).error);
    const saved = await response.json();
    update(
      journalItems
        .map((journal) =>
          journal.id === item.id
            ? { ...saved, entryCount: item.entryCount }
            : changes.isDefault
              ? { ...journal, isDefault: false }
              : journal,
        )
        .sort((a, b) => b.isDefault - a.isDefault || a.sortOrder - b.sortOrder),
    );
  };
  const move = async (item, direction) => {
    const ordered = [...journalItems].sort((a, b) => a.sortOrder - b.sortOrder),
      index = ordered.findIndex((journal) => journal.id === item.id),
      other = ordered[index + direction];
    if (!other) return;
    const write = (journal, sortOrder) =>
      fetch(`/api/journals/${journal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...journal, sortOrder }),
      });
    const responses = await Promise.all([
      write(item, other.sortOrder),
      write(other, item.sortOrder),
    ]);
    if (responses.some((response) => !response.ok))
      return alert("Could not reorder journals");
    update(
      journalItems
        .map((journal) =>
          journal.id === item.id
            ? { ...journal, sortOrder: other.sortOrder }
            : journal.id === other.id
              ? { ...journal, sortOrder: item.sortOrder }
              : journal,
        )
        .sort((a, b) => b.isDefault - a.isDefault || a.sortOrder - b.sortOrder),
    );
  };
  const remove = async (item) => {
    if (!confirm(`Delete empty journal “${item.name}”?`)) return;
    const response = await fetch(`/api/journals/${item.id}`, {
      method: "DELETE",
    });
    if (response.ok)
      update(journalItems.filter((journal) => journal.id !== item.id));
    else alert((await response.json()).error);
  };
  return (
    <section className="journal-settings-panel">
        <header><span>JOURNALS</span><p>Organize entries into separate spaces and control how each one is shared.</p></header>
        <div className="journal-list">
          {journalItems.map((item) =>
            item.owned ? (
              <JournalEditor
                key={item.id}
                item={item}
                save={save}
                move={move}
                remove={remove}
                share={() => setSharing(item)}
              />
            ) : (
              <article
                className="shared-journal"
                key={item.id}
                style={{ borderLeftColor: item.color }}
              >
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.description || "Shared journal"}</span>
                </div>
                <b>{String(item.role || "member").toUpperCase()}</b>
                <span>{item.entryCount} ENTRIES</span>
              </article>
            ),
          )}
        </div>
        <section className="journal-create-section">
          <header><span>CREATE JOURNAL</span><p>Add another space for a project, trip, or part of your life.</p></header>
          <form className="journal-create" onSubmit={create}>
            <label>NAME<input name="name" placeholder="New journal name" required maxLength="80" /></label>
            <label>COLOUR<input name="color" type="color" defaultValue="#7aa2f7" title="Journal color" /></label>
            <label>VISIBILITY<select name="visibility"><option value="private">Private</option><option value="public">Public</option></select></label>
            <button><Plus /> ADD JOURNAL</button>
          </form>
        </section>
        {sharing && (
          <JournalSharing journal={sharing} close={() => setSharing(null)} />
        )}
    </section>
  );
}
function JournalEditor({ item, save, move, remove, share }) {
  const [editingName, setEditingName] = useState(item.name),
    [description, setDescription] = useState(item.description || "");
  return (
    <article className="journal-editor" style={{ borderLeftColor: item.color }}>
      <div className="journal-fields">
        <input
          aria-label="Journal name"
          value={editingName}
          onChange={(event) => setEditingName(event.target.value)}
        />
        <input
          aria-label="Journal description"
          placeholder="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="journal-side">
        <div className="journal-options">
          <label>COLOUR<input type="color" value={item.color} onChange={(event) => save(item, { color: event.target.value })} /></label>
          <label>VISIBILITY<select value={item.visibility} onChange={(event) => save(item, { visibility: event.target.value })}><option value="private">Private</option><option value="public">Public</option></select></label>
          <span>{item.entryCount} {item.entryCount === 1 ? "ENTRY" : "ENTRIES"}</span>
        </div>
        <div className="journal-row-actions">
          <button onClick={share}>SHARE</button>
          <button title="Move up" aria-label="Move journal up" onClick={() => move(item, -1)}><ArrowUp /></button>
          <button title="Move down" aria-label="Move journal down" onClick={() => move(item, 1)}><ArrowDown /></button>
          {!item.isDefault && <button onClick={() => save(item, { isDefault: true })}>SET DEFAULT</button>}
          <button className="primary" onClick={() => save(item, { name: editingName, description })}>SAVE</button>
          {!item.isDefault && <button className="danger" aria-label="Delete journal" onClick={() => remove(item)}><Trash2 /></button>}
        </div>
      </div>
    </article>
  );
}
function JournalSharing({ journal, close }) {
  const [data, setData] = useState({ members: [], invitations: [] }),
    [link, setLink] = useState("");
  const load = () =>
    fetch(`/api/journals/${journal.id}/members`)
      .then((response) => response.json())
      .then(setData);
  useEffect(load, [journal.id]);
  const invite = async (event) => {
    event.preventDefault();
    const response = await fetch(`/api/journals/${journal.id}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      }),
      result = await response.json();
    if (!response.ok) return alert(result.error);
    const invitationLink = `${location.origin}${result.acceptUrl}`;
    setLink(invitationLink);
    navigator.clipboard?.writeText(invitationLink).catch(() => {});
    load();
  };
  const role = async (member, nextRole) => {
    await fetch(`/api/journals/${journal.id}/members/${member.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
    load();
  };
  const remove = async (member) => {
    if (!confirm(`Remove ${member.display_name} from this journal?`)) return;
    await fetch(`/api/journals/${journal.id}/members/${member.id}`, {
      method: "DELETE",
    });
    load();
  };
  return (
    <div className="sharing-panel">
      <header>
        <span>SHARING / {journal.name}</span>
        <button onClick={close}>
          <X />
        </button>
      </header>
      <form onSubmit={invite}>
        <input
          name="email"
          type="email"
          placeholder="Optional recipient email"
        />
        <select name="role">
          <option value="viewer">Viewer</option>
          <option value="contributor">Contributor</option>
          <option value="editor">Editor</option>
        </select>
        <select name="days" defaultValue="7">
          <option value="1">1 day</option>
          <option value="7">7 days</option>
          <option value="30">30 days</option>
        </select>
        <button>CREATE INVITE</button>
      </form>
      {link && (
        <div className="invite-link">
          <input readOnly value={link} />
          <button onClick={() => navigator.clipboard?.writeText(link)}>
            COPY
          </button>
        </div>
      )}
      <div className="member-list">
        {data.members.map((member) => (
          <article key={member.id}>
            <span>
              <strong>{member.display_name}</strong>
              {member.email}
            </span>
            <select
              value={member.role}
              onChange={(event) => role(member, event.target.value)}
            >
              <option value="viewer">Viewer</option>
              <option value="contributor">Contributor</option>
              <option value="editor">Editor</option>
            </select>
            <button onClick={() => remove(member)}>
              <Trash2 />
            </button>
          </article>
        ))}
        {data.invitations.map((invitation) => (
          <article key={`invite-${invitation.id}`}>
            <span>
              <strong>{invitation.email || "Open invitation"}</strong>Expires{" "}
              {new Date(invitation.expires_at).toLocaleDateString()}
            </span>
            <b>{invitation.role}</b>
          </article>
        ))}
      </div>
    </div>
  );
}
function DataPanel({ close }) {
  const [message, setMessage] = useState(""),
    [deleting, setDeleting] = useState(false),
    [lifecycle, setLifecycle] = useState(null),
    loadLifecycle = () => fetch("/api/account/lifecycle").then((response) => response.json()).then(setLifecycle);
  useEffect(loadLifecycle, []);
  const importFile = async (e) => {
    e.preventDefault();
    const body = new FormData(e.currentTarget),
      r = await fetch("/api/import/json", { method: "POST", body }),
      data = await r.json();
    if (r.ok) {
      setMessage(`${data.imported} entries imported. Reloading...`);
      setTimeout(() => location.reload(), 900);
    } else setMessage(data.error || "Import failed");
  };
  const deleteAccount = async (event) => {
    event.preventDefault();
    if (
      !confirm(
        "Schedule account deletion in 30 days? You can cancel during the recovery period.",
      )
    )
      return;
    setDeleting(true);
    const response = await fetch("/api/account/deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      }),
      result = await response.json();
    if (!response.ok) {
      setDeleting(false);
      return setMessage(result.error || "Account deletion failed");
    }
    setDeleting(false);
    setMessage("Account deletion scheduled. You have 30 days to cancel.");
    loadLifecycle();
  };
  return (
    <div
      className="modal trash-modal"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section>
        <header>
          <span>YOUR_DATA</span>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <div className="data-grid">
          <a href="/api/export/json">
            <Download /> COMPLETE ACCOUNT JSON
            <small>
              All profile, content, collaboration, and security records
            </small>
          </a>
          <a href="/api/export/zip">
            <Download /> MARKDOWN + MEDIA ZIP
            <small>Readable files and originals</small>
          </a>
          <a href="/api/export/pdf">
            <Download /> PRINTABLE PDF<small>Human-readable journal</small>
          </a>
        </div>
        <form className="import-form" onSubmit={importFile}>
          <label>
            <Upload /> IMPORT JSON OR MARKDOWN
            <input
              type="file"
              name="file"
              accept="application/json,.json,text/markdown,.md"
              required
            />
          </label>
          <button>IMPORT ENTRIES</button>
          {message && <p>{message}</p>}
        </form>
        <section className="account-lifecycle">
          <header><strong>JOURNAL OWNERSHIP</strong><p>Transfer journals before leaving while retaining editor access.</p></header>
          <form onSubmit={async (event) => { event.preventDefault(); const response = await fetch("/api/account/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); const result = await response.json(); setMessage(response.ok ? `${result.transferred} journal(s) transferred to @${result.owner}.` : result.error); if (response.ok) loadLifecycle(); }}>
            <label>JOURNAL<select name="journalId"><option value="all">All owned journals</option>{lifecycle?.journals?.map((journal) => <option key={journal.id} value={journal.id}>{journal.name}</option>)}</select></label>
            <label>NEW OWNER USERNAME<input name="username" required /></label>
            <button disabled={!lifecycle?.journals?.length}>TRANSFER OWNERSHIP</button>
          </form>
        </section>
        <section className="account-lifecycle">
          <header><strong>TEMPORARY DEACTIVATION</strong><p>Sign out and hide your account until you reactivate it from the login page.</p></header>
          <form onSubmit={async (event) => { event.preventDefault(); if (!confirm("Temporarily deactivate this account and sign out?")) return; const response = await fetch("/api/account/deactivate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); if (response.ok) location.assign("/"); else setMessage((await response.json()).error); }}>
            <label>CURRENT PASSWORD<input name="password" type="password" autoComplete="current-password" required /></label>
            <button>DEACTIVATE ACCOUNT</button>
          </form>
        </section>
        <form className="account-delete" onSubmit={deleteAccount}>
          <strong>DELAYED ACCOUNT DELETION</strong>
          <p>
            {lifecycle?.deletion_scheduled_for ? `Deletion is scheduled for ${new Date(lifecycle.deletion_scheduled_for).toLocaleString()}. Cancel before then to recover the account.` : "Schedules permanent removal in 30 days. Your account remains available during the recovery period, and deletion includes owned journals, entries, collaboration records, backups, and media."}
          </p>
          <label>
            CURRENT PASSWORD
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {!lifecycle?.deletion_scheduled_for && <button className="danger" disabled={deleting}>{deleting ? "SCHEDULING_" : "SCHEDULE DELETION"}</button>}
          {lifecycle?.deletion_scheduled_for && <button type="button" onClick={async () => { await fetch("/api/account/deletion", { method: "DELETE" }); setMessage("Scheduled deletion cancelled."); loadLifecycle(); }}>CANCEL DELETION</button>}
        </form>
      </section>
    </div>
  );
}
if ("serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );
createRoot(document.getElementById("root")).render(<App />);
