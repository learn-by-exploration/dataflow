# Changelog

All notable changes to DataFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-04-06

### Added — Batch 2: Security Hardening
- Session management API (view/revoke active sessions)
- Progressive account lockout (5→5min, 10→15min, 15+→1hr)
- Admin account unlock endpoint
- Permissions-Policy, COOP headers
- Per-route rate limiting (auth: 10/min, write: 30/min, read: 100/min)
- Input sanitization (null byte rejection, NFC normalization)
- Audit log retention with configurable days (default 90)
- CSP violation reporting endpoint
- Password change UI with strength indicator

### Added — Batch 3: Client-Side Encryption
- Client-side AES-256-GCM crypto module (public/js/crypto.js)
- WebCrypto key derivation (PBKDF2, 600K iterations)
- Key wrapping for vault key storage
- Encryption mode (server/client) per user
- Vault key rotation (re-encrypt all items)
- Encryption health check endpoint
- Data migration pathway (server→client encryption)

### Added — Batch 4: Missing Critical UIs
- Share item/category UI with member picker and permission select
- Manage shares view (shared by me / shared with me tabs)
- Emergency access request, management, and configuration UIs
- Attachment upload with drag-and-drop in item editor
- Attachment preview/download with type icons
- Category editor UI (create, edit, delete, color picker)
- Member profile edit modal

### Added — Batch 5: Vault Intelligence
- HIBP breach check with k-anonymity (5-char hash prefix)
- Password health dashboard (weak, reused, old, breached counts)
- Password strength scoring (zxcvbn-like, 0-4 scale)
- TOTP code generator (RFC 6238, 6-digit, 30s period)
- Security score calculator (0-100 composite metric)
- Vault health report with recommendations
- Breach monitoring alerts on vault unlock
- Password age tracking per field
- Reused password detection
- Recovery codes (10 one-time alphanumeric codes)

### Added — Batch 6: UX Completeness
- Trash / soft delete with 30-day recovery
- Restore from trash UI with countdown
- Empty trash with confirmation
- Favorites toggle (star icon, sort first)
- Theme persistence to backend
- Item version history with timeline
- Duplicate detection on item save
- Copy/duplicate items with new encryption IVs
- Bulk tag management (add/remove across selected items)
- Onboarding tour for first-time users

### Added — Batch 7: Search & Data
- FTS5 full-text search index
- Fuzzy search with Levenshtein distance
- Advanced filter UI (category, tags, date range, strength, favorites, attachments)
- Search result highlighting with XSS-safe markup
- Export wizard (JSON/CSV/PDF, scope selection, preview)
- Import wizard (file upload, auto-detect, preview, category mapping)
- CSV export with proper escaping
- PDF export via print-friendly HTML
- Print view with @media print stylesheet
- Bulk export selected items

### Added — Batch 8: Polish & Accessibility
- Loading state skeletons with pulse animation
- Error boundaries with recovery UI
- WCAG 2.1 AA color contrast compliance
- ARIA labels, roles, and landmarks
- Screen reader announcements (aria-live region)
- Keyboard navigation with visible focus indicators
- Skip to content link
- Focus trap for all modals (Tab cycling, Escape close)
- Mobile responsive polish (hamburger menu, touch targets)
- Offline indicator with mutation queue
- Stackable toast notifications with action buttons

### Added — Batch 9: Infrastructure
- GitHub Actions CI workflow (ci.yml)
- Database indexes (compound, partial for common queries)
- DB maintenance scheduler (daily optimize, weekly checkpoint, startup integrity)
- Backup integrity verification with SHA-256 checksums
- Prometheus metrics endpoint (/api/metrics)
- OpenAPI 3.0.3 spec (docs/openapi.yaml) with validation tests
- File-based log rotation (daily, max 7 files)
- Docker multi-stage build optimization (node:22-alpine)
- Enhanced health check (basic + detailed with DB stats)
- E2E integration test flows (full user journeys)

### Added — Batch 10: Power Features
- Bulk edit items (change category, record type)
- Bulk move items to category
- Bulk delete items (soft delete)
- Expiring shares (1h, 1d, 7d, 30d, custom)
- Secure share links (token, passphrase, one-time use, expiry)
- Vault analytics dashboard (CSS charts, trends, top tags)
- Enhanced field types (date picker, phone, URL, email, select)
- User-defined templates (save as / create from)
- Merge duplicates wizard (side-by-side, per-field selection)
- Family activity feed (filterable, auto-refresh)

### Changed
- Test suite: 838 → 1,287 tests across 60 test files
- LOC: ~7,600 → ~13,000
- DB tables: 17 → 21 (+ item_history, item_templates, recovery_codes, share_links)
- DB migrations: 2 → 13

## [0.2.0] — 2026-04-06

### Changed

- **Architecture:** Complete service-layer refactoring — zero `db.prepare()` calls remain in routes or middleware. All data access flows through repositories, all business logic through services.
- **File encryption:** Switched from synchronous `readFileSync` to streaming encryption/decryption for attachments (handles large files without loading entirely into memory)
- **Shared items:** GET /api/items/:id now decrypts shared items using owner's vault key when available; returns `{ encrypted: true }` when owner is offline
- **Title sorting:** Items sorted by title now use HMAC-SHA256 sort key instead of sorting encrypted ciphertext
- **Logout:** Now clears ALL vault keys for the user (prevents orphaned session vault entries)
- **Session vault:** `setVaultKey()` now clones the buffer to prevent callers from zeroing the stored copy

### Added

- `src/repositories/auth.repository.js` — user CRUD, login attempts
- `src/repositories/session.repository.js` — session CRUD
- `src/repositories/member.repository.js` — member management
- `src/repositories/settings.repository.js` — user settings (with `findByKey`)
- `src/services/auth.service.js` — register, login, logout, session, password change
- `src/services/member.service.js` — invite, update, activate, deactivate, delete
- `src/services/settings.service.js` — settings CRUD wrapper
- `computeSortKey()` — HMAC-SHA256 helper for deterministic encrypted title ordering
- `clearByUserId()` — session vault method to clear all sessions for a user
- Column whitelist enforcement in `member.repository.update()` and `item.repository.updatePartial()`
- Migration 002: `title_sort_key` column on items table
- 68 new tests (auth service, member service, settings service, session repo, streaming encryption, CSRF, sharing, title sort)
- CSRF test documenting intentional non-HttpOnly cookie (double-submit pattern)

### Fixed

- Vault key buffer-zeroing after registration no longer destroys the live copy in session vault
- Dynamic SQL column names now validated against whitelists in all repositories

### Security

- Auth rate limiter on login/register/change-password (10 req / 15 min) — from v0.1.0 security fixes
- Content-Disposition filename sanitization — from v0.1.0 security fixes
- Attachment IDOR prevention with user_id ownership checks — from v0.1.0 security fixes

## [0.1.0] — 2026-04-06

### Added

- Core vault with AES-256-GCM encryption and Argon2id key derivation
- User registration and login with bcrypt password hashing
- Cookie-based session management with HttpOnly, SameSite flags
- Role-based access control (admin, adult, child, guest)
- Categories with CRUD, reordering, and icons
- Record types with customizable field definitions
- Items with encrypted title, notes, and fields
- Tags system with color support and item tagging
- Item sharing between users (read/write permissions)
- Category sharing between users
- Item attachments with encrypted file storage
- Data export (full vault JSON)
- Data import from Bitwarden, Chrome, LastPass, 1Password, KeePass
- Password generator with customizable options
- Dashboard statistics
- Audit logging for all user actions
- Emergency access management
- Family member invitation and management
- User settings (per-user key-value store)
- Automatic database backups with retention
- CSRF protection with double-submit cookie pattern
- Helmet security headers (CSP, HSTS, X-Frame-Options, etc.)
- CORS configuration
- Rate limiting
- Input validation with Zod schemas
- WAL mode SQLite for concurrent access
- Health check endpoint
- SPA frontend shell with vanilla JS
- Docker and Docker Compose deployment
- Comprehensive test suite (750+ tests)
