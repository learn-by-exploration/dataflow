# Changelog

All notable changes to DataFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
