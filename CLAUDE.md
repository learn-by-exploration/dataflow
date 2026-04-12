# DataFlow — Claude Code Configuration

> **Last updated:** 7 April 2026 · **Version:** 0.3.1
> **Metrics:** 1331 tests | 61 test files | 21 DB tables | ~13100 LOC

## Project Overview

Secure, self-hosted family data vault — web application.
Store passwords, IDs, documents, medical records, financial info, emergency contacts, addresses, and arbitrary structured data with per-member access control and AES-256-GCM encryption at rest.
Multi-user Express.js backend + vanilla JS SPA frontend. SQLite via better-sqlite3.
Includes authentication, RBAC, item-level encryption, family sharing, emergency access, audit trail, and service worker.

**Core hierarchy:** Family (Vault) → Member → Category → Item → Field/Attachment

> **Shared standards** (git workflow, security rules, testing strategy, backend service architecture,
> error handling, anti-patterns, documentation requirements) are in the parent repo's `CLAUDE.md`.
> All standards defined there apply here. This file covers DataFlow-specific structure and conventions only.

## Quick Start

```bash
npm install
node src/server.js          # http://localhost:3460
npm test                    # via node:test
# or with Docker:
docker compose up --build -d
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3460` | Server port |
| `DB_DIR` | Project root | Directory for `dataflow.db` |
| `NODE_ENV` | `development` | Environment (development/production/test) |
| `LOG_LEVEL` | `info` | Pino log level (silent/error/warn/info/debug) |
| `RATE_LIMIT_MAX` | `200` | Max requests per window |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Graceful shutdown timeout |
| `AUTO_LOCK_MINUTES` | `5` | Vault auto-lock timeout |
| `MAX_ATTACHMENT_SIZE` | `10485760` | Max attachment size in bytes (10 MB) |
| `ARGON2_MEMORY` | `65536` | Argon2id memory cost in KiB (64 MiB) |
| `ARGON2_TIME` | `3` | Argon2id time cost (iterations) |
| `ARGON2_PARALLELISM` | `1` | Argon2id parallelism |
| `AUDIT_RETENTION_DAYS` | `90` | Auto-delete audit logs older than N days |
| `LOG_DIR` | `logs/` | Log file directory |
| `LOG_MAX_FILES` | `7` | Max log files to retain |
| `DB_MAINTENANCE_ENABLED` | `true` | Enable DB maintenance (VACUUM, ANALYZE) |

See `.env.example` for all variables.

## Architecture

**Backend:**
```
src/
  server.js           — Express app entry, middleware, graceful shutdown
  config.js           — Centralized config (dotenv, Object.freeze)
  logger.js           — Pino structured logging
  errors.js           — AppError classes (NotFoundError, ValidationError, etc.)
  helpers.js          — Shared utilities
  scheduler.js        — Background job scheduler (session cleanup, auto-backup)
  db/
    index.js          — SQLite schema, tables, inline migrations, integrity check
    migrate.js        — SQL migration runner (_migrations table)
    seed.js           — Built-in record types (14 templates)
    migrations/       — Versioned SQL migration files
  routes/
    auth.js           — Register, login, logout, session, change password, recovery codes
    categories.js     — Category CRUD, reorder
    record-types.js   — Record type CRUD, field management
    items.js          — Item CRUD, bulk ops, search, filtering, trash, favorites, history, merge
    attachments.js    — File upload/download/delete (encrypted)
    tags.js           — Tag CRUD, usage
    members.js        — Member invitation, roles, profile, deactivation, unlock
    sharing.js        — Item/category sharing, permissions, revocation, expiry
    share-links.js    — Secure share links (token-based, passphrase, one-time)
    emergency.js      — Emergency access request/approve/reject
    audit.js          — Audit log listing, filters
    stats.js          — Dashboard, security health, analytics, activity feed, metrics
    security.js       — HIBP breach check, TOTP, reused passwords
    templates.js      — User-defined item templates
    data.js           — Export (JSON/CSV/PDF), import, backup, verification
    settings.js       — User preferences
    health.js         — Health check endpoint (basic + detailed)
  middleware/
    auth.js           — Session-based authentication guard
    rbac.js           — Role-based access control (admin/adult/child/guest)
    csrf.js           — CSRF token middleware
    errors.js         — Global error handler (AppError)
    validate.js       — Zod validation middleware
    request-logger.js — HTTP request logging
  schemas/
    common.schema.js  — Shared validators (positiveInt, idParam)
    auth.schema.js    — Auth schemas (register, login)
    category.schema.js
    record-type.schema.js
    item.schema.js
    tag.schema.js
    member.schema.js
    sharing.schema.js
  repositories/
    category.repository.js
    record-type.repository.js
    item.repository.js
    item-field.repository.js
    attachment.repository.js
    tag.repository.js
    member.repository.js
    sharing.repository.js
    emergency.repository.js
    audit.repository.js
    stats.repository.js
  services/
    encryption.js     — AES-256-GCM encrypt/decrypt, Argon2id key derivation, key wrapping
    session-vault.js  — In-memory vault key store per session, auto-lock
    audit.js          — Audit logging for all mutations
    backup.js         — Auto-backup, restore, data watermark, integrity verification
    category.service.js
    record-type.service.js
    item.service.js   — Encrypt/decrypt fields, soft-delete, copy, merge, duplicate detection
    attachment.service.js — File encryption/decryption
    search.js         — In-memory encrypted search index
    search.service.js — FTS5 search, fuzzy search (Levenshtein), highlighting
    export.service.js — CSV/JSON export with filtering
    password-generator.js — Random password + passphrase generation
    password-strength.js — zxcvbn-like scoring (0-4)
    breach.service.js — HIBP API proxy with k-anonymity + caching
    totp.service.js   — RFC 6238 TOTP generation, otpauth:// parsing
    security.service.js — Security score, reused password detection, vault health
    recovery.service.js — Recovery codes lifecycle (generate/use/status)
    history.service.js — Item version history tracking
    template.service.js — User-defined templates
    share-link.service.js — Secure share links with tokens
    emergency.service.js
    importers/
      bitwarden.js    — Bitwarden JSON import
      onepassword.js  — 1Password CSV import
      keepass.js      — KeePass XML import
      lastpass.js     — LastPass CSV import
      chrome.js       — Chrome CSV import
```

**Frontend:**
```
public/
  app.js              — Main SPA: all views, routing, state management
  styles.css          — All styles, responsive breakpoints, themes
  index.html          — SPA shell, overlays, modals
  sw.js               — Service Worker: network-first caching
  store.js            — Offline state store
  login.html          — Auth login page
  landing.html        — Marketing landing page
  landing.css         — Landing page styles
  manifest.json       — PWA manifest
  js/
    api.js            — API client with CSRF, auth redirect, error handling
    utils.js          — Pure utilities (esc, escA, formatDate, etc.)
```

**Stack:** Node.js 22, Express 5, better-sqlite3 (WAL mode, foreign keys ON), bcryptjs, argon2, helmet, cors, dotenv, pino, zod, uuid, vanilla JS, Inter font, Material Icons Round

**No build step.** Edit files, restart server (`node src/server.js`), hard-refresh browser (`Ctrl+Shift+R`).

## Database Schema

### Auth
```
users              (id, email, password_hash, display_name, role[admin|adult|child|guest],
                    master_key_salt, master_key_params JSON, vault_key_encrypted,
                    created_at, updated_at)
sessions           (sid PK, user_id→users, expires_at, created_at)
login_attempts     (email PK, attempts, first_attempt_at, locked_until)
settings           (user_id, key, value)
```

### Vault Structure
```
categories         (id, user_id→users, name, icon, color, position, created_at)
record_types       (id, user_id→users, name, icon, description, is_builtin, created_at)
record_type_fields (id, record_type_id→record_types, name, field_type[text|password|date|
                    number|phone|email|url|select|textarea|file|hidden|toggle],
                    options JSON, position, required)
```

### Items
```
items              (id, user_id→users, category_id→categories, record_type_id→record_types,
                    title_encrypted, title_iv, title_tag,
                    notes_encrypted, notes_iv, notes_tag,
                    favorite, position, deleted_at, created_at, updated_at)
item_fields        (id, item_id→items, field_def_id→record_type_fields,
                    value_encrypted, value_iv, value_tag,
                    strength_score, password_last_changed, created_at)
item_attachments   (id, item_id→items, user_id→users, filename, original_name,
                    mime_type, size_bytes, encryption_iv, encryption_tag, created_at)
tags               (id, user_id→users, name, color)
item_tags          (item_id→items, tag_id→tags)
```

### Sharing
```
item_shares        (id, item_id→items, shared_by→users, shared_with→users,
                    permission[read|write], expires_at, created_at)
category_shares    (id, category_id→categories, shared_by→users, shared_with→users,
                    permission[read|write], expires_at, created_at)
share_links        (id, item_id→items, user_id→users, token, passphrase_hash,
                    expires_at, one_time, used_at, created_at)
```

### History & Templates
```
item_history       (id, item_id→items, field_name, old_value, new_value,
                    changed_by→users, changed_at)
item_templates     (id, user_id→users, name, record_type_id, default_fields JSON, created_at)
recovery_codes     (id, user_id→users, code_hash, used_at, created_at)
```

### Emergency & Audit
```
emergency_access   (id, grantor_id→users, grantee_id→users, status[pending|approved|rejected|expired],
                    wait_days, requested_at, approved_at, expires_at)
audit_log          (id, user_id→users[SET NULL], action, resource, resource_id,
                    ip, ua, detail, created_at)
_migrations        (name PK, applied_at)
```

All foreign keys use `ON DELETE CASCADE` except: `audit_log.user_id` (SET NULL — preserves audit records).

## API Routes

| Module | Prefix | Routes | Covers |
|--------|--------|--------|--------|
| `auth.js` | `/api/auth` | ~12 | Register, login, logout, session, change password, recovery codes, key rotation |
| `categories.js` | `/api/categories` | ~8 | Category CRUD, reorder |
| `record-types.js` | `/api/record-types` | ~10 | Record type CRUD, field management, built-in listing |
| `items.js` | `/api/items` | ~22 | Item CRUD, search, filter, bulk ops, trash, favorites, history, copy, merge |
| `attachments.js` | `/api/attachments` | ~5 | Upload, download, delete (encrypted) |
| `tags.js` | `/api/tags` | ~6 | Tag CRUD, usage stats |
| `members.js` | `/api/members` | ~9 | Invite, roles, profile, deactivate, unlock |
| `sharing.js` | `/api/sharing` | ~8 | Share/unshare items & categories, list shared, expiry |
| `share-links.js` | `/api/share-links` | ~3 | Create, resolve secure share links |
| `emergency.js` | `/api/emergency` | ~5 | Request, approve, reject, status |
| `audit.js` | `/api/audit` | ~3 | List, filter, export |
| `security.js` | `/api/security` | ~4 | HIBP breach check, TOTP verify/generate, reused passwords |
| `stats.js` | `/api/stats` | ~8 | Dashboard, security health, score, analytics, activity feed, metrics |
| `templates.js` | `/api/templates` | ~4 | Template CRUD |
| `data.js` | `/api/data` | ~10 | Export (JSON/CSV/PDF), import (5 formats), backup, verify |
| `settings.js` | `/api/settings` | ~3 | User preferences |
| `health.js` | `/api/health` | 1 | Health check (basic + detailed) |

## Frontend Views

| Key | View | Description |
|-----|------|-------------|
| `1` | Dashboard | Vault summary, security score, password health, breach alerts |
| `2` | Vault | All items grid/list, category sidebar, search, advanced filters |
| — | Category | Items within a category, record type badges |
| — | Item Detail | Fields (masked passwords), copy, attachments, history, TOTP |
| — | Item Editor | Dynamic form, attachments upload, drag-and-drop |
| `3` | Members | Member list, invite, role badges, emergency access, unlock |
| `4` | Audit Log | Sortable table, filters (user, action, date) |
| — | Shared | Shared by me / Shared with me tabs |
| — | Trash | Soft-deleted items, restore, empty trash |
| — | Analytics | Category charts, item trends, activity stats, top tags |
| — | Activity | Family activity feed, member filter, auto-refresh |
| — | Settings | Tabs: General, Appearance, Security, Data, Templates |
| — | Record Types | Type manager, field editor, create custom |
| — | Password Gen | Length slider, char sets, passphrase, entropy display |
| — | Onboarding | First-run tour: create category → add item → explore |
| — | Lock Screen | Auto-lock overlay, re-enter master password |
| — | Login | Auth login page |
| — | Landing | Marketing landing page |

**Shortcuts:** `N` new item, `/` search, `?` help, `Esc` close, `L` lock vault

## Features Inventory

### Core
- Family vault hierarchy: Member → Category → Item → Field/Attachment
- Multi-user authentication (bcrypt sessions, CSRF, rate limiting, lockout)
- Role-based access control (admin/adult/child/guest)
- 14 built-in record types (Login, Identity, Credit Card, Bank Account, Address, Emergency Contact, Medical, Vehicle, WiFi, Software License, Secure Note, Key-Value, Document, Subscription)
- Custom record types with arbitrary typed fields
- Service Worker with network-first caching
- PWA manifest
- Dark/light theme + auto-detect

### Encryption
- AES-256-GCM per-item encryption with unique IVs
- Argon2id key derivation (64 MiB, 3 iterations)
- Vault key wrapping (encrypted master key per user)
- File attachment encryption (AES-256-GCM)
- Client-side encryption module (WebCrypto, PBKDF2)
- Key rotation (re-encrypt all items with new vault key)
- Encryption health check (server vs client mode)
- Memory safety (buffer zeroing)
- Auto-lock (configurable timeout, clears vault key from memory)

### Family & Sharing
- Per-item sharing with specific members
- Per-category sharing
- Read-only vs read-write permissions
- Expiring shares (1h, 1d, 7d, 30d, custom)
- Secure share links (token-based, optional passphrase, one-time use)
- "Share with all adults" convenience
- Admin can view all items (emergency override)
- Emergency access with configurable wait period (1–30 days)

### Security
- OWASP Top 10 coverage
- No plaintext sensitive data in database
- Clipboard auto-clear (30 seconds)
- Password generator (random + passphrase + entropy)
- Password strength indicator (zxcvbn-like scoring 0-4)
- HIBP breach check (k-anonymity, 5-char hash prefix)
- Breach monitoring alerts on vault unlock
- Password health dashboard (weak, reused, old, breached)
- Security score (0-100, composite metric)
- TOTP code generator (RFC 6238)
- Recovery codes (10 one-time codes)
- Reused password detection
- Password age tracking
- Progressive account lockout
- Session management (view, revoke, revoke all)
- Helmet CSP, HSTS, X-Frame-Options, Permissions-Policy, COOP
- Per-route rate limiting
- Constant-time comparison for auth

### Data
- Import: Bitwarden JSON, 1Password CSV, KeePass XML, LastPass CSV, Chrome CSV
- Export: JSON, CSV, PDF (print-friendly)
- Import/export wizard UI with preview
- FTS5 full-text search with fuzzy matching
- Advanced filtering (category, tags, date, strength, favorites, attachments)
- Search highlighting
- Auto-backup with SHA-256 integrity verification
- Data watermark (detect >50% loss, auto-restore)

### UX
- Trash / soft delete (30-day recovery)
- Favorites with sort priority
- Item version history with timeline
- Duplicate detection on save
- Copy/duplicate items
- Bulk operations (edit, move, delete, tag)
- User-defined templates (save as / create from)
- Merge duplicates wizard
- Onboarding tour for first-time users
- Theme persistence (dark/light/auto)
- Vault analytics dashboard (charts, trends)
- Family activity feed (filterable, auto-refresh)
- Loading skeletons and error boundaries
- WCAG 2.1 AA accessibility (ARIA, focus trap, keyboard nav, screen reader)
- Responsive mobile layout (touch targets ≥ 44px)
- Offline indicator with mutation queue
- Stackable toast notifications with undo actions
- One-click copy for all fields
- Password visibility toggle
- Keyboard shortcuts: `N` new, `/` search, `?` help, `Esc` close, `L` lock

### Infrastructure
- GitHub Actions CI (lint, test, security audit)
- Database indexes (compound, partial)
- DB maintenance scheduler (optimize, checkpoint, integrity)
- Prometheus metrics endpoint
- OpenAPI spec with validation tests
- File-based log rotation
- Docker multi-stage build (node:22-alpine)
- Enhanced health check (basic + detailed)
- E2E integration test flows

## Key Patterns

- **Same patterns as LifeFlow/PersonalFi:** AppError hierarchy, Pino logging, Zod validation, session auth, repository→service→route layering, prepared statements, test helpers
- `esc(s)` — HTML entity escaping for user content in templates
- All state is top-level `let` variables: `categories`, `items`, `currentView`, etc.
- Full DOM re-render on state change via `render()` → view-specific async functions
- Express 5 wildcard: `app.get('/{*splat}', ...)` for SPA fallback
- Session-based auth: `requireAuth` + `requireRole` middleware on all `/api/*` routes
- Vault key held in server memory per-session, never persisted to disk
- All encrypted fields stored as three columns: `*_encrypted`, `*_iv`, `*_tag`

## Testing

```bash
npm test                    # Run all tests
npm run test:security       # Security-focused tests
npm run test:fast           # Skip performance tests
```

**Runner:** `node --test --test-force-exit` with `node:assert/strict` + `supertest`

**Test categories:**

| Category | Files | Description |
|----------|-------|-------------|
| Core | db, encryption, auth, csrf | Schema, encryption round-trip, auth flow |
| CRUD | categories, record-types, items, tags, attachments | Entity lifecycle, validation |
| Family | members, rbac, sharing, emergency | Roles, permissions, sharing |
| Security | security, sql-safety, xss, idor, session-security, encryption-audit | OWASP coverage |
| Batch 2 | batch2-security | Session management, lockout, headers, rate limits |
| Batch 3 | batch3-encryption, client-crypto | Client-side crypto, key rotation, migration |
| Batch 4 | batch4-ui | Share UI, emergency UI, attachments UI, category editor |
| Batch 5 | batch5-intelligence | HIBP, TOTP, password health, recovery codes |
| Batch 6 | batch6-ux | Soft delete, favorites, history, duplicates, templates |
| Batch 7 | batch7-search | FTS5, fuzzy, filters, CSV export, search highlighting |
| Batch 8 | batch8-polish | ARIA, a11y, toasts, focus trap, offline, error boundaries |
| Batch 9 | batch9-infra, openapi, e2e-flows | Indexes, metrics, health, CI, backup verification |
| Batch 10 | batch10-power | Bulk ops, share links, analytics, templates, merge, activity |
| Import/Export | import-*, data, backup | Import formats, export, backup |
| Integration | multi-user, concurrency, performance | Cross-cutting |
| Frontend | frontend-validation, a11y, mobile-responsive | UI validation |
| E2E | e2e-smoke, e2e-flows, release-hygiene | Smoke tests, user journeys, version checks |

**Isolation:** Each test file uses temp DB via `DB_DIR` env var, `cleanDb()` in `beforeEach`, factories: `makeCategory()`, `makeRecordType()`, `makeItem()`, `makeTag()`, `makeMember()`, `shareItem()`, `getVaultKey()`.

## Documentation

### Key docs
- `docs/openapi.yaml` — OpenAPI 3.0.3 spec
- `docs/design/NICHE-PROBLEM-REQUIREMENTS.md` — Problem statement, requirements, competitive analysis
- `docs/design/IMPLEMENTATION-PLAN.md` — 6-phase build plan with test targets

## Documentation Update Requirements

**After every code change, update these docs as applicable:**

| Change Type | Must Update |
|-------------|------------|
| New/changed API endpoint | `docs/openapi.yaml` |
| New DB table or column | CLAUDE.md § Database Schema |
| New frontend view | CLAUDE.md § Frontend Views |
| New feature shipped | CLAUDE.md § Features Inventory, CHANGELOG.md |
| New test file or 50+ tests added | CLAUDE.md § Testing metrics |
| Architecture change | CLAUDE.md § Architecture |
| Breaking change | CHANGELOG.md with migration notes |
| Version bump | CLAUDE.md header, `package.json`, `docs/openapi.yaml` |

**Update the CLAUDE.md header line counts** when LOC changes significantly (>5%):
- **Current:** 1331 tests | 61 test files | 21 tables | ~13100 LOC

## Roadmap

See `docs/design/IMPLEMENTATION-PLAN.md` for the full 6-phase plan.

| Phase | Name | Status |
|---|---|---|
| 1 | Foundation (scaffold, DB, auth, encryption) | Not started |
| 2 | Vault Core (categories, items, fields, record types) | Not started |
| 3 | Family & Sharing (members, RBAC, sharing, audit) | Not started |
| 4 | Frontend Shell (SPA, all views, themes) | Not started |
| 5 | Advanced Features (import/export, search, password gen) | Not started |
| 6 | Polish & Hardening (security audit, performance, Docker, docs) | Not started |

## Rules

- ALWAYS read a file before editing it
- ALWAYS update documentation after code changes (see Documentation Update Requirements above)
- After changing backend files, restart: `pkill -f "node src/server" && node src/server.js &`
- After changing frontend files, hard-refresh browser (`Ctrl+Shift+R`) — browser caches aggressively
- Express route order matters: static routes MUST come before parameterized routes
- SQLite WAL files (`.db-shm`, `.db-wal`) and `backups/` are gitignored
- No build step, no bundler, no framework — edit and reload
- `position` column exists on categories, items, record_type_fields for ordering
- All API routes require authentication (session-based) except `/api/auth/*` and `/api/health`
- **NEVER log encryption keys, vault keys, or master passwords**
- **NEVER store plaintext sensitive data** — all item fields are encrypted with AES-256-GCM
- Encrypted fields use three-column pattern: `{field}_encrypted`, `{field}_iv`, `{field}_tag`
- Vault key is held in server memory per-session and cleared on logout/timeout
- First registered user automatically becomes admin
- Built-in record types cannot be deleted (only custom types can)
