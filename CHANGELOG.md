# Changelog

All notable changes to Daymark are documented here. The format follows Keep a Changelog, and releases use semantic versioning.

## [Unreleased]

## [1.18.1] - 2026-08-29

### Added

- Automatically prepares a reusable share link when the Share panel opens.
- Encrypts recoverable share tokens at rest while retaining one-way hashes for public-link validation.

### Changed

- Reuses an active automatic link instead of creating a new link on every visit.
- Automatically replaces expired or revoked links while preserving manual password-protected link creation.

## [1.18.0] - 2026-08-29

### Added

- Expanded entry sharing with native device sharing, copy-link feedback, email, WhatsApp, Facebook, X, and Reddit actions.
- Added clear link-ready guidance and an active-link count to the sharing panel.

### Changed

- Clarified that creating a public link is the privacy boundary before external sharing options become available.

## [1.17.1] - 2026-08-29

### Changed

- Moved archive discovery beneath Journals in the main navigation sidebar.
- Replaced the oversized archive banner with a compact day count, random-entry action, and "On this day" list.

## [1.17.0] - 2026-08-29

### Changed

- Moved the diary name, description, entry count, recording year, and latest-entry date into the main top header.
- Removed the separate oversized diary masthead to reduce vertical space before the entry list.
- Preserved custom diary cover images as a subtle background on the new identity header.
- Kept account and administration routes on the smaller standard header.

## [1.16.1] - 2026-08-28

### Added

- Added a paperclip indicator beside Timeline titles when an entry contains attachments.
- Added an accessible hover label showing the number of attached files.

## [1.16.0] - 2026-08-27

### Added

- Added a themed photo-information overlay when hovering or focusing images inside diary entries.
- Added safe EXIF preservation for camera make and model, lens, aperture, shutter speed, ISO, focal length, dimensions, and capture time.
- Added file name and size information for existing images that do not contain preserved EXIF data.

### Security

- Excluded GPS coordinates from stored photo hover metadata so the overlay cannot bypass entry location-privacy settings.

## [1.15.3] - 2026-08-26

### Added

- Added the amber pin icon and `PINNED` label beside pinned entry titles in Timeline view.

## [1.15.2] - 2026-08-26

### Fixed

- Enforced pinned-first ordering after client-side edits, searches, journal filters, and view changes.
- Kept unpinned entries ordered by date, time, and entry ID after pinned entries.

## [1.15.1] - 2026-08-26

### Changed

- Removed the duplicate uppercase label from deleted-comment tombstones while retaining the message and timestamp.

## [1.15.0] - 2026-08-26

### Added

- Added tombstone deletion for comments with replies so the discussion tree remains intact.
- Added automatic pruning when a deleted parent no longer has any replies beneath it.

### Changed

- Deleted parent comments now hide their text, author identity, reactions, and controls while preserving their replies.
- Leaf comments continue to be removed completely, and deleted comments are excluded from active counts and moderation queues.
- Updated the deletion modal to explain whether a comment will become a tombstone or be permanently removed.

## [1.14.12] - 2026-08-26

### Added

- Added a designed confirmation modal before permanently deleting a comment.
- Added a comment preview and an explicit warning that nested replies are deleted with their parent.
- Added Escape, outside-click, loading, and deletion-error handling to comment confirmation.

## [1.14.11] - 2026-08-26

### Changed

- Moved Reply and Delete into a compact row directly beneath each comment timestamp.
- Simplified comment footers so they are dedicated exclusively to reaction controls and summaries.

## [1.14.10] - 2026-08-26

### Changed

- Separated comment footer controls into Like on the left, Reply and Delete on the right, and chosen reactions at the far edge.
- Added a subtle divider between comment actions and the chosen-reaction stack when reactions exist.

## [1.14.9] - 2026-08-26

### Fixed

- Kept comment and reply reaction triggers as thumbs-up icons after choosing another reaction.
- Removed the duplicate inline selected emoji and count; chosen reactions now appear only in the right-side stack.

## [1.14.8] - 2026-08-26

### Changed

- Reorganized comment footers with reaction, Reply, and Delete controls grouped on the left.
- Added Facebook-style chosen-reaction stacks on the right of every comment and nested reply.
- Added participant-name tooltips to comment and reply reaction summaries.

## [1.14.7] - 2026-08-26

### Changed

- Simplified the discussion header by removing the repeated diary entry title.

## [1.14.6] - 2026-08-26

### Fixed

- Rendered discussions as real parent-child trees so replies appear directly beneath the comment they answer.
- Added progressive indentation for replies of replies, capped at six levels with tighter spacing on mobile.

## [1.14.5] - 2026-08-26

### Changed

- Removed the Like and Reacted text labels from reaction controls on nested replies.
- Kept reply reaction hover, touch, selection, count, and participant behavior consistent with top-level comments.

## [1.14.4] - 2026-08-26

### Changed

- Changed reaction-summary badges to use the standard hand pointer instead of the help cursor.

## [1.14.3] - 2026-08-26

### Changed

- Simplified the entry reaction tray to show only available emoji choices without selected borders or counts.
- Kept reaction selections and participant details exclusively in the summary stack on the right.

## [1.14.2] - 2026-08-26

### Added

- Added a compact overlapping stack of the reactions chosen for an entry on the right side of its social bar.
- Added per-reaction hover labels listing the people who selected each emoji.

## [1.14.1] - 2026-08-26

### Changed

- Made the left thumbs-up reaction count open the emoji tray on hover or tap.
- Removed the separate blue reaction button from the right side of the discussion bar.

## [1.14.0] - 2026-08-26

### Added

- Added OLED Black, Nord, Dracula, Gruvbox, Solarized Dark, Forest, Rose Pine, and Monochrome themes.

### Changed

- Rebuilt theme support around shared semantic colour tokens so backgrounds, panels, borders, text, controls, and status colours change together.
- Replaced filter-based light themes with native palettes so images, videos, maps, and charts retain their original colours.

## [1.13.3] - 2026-08-26

### Changed

- Reworked entry reactions into a Facebook-style social bar with reaction and comment totals.
- Replaced the labeled entry reaction control with a single circular Like button aligned to the right.
- Made reaction trays open on hover for pointer devices while retaining click support for touch screens.

## [1.13.2] - 2026-08-26

### Changed

- Replaced permanently visible emoji rows with a compact Facebook-style React control.
- Added an on-demand reaction picker, existing-reaction summary, selected state, and outside-click dismissal.

## [1.13.1] - 2026-08-25

### Changed

- Repositioned comment reactions into a compact footer directly beneath each comment.
- Kept emoji reactions left-aligned and grouped Reply and Delete actions on the right.
- Removed the oversized global footer spacing from comment controls.

## [1.13.0] - 2026-08-25

### Changed

- Reorganized User Settings from nineteen fragmented destinations into ten task-focused sections.
- Grouped diary and editor controls, journals and tags, notification tools, privacy tools, and data management into cohesive pages.
- Preserved old settings links by redirecting their hashes to the appropriate new section.
- Tightened the settings sidebar and added consistent spacing between grouped panels.

## [1.12.4] - 2026-08-25

### Added

- Added a visible pin icon and label beside the title of every pinned diary entry.
- Added a designed, accessible confirmation modal when moving an entry to Trash.

## [1.12.3] - 2026-08-25

### Changed

- Shortened the shared entry visibility option label to "Shared".

## [1.12.2] - 2026-08-25

### Changed

- Combined Encrypt Text and Pin Entry into one compact, equally sized composer options row.
- Removed the oversized encryption container while retaining a focused passphrase area only when encryption is enabled.

## [1.12.1] - 2026-08-25

### Removed

- Removed Knowledge Graph from the diary view selector and application view routing.

### Fixed

- Legacy Knowledge Graph URLs and saved default values now fall back safely to Diary instead of rendering an empty view.

## [1.12.0] - 2026-08-25

### Fixed

- Corrected personal Statistics totals by normalizing account and entry owner identifiers before comparison.

### Added

- Redesigned Statistics with interactive summary cards, weekly and monthly goal progress, a 12-month activity chart, weekday writing distribution, a visibility donut, and ranked topic bars.
- Included zero-activity months in the annual chart so trends remain continuous instead of disappearing.

## [1.11.2] - 2026-08-25

### Added

- Gallery images now open their original full-size file in an in-page lightbox with background-click, close-button, and Escape-key dismissal.

## [1.11.1] - 2026-08-25

### Fixed

- Fixed a strict-mode variable declaration error that caused a blank page when opening the date-grouped Gallery.

## [1.11.0] - 2026-08-25

### Added

- Grouped Gallery photos and videos under localized date headings, similar to the Windows Photos timeline.
- Added per-day media counts and entry-page links to Gallery captions.

## [1.10.3] - 2026-08-25

### Added

- Timeline rows now open their corresponding entry pages by mouse click or keyboard activation, with clear hover and focus feedback.

## [1.10.2] - 2026-08-25

### Changed

- Replaced wrapping ISO dates in Timeline with compact day and month/year blocks.
- Added each entry’s time to Timeline using the account’s configured 12- or 24-hour format.

## [1.10.1] - 2026-08-25

### Fixed

- Scoped calendar day filtering to Timeline so switching to another diary view automatically restores all dates.
- Added a visible “Show all dates” action and selected-date heading to filtered Timeline views.

## [1.10.0] - 2026-08-25

### Added

- Populated calendar days now open the Timeline filtered to every entry recorded on that exact date.
- Calendar-to-timeline navigation stores the selected date in the URL so the filtered day can be bookmarked or reloaded.

## [1.9.13] - 2026-08-25

### Fixed

- Moved the private-entry lock indicator to immediately after the Delete action.

## [1.9.12] - 2026-08-25

### Changed

- Replaced the “PRIVATE” entry metadata text with a compact lock indicator beside the Delete action.

## [1.9.11] - 2026-08-25

### Fixed

- Added matching hover and pressed feedback to Take Photo so it behaves consistently with Record Voice.

## [1.9.10] - 2026-08-25

### Fixed

- Stopped the Bold toolbar button from appearing selected while hovering the entry editor by separating the editor controls from an invalid shared label relationship.

## [1.9.9] - 2026-08-25

### Changed

- Removed collaboration-role suffixes such as “owner” from journal names in the entry composer.

## [1.9.8] - 2026-08-25

### Changed

- Removed the Mood field, visible coordinate inputs, and manual weather-loading control from the entry composer.
- Kept map coordinates internal so location search and mapped entries continue to work without exposing technical fields.

## [1.9.7] - 2026-08-25

### Fixed

- Matched the Take Photo and Record Voice composer controls to the same width and height in normal, disabled, and recording states.

## [1.9.6] - 2026-08-25

### Changed

- Removed the template-button and rotating-prompt writing aids from the entry composer for a cleaner editing surface.

## [1.9.5] - 2026-08-25

### Changed

- Shortened the User Settings sidebar labels by removing “preferences” from Diary, Editor, Notifications, and Privacy.

## [1.9.4] - 2026-08-25

### Changed

- Redesigned journal cards with a balanced details-and-controls layout, clearer action hierarchy, larger controls, and compact entry metadata.
- Tightened the Create Journal area and aligned it with the journal cards across desktop and mobile layouts.

## [1.9.3] - 2026-08-25

### Fixed

- Prevented the Journals settings page from rendering blank on its first visit by replacing its legacy modal lifecycle with a stable page panel and defensively handling incomplete journal records.

## [1.9.2] - 2026-08-25

### Changed

- Reworked Journal settings into clean full-width rows with separated metadata and actions, plus a labelled full-width creation area.
- Improved Journal settings alignment and responsive behaviour on narrow screens.

## [1.9.1] - 2026-08-25

### Changed

- Removed category headings from the User Settings sidebar for a cleaner uninterrupted navigation list.

## [1.9.0] - 2026-08-25

### Changed

- Replaced nested User Settings tabs with direct, grouped sidebar destinations for every profile, diary, writing, interface, notification, privacy, security, and data panel.
- Each settings subsection now has its own stable URL fragment for direct links and bookmarks.

## [1.8.1] - 2026-08-25

### Changed

- Simplified Profile settings by removing the Pronouns and Home Location fields.

## [1.8.0] - 2026-08-25

### Added

- Self-service temporary account deactivation and credential-based reactivation from the sign-in page.
- Journal ownership transfer to another active user while retaining editor access.
- Recoverable account deletion with a 30-day cancellation window and automatic removal of database records, media, and personal backup files.
- Downloadable CSV account-security activity alongside existing device-session controls.

## [1.7.0] - 2026-08-25

### Added

- Personal storage analytics with category graphs, quota progress, a largest-file browser, and exact duplicate detection.
- Safe attachment cleanup that removes selected originals and thumbnails from included object storage and every referencing entry.
- On-demand personal backup history with complete account data, readable Markdown entries, original media, and download or deletion controls.

## [1.6.0] - 2026-08-25

### Added

- Independent in-app, native browser, and verified-email notification channels with quiet hours and instant, daily, or weekly email delivery.
- Shared-entry creation/update notifications and security alerts for failed sign-ins and new devices.
- Background email delivery with retry tracking and grouped digest messages through the included SMTP service.

### Changed

- Notification event preferences now govern comments, replies, mentions, shared journal activity, and account security across enabled delivery channels.

## [1.5.0] - 2026-08-25

### Added

- Direct profile-image and diary-cover uploads to included object storage, with controlled public avatar delivery for public author pages.
- Personal tag inventory with account-wide rename, merge, and removal actions.
- Custom composer templates and prompts, scheduled browser writing prompts, and configurable weekly-entry and monthly-word goals.
- Live writing-goal progress within personal diary statistics.

### Changed

- Composer templates and random prompts now include each user's saved writing tools, and statistics isolate personal authorship within collaborative journals.

## [1.4.0] - 2026-08-25

### Added

- Optional public author pages with profile image, pronouns, biography, personal website, join date, and public entries.
- Account-wide public-link management, held-comment review and approval, and blocked-user management inside Privacy settings.
- Database-backed comment approval and mutual interaction blocking for comments, reactions, and mentions.

### Changed

- Privacy settings now control public-profile availability and whether new comments require owner approval.

## [1.3.0] - 2026-08-25

### Added

- Functional date, time, timezone, temperature, distance, week-start, map-zoom, image-quality, remembered-entry, accent-colour, diary-cover, and expanded identity preferences.
- Client-side image resizing and JPEG quality selection for new uploads while retaining an original-file option.

### Changed

- Calendar alignment, entry timestamps, weather units, single-location map zoom, composer defaults, remembered entry choices, interface accents, and masthead covers now follow each account's saved preferences.

## [1.2.0] - 2026-08-25

### Added

- Profile editing and a dedicated Privacy page for location precision, comment access, and default public-link expiry.
- Comment and reply inbox notifications that respect each recipient's saved notification preferences.

### Changed

- Consolidated User Settings into exactly seven full-page sections: Profile, Diary, Editor, Appearance, Notifications, Privacy, and Security & Data.
- Moved journals, inbox activity, sessions, exports, account lifecycle, and trash into focused sub-navigation within their related settings pages.
- Applied saved preferences to the opening diary view, entry-list size, composer journal and visibility defaults, autosave, spellcheck, interface theme/scale/density/motion, location precision, comments, and public-link expiry.

## [1.1.0] - 2026-08-25

### Added

- Account-synchronized user preferences backed by PostgreSQL and authenticated preference APIs.
- New full-page Diary, Editor, Appearance, and Notification preference sections with responsive controls and saved-state feedback.

## [1.0.6] - 2026-08-25

### Changed

- Flattened the Maintenance page into a full-width layout without the nested modal container, with tighter status, schedule, message, behavior, and action sections.

## [1.0.5] - 2026-08-25

### Changed

- Administrator account creation now uses the same focused modal as user editing for a consistent Users workflow.

## [1.0.4] - 2026-08-25

### Changed

- User editing now opens the existing administrator editor in a focused modal while preserving its established appearance and controls.

## [1.0.3] - 2026-08-25

### Changed

- Simplified Operational Alerts with a compact health strip, full-width threshold layout, evenly aligned setting cards, and a cleaner action row.

## [1.0.2] - 2026-08-25

### Changed

- Compacted the seven Admin Overview headline metrics into one complete desktop row, with balanced full-width wrapping on small screens.

## [1.0.1] - 2026-08-25

### Changed

- Reflowed Admin Overview metrics so incomplete rows expand to the available width without leaving empty colored grid cells.

## [1.0.0] - 2026-08-25

### Added

- Scheduled maintenance mode with optional immediate start/open-ended duration, visitor messaging, HTTP 503 API enforcement, automatic expiry, administrator bypass, and audit events.
- Date-ranged administrator analytics exports in spreadsheet-ready CSV and formatted PDF, with report generation audit events.
- Configurable operational alerts for memory, PostgreSQL connections, failed sign-ins, backup age/completeness, and per-user storage utilization.
- Configurable per-user storage quotas with live usage in account administration and enforcement during uploads.
- Unified administrator moderation for recent comments and public links with search, context links, removal/revocation actions, and audit events.
- Admin backup history with matched database/media status, total sizes, one-click creation, authenticated downloads, deletion, and audit events.
- Persistent administrator audit logging with actor, action, target, details, IP address, and a dedicated Admin Audit page.
- Live Admin Overview charts for 30-day content and sign-in activity, entry visibility, and top contributors using lightweight native SVG and CSS.
- Administrator Website settings for the live site name, masthead description, top notice, browser title, and footer signature.
- Full administrator account creation and editing, password resets, verification controls, guarded account deletion, and detailed host/container and PostgreSQL resource statistics.
- Expanded administration with overview metrics, searchable account management, session revocation, registration-code history and revocation, sign-in auditing, and system/storage status.
- Repository README with feature, setup, Portainer, migration, backup, configuration, and security guidance.
- Permission-checked standalone entry pages at `/entries/:id` for durable diary permalinks.
- Editable entry times, displayed alongside each diary date and backfilled from original creation timestamps for existing entries.
- Dedicated `/settings` and `/admin` pages with section navigation, replacing account and administration popups.

### Changed

- Removed the manually maintained revision label from System status to prevent stale deployment information.
- Removed the inherited modal form container from Website settings so its fields use the full page content area.
- Removed the redundant nested Identity card from the single-section Website settings page.
- Rebuilt registration administration as two clearly labeled cards for access policy and invitation-code creation.
- Added consistent pointer, hover, pressed, and keyboard-focus feedback to interactive controls and popup close buttons across the site.
- Reorganized administrator user rows into aligned account details, status controls, and grouped actions with a responsive stacked layout.
- Limited Admin Dashboard status messages to their current section and made them dismiss automatically.
- Rebuilt the Admin Dashboard as a full-page, sectioned interface matching the User Settings navigation pattern.
- Increased the complete interface scale by 10%, including typography, controls, icons, spacing, and panels.
- Flattened form panels by removing their offset 3D shadows while retaining clear borders.
- Hid the redundant Discuss link when viewing an entry's already-open discussion page.
- Renamed the user-facing application from Daymark to Daymark while preserving its existing Docker and storage identifiers.
- Replaced the oversized static hero with a compact masthead showing the live entry count, earliest recorded year, and latest entry date.
- Renamed Permalink to an icon-labeled Discuss link and embedded reactions, comments, replies, and comment creation directly beneath standalone entries.
- Removed the Latest badge and moved entry discussions from the heading actions to a dedicated control beneath each entry.
- Made diary entry titles link directly to their standalone entry pages.
- Made entry tags navigable filters that reopen the diary at the matching tag and year.
- Removed automatic tag-based Related Entry links from diary cards to reduce visual clutter; manual links and the Knowledge Graph remain available.
- Expanded entry headings into a two-column date/content layout with title and actions on top and metadata/location spanning the full row below.
- Reordered entry headings with the title first, metadata beneath it, and location aligned across the metadata row.
- Replaced the crowded seven-button view switcher with a compact View selector and separated Search, Filters, and entry count controls.
- Positioned New Entry beside User Settings in the simplified diary header.
- Opt-in live voice transcription through supported browser speech services and on-demand in-browser Tesseract OCR that inserts extracted image text into drafts.
- SSRF-protected web link metadata previews with bounded fetches, redirect validation, image cards, and privacy-enhanced YouTube/Vimeo embeds.
- OpenStreetMap/Nominatim place search, client-side photo EXIF date/GPS extraction, and date/location-specific historical or forecast weather from Open-Meteo.
- Mobile rear-camera capture, browser microphone voice-note recording, stored entry reminder times, and PWA/browser reminder notifications.
- Installable Daymark PWA with an offline application shell, locally persistent drafts, an auto-retrying offline entry outbox, app shortcuts, and operating-system text/link sharing into the composer.
- Optional browser-side AES-256-GCM entry encryption using a 310,000-round PBKDF2 passphrase key, opaque server storage, locked entry placeholders, and explicit unlock controls.
- Complete account JSON/ZIP exports spanning profile, journals, entries, revisions, collaboration, activity, security metadata, and original media, plus verified permanent account deletion.
- WebP image thumbnails with original-file links, attachment captions and removal, live upload progress, and an enforced 5 GB per-user storage quota.
- Multiple journals per account with automatic migration, entry assignment, colors, descriptions, defaults, visibility, sorting, filtering, and management.
- Expiring journal invitation links, email targeting, member management, and server-enforced owner, editor, contributor, and viewer roles.
- Entry comments and replies, emoji reactions, member mentions with an inbox, and per-journal activity history.
- Revocable public entry links with expiration, optional password protection, isolated media access grants, and view counts.
- Structured entry links and backlinks, reusable people, journal collections, and an interactive relationship graph.
- Email verification and expiring password-reset links delivered through an included persistent Mailpit SMTP inbox.
- Encrypted TOTP two-factor authentication with QR setup, login challenges, and single-use recovery codes.
- WebAuthn passkey registration, device management, and phishing-resistant passwordless login.
- Active-device management with individual/global session revocation, last-seen metadata, and successful/failed login history.
- Double-submit CSRF protection for authenticated mutations and layered rate limits for authentication, recovery, public access, uploads, and API writes.
- Administrator dashboard with site totals, open/invitation/closed registration modes, expiring multi-use codes, admin promotion, and account disabling.
- Markdown authoring and safe rendering with a formatting toolbar, checklists, and live preview.
- Locally autosaved and recovered entry drafts, word and character counts, full-screen writing, and keyboard shortcuts.
- Reusable reflection, gratitude, travel, and project templates with rotating writing prompts.
- Calendar, compact timeline, mixed-media gallery, and interactive global OpenStreetMap discovery views.
- Indexed PostgreSQL full-text search with date, mood, visibility, media, location, ownership, and tag filters.
- Tag-ranked related entries, random archive discovery, and date-matched “On this day” memories.
- Writing statistics with word, entry, attachment, and topic totals, monthly activity, and current/longest streaks.
- MinIO object storage for new media attachments, with authenticated media delivery and 50 MB per-file uploads.
- Recoverable entry deletion with an owner-only trash, restore, and permanent-delete workflow.
- Automatic revision snapshots before entry edits.
- Owner-only revision history browser with one-click restoration and preservation of the replaced version.
- Included daily PostgreSQL and MinIO media backups with 14-day retention and persistent backup storage.
- Whole-journal JSON, printable PDF, and Markdown/media ZIP exports plus validated JSON import.
- Initial multi-user chronological diary application.
- PostgreSQL persistence with automatic migrations.
- Secure cookie sessions and password hashing.
- Private and shared entries.
- Mixed-media attachments, maps, moods, tags, pinning, search, and archives.
- Owner-only entry editing.

### Fixed

- Prevented shared-network database DNS collisions.
- Normalized PostgreSQL dates to ISO format.
- Replaced placeholder archive navigation with working year and month navigation.
