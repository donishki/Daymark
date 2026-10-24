# Daymark roadmap

## P0 — Storage and data safety

- [x] Replace base64 database attachments with included MinIO object storage.
- [x] Generate image thumbnails and retain original files.
- [x] Add upload progress, captions, attachment removal, and storage quotas.
- [x] Add soft deletion and a trash/recovery workflow.
- [x] Add entry revision history and restore.
- [x] Add automatic backups and documented restore verification.
- [x] Add JSON, Markdown, PDF, and media-inclusive ZIP export.
- [x] Add JSON import and portable Markdown ingestion through Daymark archives.

## P1 — Writing and discovery

- [x] Add a Markdown/rich-text editor with formatting and checklists.
- [x] Add autosaved drafts and recovery.
- [x] Add word counts, full-screen writing, and keyboard shortcuts.
- [x] Add reusable templates and prompts.
- [x] Add calendar, timeline, gallery, and global map views.
- [x] Add PostgreSQL full-text search and advanced filters.
- [x] Add related, random, and “On this day” entries.
- [x] Add streaks and writing statistics.

## P2 — Journals and collaboration

- [x] Add multiple journals per user.
- [x] Add journal colors, defaults, visibility, and sorting.
- [x] Add invitations and owner/editor/contributor/viewer roles.
- [x] Add comments, reactions, mentions, and activity history.
- [x] Add expiring and password-protected public links.
- [x] Add entry links, backlinks, people, collections, and graph view.

## P3 — Accounts and privacy

- [x] Add password reset and email verification.
- [x] Add two-factor authentication and passkeys.
- [x] Add session/device management and login history.
- [x] Add CSRF protection and rate limiting.
- [x] Add registration controls and an administrator dashboard.
- [x] Add account deletion and complete data export.
- [x] Design and implement optional client-side end-to-end encryption.

## P4 — Mobile and enrichment

- [x] Add installable PWA support and offline drafts.
- [x] Add background synchronization and share-to-diary.
- [x] Add mobile photo capture, voice recording, and reminders.
- [x] Add location search, EXIF extraction, and automatic weather.
- [x] Add link previews and rich video embeds.
- [x] Add optional audio transcription and document OCR.

## P5 - User settings

- [x] Add persisted account preferences and authenticated settings APIs.
- [x] Add Diary, Editor, Appearance, and Notification preference pages.
- [x] Add Profile and Privacy preference pages.
- [x] Consolidate security, sessions, exports, and account lifecycle into Security & Data.
- [x] Apply saved diary, editor, appearance, notification, and privacy preferences throughout the application.

## P6 - Complete user settings feature set

- [x] Add and apply date, time, timezone, measurement, and week-start preferences.
- [x] Add editor mode, image quality, map zoom, and remembered entry defaults.
- [x] Add accent colour, interface scale/density, reduced motion, compact entries, and custom diary covers.
- [x] Complete public identity with uploaded avatars and public author pages.
- [x] Add global public-link management, comment approval, and blocked users.
- [x] Add browser/email delivery, shared-entry and security alerts, quiet hours, and digests.
- [x] Add storage graphs, largest-file tools, duplicate detection, and personal backup history.
- [x] Add tag management, recurring prompts, configurable reminders, and writing goals.
- [x] Add deactivation, journal ownership transfer, and delayed account deletion.
