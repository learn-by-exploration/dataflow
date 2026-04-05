# DataFlow — Implementation Plan

> **Status:** Active
> **Created:** 5 April 2026
> **Baseline:** v0.1.0 — greenfield
> **Reference:** [NICHE-PROBLEM-REQUIREMENTS.md](NICHE-PROBLEM-REQUIREMENTS.md)

---

## Implementation Philosophy

- **TDD-first** — Write failing tests before implementation code
- **Security-first** — Encryption and auth are Phase 1, not afterthoughts
- **Incremental delivery** — Each phase produces a working, testable system
- **Port proven patterns** — Reuse LifeFlow/PersonalFi middleware, error handling, test helpers, auth flow
- **No over-engineering** — YAGNI; build what's needed per phase

---

## Phase Overview

| Phase | Name | Scope | Est. Tests | Priority |
|---|---|---|---|---|
| **1** | Foundation | Project scaffold, DB, auth, encryption core | ~150 | P0 |
| **2** | Vault Core | Categories, items, fields, record types, CRUD | ~300 | P0 |
| **3** | Family & Sharing | Members, roles, RBAC, sharing, audit | ~250 | P0 |
| **4** | Frontend Shell | SPA shell, views, routing, all UI | ~150 | P0 |
| **5** | Advanced Features | Import/export, search, emergency access, password generator | ~200 | P1 |
| **6** | Polish & Hardening | Security audit, performance, Docker, documentation | ~150 | P1 |
| | **Total** | | **~1,200** | |

---

## Phase 1: Foundation

> **Goal:** Working server with auth, encryption, and test infrastructure.

### 1.1 Project Scaffold

| # | Task | Backend | Frontend | Tests | Risk |
|---|---|---|---|---|---|
| 1.1.1 | Initialize npm project, dependencies | `package.json` | — | — | Low |
| 1.1.2 | Create directory structure | `src/**` | `public/**` | `tests/` | Low |
| 1.1.3 | Port `config.js` from LifeFlow | `src/config.js` | — | config.test.js | Low |
| 1.1.4 | Port `logger.js` (Pino) | `src/logger.js` | — | — | Low |
| 1.1.5 | Port `errors.js` (AppError hierarchy) | `src/errors.js` | — | errors.test.js | Low |
| 1.1.6 | Port test helpers | — | — | `tests/helpers.js` | Low |
| 1.1.7 | Create `.env.example`, `.gitignore`, `Dockerfile`, `docker-compose.yml` | root | — | — | Low |
| 1.1.8 | Create `.github/` CI workflow (lint + test) | root | — | — | Low |

**Dependencies:**
```
express@5, better-sqlite3, bcryptjs, argon2, helmet, cors,
cookie-parser, dotenv, pino, pino-http, zod, uuid, express-rate-limit,
supertest (dev), c8 (dev), eslint (dev)
```

### 1.2 Database Schema

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 1.2.1 | Core tables: `users`, `sessions`, `settings`, `login_attempts` | `src/db/index.js` | db.test.js | Low |
| 1.2.2 | Vault tables: `categories`, `record_types`, `record_type_fields` | `src/db/index.js` | db.test.js | Low |
| 1.2.3 | Item tables: `items`, `item_fields`, `item_attachments`, `item_tags`, `tags` | `src/db/index.js` | db.test.js | Low |
| 1.2.4 | Sharing tables: `item_shares`, `category_shares` | `src/db/index.js` | db.test.js | Low |
| 1.2.5 | System tables: `audit_log`, `emergency_access`, `_migrations` | `src/db/index.js` | db.test.js | Low |
| 1.2.6 | Migration runner | `src/db/migrate.js` | migration.test.js | Low |
| 1.2.7 | Seed built-in record types (14 templates) | `src/db/seed.js` | seed.test.js | Medium |

**Schema (detailed):**
```sql
-- Auth
users (id, email, password_hash, display_name, role[admin|adult|child|guest],
       master_key_salt, master_key_params JSON, vault_key_encrypted,
       created_at, updated_at)
sessions (sid PK, user_id→users, expires_at, created_at)
login_attempts (email PK, attempts, first_attempt_at, locked_until)
settings (user_id, key, value)

-- Vault structure
categories (id, user_id→users, name, icon, color, position, created_at)
record_types (id, user_id→users, name, icon, description, is_builtin, created_at)
record_type_fields (id, record_type_id→record_types, name, field_type[text|password|date|
                    number|phone|email|url|select|textarea|file|hidden|toggle],
                    options JSON, position, required)

-- Items
items (id, user_id→users, category_id→categories, record_type_id→record_types,
       title_encrypted, title_iv, title_tag,
       notes_encrypted, notes_iv, notes_tag,
       favorite, position, created_at, updated_at)
item_fields (id, item_id→items, field_def_id→record_type_fields,
             value_encrypted, value_iv, value_tag, created_at)
item_attachments (id, item_id→items, user_id→users, filename, original_name,
                  mime_type, size_bytes, encryption_iv, encryption_tag, created_at)
tags (id, user_id→users, name, color)
item_tags (item_id→items, tag_id→tags)

-- Sharing
item_shares (id, item_id→items, shared_by→users, shared_with→users,
             permission[read|write], created_at)
category_shares (id, category_id→categories, shared_by→users, shared_with→users,
                 permission[read|write], created_at)

-- Emergency
emergency_access (id, grantor_id→users, grantee_id→users, status[pending|approved|rejected|expired],
                  wait_days, requested_at, approved_at, expires_at)

-- Audit
audit_log (id, user_id→users[SET NULL], action, resource, resource_id,
           ip, ua, detail, created_at)
_migrations (name PK, applied_at)
```

### 1.3 Encryption Service

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 1.3.1 | Encryption core: `encrypt(plaintext, key)` → `{ciphertext, iv, tag}` | `src/services/encryption.js` | encryption.test.js | **High** |
| 1.3.2 | Decryption core: `decrypt(ciphertext, iv, tag, key)` → plaintext | `src/services/encryption.js` | encryption.test.js | **High** |
| 1.3.3 | Key derivation: master password → vault key via Argon2id | `src/services/encryption.js` | encryption.test.js | **High** |
| 1.3.4 | Vault key wrapping: encrypt vault key with derived key | `src/services/encryption.js` | encryption.test.js | **High** |
| 1.3.5 | File encryption: stream-based AES-256-GCM for attachments | `src/services/encryption.js` | encryption.test.js | Medium |
| 1.3.6 | Memory safety: zero buffers after use | `src/services/encryption.js` | encryption.test.js | Medium |

**Encryption flow:**
```
Registration:
  1. Generate random 256-bit vault_key
  2. master_password → Argon2id(salt) → derived_key
  3. Encrypt vault_key with derived_key → vault_key_encrypted
  4. Store vault_key_encrypted + salt + params in users table
  5. master_password → PBKDF2(separate_salt) → auth_hash (for login)

Login:
  1. Verify auth_hash against stored hash
  2. master_password → Argon2id(salt) → derived_key
  3. Decrypt vault_key_encrypted → vault_key (held in session memory)

Item encrypt:
  1. Get vault_key from session
  2. For each field: AES-256-GCM(vault_key, random_iv) → {ciphertext, iv, tag}
  3. Store encrypted fields in DB
```

### 1.4 Authentication

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 1.4.1 | Port auth middleware from LifeFlow | `src/middleware/auth.js` | auth.test.js | Low |
| 1.4.2 | Register route (first user = admin) | `src/routes/auth.js` | auth.test.js | Low |
| 1.4.3 | Login route (rate limited, lockout) | `src/routes/auth.js` | auth.test.js | Medium |
| 1.4.4 | Logout route (session destroy) | `src/routes/auth.js` | auth.test.js | Low |
| 1.4.5 | Session management (creation, validation, expiry) | `src/routes/auth.js` | auth.test.js | Medium |
| 1.4.6 | CSRF middleware | `src/middleware/csrf.js` | csrf.test.js | Low |
| 1.4.7 | Port request-logger middleware | `src/middleware/request-logger.js` | — | Low |
| 1.4.8 | Port validation middleware (Zod) | `src/middleware/validate.js` | validate.test.js | Low |
| 1.4.9 | Port global error handler | `src/middleware/errors.js` | errors.test.js | Low |
| 1.4.10 | Vault key derivation on login (Argon2id) | `src/routes/auth.js` | auth.test.js | **High** |
| 1.4.11 | Auto-lock: clear vault key from memory on timeout | `src/services/session-vault.js` | session-vault.test.js | Medium |

### 1.5 Server Bootstrap

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 1.5.1 | Express app setup (middleware stack) | `src/server.js` | server.test.js | Low |
| 1.5.2 | Graceful shutdown handler | `src/server.js` | server.test.js | Low |
| 1.5.3 | Background scheduler (session cleanup, auto-backup) | `src/scheduler.js` | scheduler.test.js | Low |

**Phase 1 test targets:**
- `tests/db.test.js` — Schema creation, migrations, foreign keys, cascades
- `tests/encryption.test.js` — Encrypt/decrypt round-trip, key derivation, edge cases, tamper detection
- `tests/auth.test.js` — Register, login, logout, sessions, rate limiting, lockout, vault key
- `tests/csrf.test.js` — CSRF token validation
- `tests/security.test.js` — Headers (helmet), CORS, rate limits, session fixation
- `tests/errors.test.js` — Error classes, global error handler
- `tests/seed.test.js` — Built-in record types seeded correctly

**Phase 1 total: ~150 tests**

---

## Phase 2: Vault Core

> **Goal:** Full CRUD for categories, items, fields, record types, attachments, tags.

### 2.1 Repositories (Data Access Layer)

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 2.1.1 | CategoryRepository (CRUD, reorder) | `src/repositories/category.repository.js` | categories.test.js | Low |
| 2.1.2 | RecordTypeRepository (CRUD, list built-in + custom) | `src/repositories/record-type.repository.js` | record-types.test.js | Low |
| 2.1.3 | ItemRepository (CRUD, list, search, reorder) | `src/repositories/item.repository.js` | items.test.js | Medium |
| 2.1.4 | ItemFieldRepository (CRUD per item) | `src/repositories/item-field.repository.js` | items.test.js | Medium |
| 2.1.5 | AttachmentRepository (CRUD, file management) | `src/repositories/attachment.repository.js` | attachments.test.js | Medium |
| 2.1.6 | TagRepository (CRUD, link/unlink) | `src/repositories/tag.repository.js` | tags.test.js | Low |

### 2.2 Services (Business Logic)

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 2.2.1 | CategoryService (validation, position management) | `src/services/category.service.js` | categories.test.js | Low |
| 2.2.2 | RecordTypeService (validation, field type rules) | `src/services/record-type.service.js` | record-types.test.js | Medium |
| 2.2.3 | ItemService (encrypt/decrypt fields, CRUD orchestration) | `src/services/item.service.js` | items.test.js | **High** |
| 2.2.4 | AttachmentService (encrypt/decrypt files, size limits) | `src/services/attachment.service.js` | attachments.test.js | **High** |
| 2.2.5 | AuditService (log all mutations) | `src/services/audit.js` | audit.test.js | Low |
| 2.2.6 | BackupService (auto-backup, restore, watermark) | `src/services/backup.js` | backup.test.js | Medium |

### 2.3 Schemas (Zod Validation)

| # | Task | File | Risk |
|---|---|---|---|
| 2.3.1 | Common schemas (idParam, pagination, position) | `src/schemas/common.schema.js` | Low |
| 2.3.2 | Category schemas | `src/schemas/category.schema.js` | Low |
| 2.3.3 | Record type schemas (complex: field definitions) | `src/schemas/record-type.schema.js` | Medium |
| 2.3.4 | Item schemas (dynamic fields based on record type) | `src/schemas/item.schema.js` | Medium |
| 2.3.5 | Tag schemas | `src/schemas/tag.schema.js` | Low |

### 2.4 Routes

| # | Task | File | Routes | Tests | Risk |
|---|---|---|---|---|---|
| 2.4.1 | Categories CRUD + reorder | `src/routes/categories.js` | ~8 | categories.test.js | Low |
| 2.4.2 | Record types CRUD + fields management | `src/routes/record-types.js` | ~10 | record-types.test.js | Medium |
| 2.4.3 | Items CRUD + bulk operations | `src/routes/items.js` | ~15 | items.test.js | **High** |
| 2.4.4 | Item fields CRUD (within item context) | `src/routes/items.js` | (nested) | items.test.js | Medium |
| 2.4.5 | Attachments upload/download/delete | `src/routes/attachments.js` | ~5 | attachments.test.js | Medium |
| 2.4.6 | Tags CRUD + usage | `src/routes/tags.js` | ~6 | tags.test.js | Low |

**Phase 2 test targets:**
- `tests/categories.test.js` — CRUD, reorder, cascades, validation
- `tests/record-types.test.js` — Built-in types, custom types, field management, validation
- `tests/items.test.js` — CRUD with encryption, field encryption/decryption, bulk ops, filtering, sorting
- `tests/attachments.test.js` — Upload/download with encryption, size limits, mime validation
- `tests/tags.test.js` — CRUD, linking, usage counts
- `tests/audit.test.js` — All mutations logged correctly
- `tests/backup.test.js` — Backup creation, restore, watermark detection
- `tests/idor.test.js` — Users cannot access other users' items/categories

**Phase 2 total: ~300 tests**

---

## Phase 3: Family & Sharing

> **Goal:** Multi-member vaults with role-based access and sharing.

### 3.1 Member Management

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 3.1.1 | Member invitation (admin creates accounts) | `src/routes/members.js` | members.test.js | Medium |
| 3.1.2 | Role assignment (admin/adult/child/guest) | `src/routes/members.js` | members.test.js | Medium |
| 3.1.3 | Member profile (update name, change password) | `src/routes/members.js` | members.test.js | Low |
| 3.1.4 | Member deactivation (soft delete, preserve audit) | `src/routes/members.js` | members.test.js | Medium |
| 3.1.5 | RBAC middleware (role-based route guards) | `src/middleware/rbac.js` | rbac.test.js | **High** |

### 3.2 Sharing

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 3.2.1 | Share item with specific members | `src/routes/sharing.js` | sharing.test.js | **High** |
| 3.2.2 | Share category with specific members | `src/routes/sharing.js` | sharing.test.js | **High** |
| 3.2.3 | Share with role groups ("all adults") | `src/routes/sharing.js` | sharing.test.js | Medium |
| 3.2.4 | Read-only vs read-write permissions | `src/routes/sharing.js` | sharing.test.js | **High** |
| 3.2.5 | Revoke share | `src/routes/sharing.js` | sharing.test.js | Medium |
| 3.2.6 | "Shared with me" view query | `src/repositories/item.repository.js` | sharing.test.js | Medium |

### 3.3 Emergency Access

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 3.3.1 | Request emergency access | `src/routes/emergency.js` | emergency.test.js | Medium |
| 3.3.2 | Approve/reject/expire logic | `src/routes/emergency.js` | emergency.test.js | Medium |
| 3.3.3 | Wait period enforcement | `src/services/emergency.service.js` | emergency.test.js | Medium |
| 3.3.4 | Admin override (immediate access) | `src/routes/emergency.js` | emergency.test.js | Medium |

### 3.4 Audit Dashboard

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 3.4.1 | Audit log routes (list, filter, export) | `src/routes/audit.js` | audit.test.js | Low |
| 3.4.2 | Admin: view all member activity | `src/routes/audit.js` | audit.test.js | Medium |
| 3.4.3 | Member: view own activity only | `src/routes/audit.js` | audit.test.js | Low |

**Phase 3 test targets:**
- `tests/members.test.js` — Invitation, roles, profile, deactivation
- `tests/rbac.test.js` — Role enforcement on every route (admin, adult, child, guest matrix)
- `tests/sharing.test.js` — Item sharing, category sharing, permission enforcement, revocation
- `tests/idor-sharing.test.js` — Cross-user access attempts on shared items
- `tests/emergency.test.js` — Request/approve/reject/expire flow, admin override
- `tests/audit-dashboard.test.js` — Filtering, admin vs member views
- `tests/multi-user.test.js` — Multiple users interacting with shared resources

**Phase 3 total: ~250 tests**

---

## Phase 4: Frontend Shell

> **Goal:** Complete SPA with all views, responsive design, themes.

### 4.1 Shell & Navigation

| # | Task | File | Risk |
|---|---|---|---|
| 4.1.1 | SPA shell (index.html, sidebar, main content area) | `public/index.html` | Low |
| 4.1.2 | Routing (hash-based: `#dashboard`, `#vault`, `#item/123`) | `public/app.js` | Low |
| 4.1.3 | API client (CSRF, auth redirect, error handling) | `public/js/api.js` | Low |
| 4.1.4 | Utilities (esc, escA, formatDate, renderMd) | `public/js/utils.js` | Low |
| 4.1.5 | Login page | `public/login.html` | Low |
| 4.1.6 | Landing page | `public/landing.html` | Low |
| 4.1.7 | Service Worker (network-first caching) | `public/sw.js` | Low |
| 4.1.8 | PWA manifest | `public/manifest.json` | Low |
| 4.1.9 | CSS foundations (variables, layout, responsive, themes) | `public/styles.css` | Low |

### 4.2 Views

| # | Task | View | Key UI Elements | Risk |
|---|---|---|---|---|
| 4.2.1 | Dashboard | `#dashboard` | Vault summary cards, recent activity, quick actions | Medium |
| 4.2.2 | Vault (all items) | `#vault` | Item grid/list, category sidebar, search bar, filters | Medium |
| 4.2.3 | Category view | `#category/:id` | Items in category, record type badge, add item | Medium |
| 4.2.4 | Item detail | `#item/:id` | Field list (masked passwords), copy buttons, edit, attachments | **High** |
| 4.2.5 | Item editor | `#item/:id/edit` or modal | Dynamic form from record type fields, save/cancel | **High** |
| 4.2.6 | Record type manager | `#settings/types` | List types, field editor, create custom | Medium |
| 4.2.7 | Members | `#members` | Member list, invite, role badges, deactivate | Medium |
| 4.2.8 | Sharing | `#item/:id/sharing` or panel | Share targets, permission selector, revoke | Medium |
| 4.2.9 | Audit log | `#audit` | Sortable table, filters (user, action, date) | Low |
| 4.2.10 | Settings | `#settings` | Tabs: General, Appearance, Security, Data | Low |
| 4.2.11 | Password generator | modal | Length slider, char sets, passphrase mode, copy | Low |
| 4.2.12 | Onboarding wizard | modal | First-run: create admin, set master password, create categories | Medium |

### 4.3 UX Polish

| # | Task | Risk |
|---|---|---|
| 4.3.1 | Responsive mobile layout (hamburger sidebar, touch targets ≥ 44px) | Medium |
| 4.3.2 | Dark/light theme + auto-detect | Low |
| 4.3.3 | Keyboard shortcuts (N=new item, /=search, ?=help, Esc=close) | Low |
| 4.3.4 | Toast notifications (success, error, undo) | Low |
| 4.3.5 | Auto-lock timer (UI lock screen, re-enter master password) | Medium |
| 4.3.6 | Clipboard auto-clear (30s countdown badge) | Medium |
| 4.3.7 | Password visibility toggle (show/hide for password fields) | Low |
| 4.3.8 | One-click copy for all fields | Low |
| 4.3.9 | Drag-and-drop reorder (categories, items) | Medium |

**Phase 4 test targets:**
- `tests/frontend-validation.test.js` — HTML validity, CSS syntax, JS syntax
- `tests/a11y.test.js` — ARIA attributes, focus management, color contrast
- `tests/mobile-responsive.test.js` — Breakpoints, touch targets, viewport meta

**Phase 4 total: ~150 tests**

---

## Phase 5: Advanced Features

> **Goal:** Import/export, full-text search, password generator, emergency access UI.

### 5.1 Import / Export

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 5.1.1 | Export encrypted JSON backup | `src/routes/data.js` | data.test.js | Medium |
| 5.1.2 | Import encrypted JSON backup | `src/routes/data.js` | data.test.js | Medium |
| 5.1.3 | Import Bitwarden JSON | `src/services/importers/bitwarden.js` | import-bitwarden.test.js | Medium |
| 5.1.4 | Import 1Password CSV | `src/services/importers/onepassword.js` | import-1password.test.js | Medium |
| 5.1.5 | Import KeePass XML | `src/services/importers/keepass.js` | import-keepass.test.js | Medium |
| 5.1.6 | Import LastPass CSV | `src/services/importers/lastpass.js` | import-lastpass.test.js | Low |
| 5.1.7 | Import Chrome CSV | `src/services/importers/chrome.js` | import-chrome.test.js | Low |
| 5.1.8 | Export CSV (with security warning) | `src/routes/data.js` | data.test.js | Low |

### 5.2 Search

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 5.2.1 | In-memory search index (titles decrypted on unlock) | `src/services/search.js` | search.test.js | **High** |
| 5.2.2 | Search route (query, filters, pagination) | `src/routes/items.js` | search.test.js | Medium |
| 5.2.3 | Frontend search UI (Ctrl+K modal, live results) | `public/app.js` | — | Medium |

### 5.3 Password Generator

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 5.3.1 | Password generator service | `src/services/password-generator.js` | password-generator.test.js | Low |
| 5.3.2 | Passphrase generator (word list, separator, capitalize) | `src/services/password-generator.js` | password-generator.test.js | Low |
| 5.3.3 | Entropy calculation + strength indicator | `src/services/password-generator.js` | password-generator.test.js | Low |
| 5.3.4 | Frontend generator UI (modal) | `public/app.js` | — | Low |

### 5.4 Stats Dashboard

| # | Task | File | Tests | Risk |
|---|---|---|---|---|
| 5.4.1 | Vault statistics (item count by type, category breakdown) | `src/routes/stats.js` | stats.test.js | Low |
| 5.4.2 | Security health (weak passwords, reused, old, no 2FA) | `src/routes/stats.js` | stats.test.js | Medium |
| 5.4.3 | Activity timeline (chart data: creates, views, shares) | `src/routes/stats.js` | stats.test.js | Low |

**Phase 5 test targets:**
- `tests/data.test.js` — Export/import round-trip, encrypted backup integrity
- `tests/import-bitwarden.test.js` — Bitwarden JSON parsing, field mapping, edge cases
- `tests/import-1password.test.js` — 1Password CSV parsing
- `tests/import-keepass.test.js` — KeePass XML parsing
- `tests/import-lastpass.test.js` — LastPass CSV parsing
- `tests/import-chrome.test.js` — Chrome CSV parsing
- `tests/search.test.js` — Full-text search, filters, pagination, access control
- `tests/password-generator.test.js` — Randomness, constraints, passphrase, entropy
- `tests/stats.test.js` — Dashboard queries, security health scoring

**Phase 5 total: ~200 tests**

---

## Phase 6: Polish & Hardening

> **Goal:** Security audit, performance tuning, Docker, full documentation.

### 6.1 Security Hardening

| # | Task | Tests | Risk |
|---|---|---|---|
| 6.1.1 | Security test suite (OWASP Top 10 checklist) | security-audit.test.js | **High** |
| 6.1.2 | SQL injection tests (all routes) | sql-safety.test.js | Medium |
| 6.1.3 | XSS tests (stored, reflected) | xss.test.js | Medium |
| 6.1.4 | IDOR tests (all entity types, cross-user) | idor-exhaustive.test.js | **High** |
| 6.1.5 | Rate limiting verification | rate-limit.test.js | Low |
| 6.1.6 | Encryption verification (DB inspection: no plaintext) | encryption-audit.test.js | **High** |
| 6.1.7 | Session security (fixation, hijacking, timeout) | session-security.test.js | Medium |
| 6.1.8 | Password policy enforcement (zxcvbn) | password-policy.test.js | Low |

### 6.2 Performance

| # | Task | Tests | Risk |
|---|---|---|---|
| 6.2.1 | Load test (10K items, search < 200ms) | performance.test.js | Medium |
| 6.2.2 | Encryption benchmark (1K items encrypt/decrypt) | performance.test.js | Low |
| 6.2.3 | Concurrent access (5 users, no corruption) | concurrency.test.js | Medium |

### 6.3 Docker & Deployment

| # | Task | File | Risk |
|---|---|---|---|
| 6.3.1 | Multi-stage Dockerfile (node:22-slim, read-only FS) | `Dockerfile` | Low |
| 6.3.2 | docker-compose.yml with volumes for DB + backups | `docker-compose.yml` | Low |
| 6.3.3 | Health check endpoint | `src/routes/health.js` | Low |
| 6.3.4 | Startup integrity check + auto-restore | `src/db/index.js` | Medium |

### 6.4 Documentation

| # | Task | File | Risk |
|---|---|---|---|
| 6.4.1 | OpenAPI 3.0.3 spec | `docs/openapi.yaml` | Medium |
| 6.4.2 | README.md (overview, screenshots, install, usage) | `README.md` | Low |
| 6.4.3 | CONTRIBUTING.md | `CONTRIBUTING.md` | Low |
| 6.4.4 | SECURITY.md (disclosure policy) | `SECURITY.md` | Low |
| 6.4.5 | CHANGELOG.md | `CHANGELOG.md` | Low |

**Phase 6 test targets:**
- `tests/security-audit.test.js` — OWASP Top 10 systematic verification
- `tests/sql-safety.test.js` — Injection attempts on all routes
- `tests/xss.test.js` — Stored/reflected XSS attempts
- `tests/idor-exhaustive.test.js` — Cross-user access on every entity type
- `tests/encryption-audit.test.js` — Raw DB inspection to verify no plaintext
- `tests/session-security.test.js` — Fixation, hijacking, timeout
- `tests/performance.test.js` — Load tests, benchmarks
- `tests/concurrency.test.js` — Concurrent access
- `tests/e2e-smoke.test.js` — End-to-end smoke test (register → create → share → search → export)
- `tests/release-hygiene.test.js` — Version consistency, required files exist

**Phase 6 total: ~150 tests**

---

## Test Strategy

### Test Pyramid

```
        ┌─────────────┐
        │   E2E (5%)  │  e2e-smoke.test.js
        ├─────────────┤
        │Integration  │  multi-user, sharing, import/export
        │   (25%)     │
        ├─────────────┤
        │  Unit/API   │  CRUD, encryption, auth, RBAC, validation
        │   (70%)     │
        └─────────────┘
```

### Test Naming Convention

```
tests/
  helpers.js                  — Setup, factories, cleanup
  db.test.js                  — Schema, migrations, foreign keys
  encryption.test.js          — Encryption service unit tests
  auth.test.js                — Auth routes (register, login, logout)
  csrf.test.js                — CSRF protection
  categories.test.js          — Category CRUD
  record-types.test.js        — Record type CRUD + field management
  items.test.js               — Item CRUD with encryption
  attachments.test.js         — File upload/download with encryption
  tags.test.js                — Tag CRUD
  members.test.js             — Member management
  rbac.test.js                — Role-based access control matrix
  sharing.test.js             — Item/category sharing
  emergency.test.js           — Emergency access flow
  audit.test.js               — Audit logging
  search.test.js              — Full-text search
  password-generator.test.js  — Generator service
  import-bitwarden.test.js    — Bitwarden import
  import-1password.test.js    — 1Password import
  import-keepass.test.js      — KeePass import
  import-lastpass.test.js     — LastPass import
  import-chrome.test.js       — Chrome import
  data.test.js                — Export/import/backup
  stats.test.js               — Dashboard statistics
  security.test.js            — Helmet, CORS, rate limits
  security-audit.test.js      — OWASP Top 10
  sql-safety.test.js          — SQL injection
  xss.test.js                 — XSS prevention
  idor.test.js                — Authorization bypass
  idor-exhaustive.test.js     — Exhaustive IDOR checks
  session-security.test.js    — Session attacks
  encryption-audit.test.js    — No plaintext in DB
  performance.test.js         — Load + benchmark
  concurrency.test.js         — Multi-user concurrent access
  multi-user.test.js          — Multi-user integration
  frontend-validation.test.js — HTML/CSS/JS syntax
  a11y.test.js                — Accessibility
  mobile-responsive.test.js   — Responsive layout
  e2e-smoke.test.js           — End-to-end smoke
  release-hygiene.test.js     — Version + file checks
```

### Test Helpers (Port from LifeFlow)

```javascript
// tests/helpers.js
setup()           → fresh temp DB, test server, default admin user + session
cleanDb()         → delete all data in reverse-dependency order
makeCategory()    → factory for categories
makeRecordType()  → factory for record types
makeItem()        → factory for encrypted items
makeTag()         → factory for tags
makeMember()      → factory for additional users with roles
shareItem()       → factory for sharing
getVaultKey()     → derive vault key for test user (for decryption assertions)
```

### Security Testing Matrix

| Attack Vector | Test File | What We Verify |
|---|---|---|
| SQL Injection | sql-safety.test.js | All user inputs run through prepared statements |
| XSS (stored) | xss.test.js | HTML-escaped on render, CSP blocks inline scripts |
| XSS (reflected) | xss.test.js | Input sanitization on all text fields |
| CSRF | csrf.test.js | Double-submit cookie, token rotation |
| IDOR | idor.test.js | User A cannot access User B's items/categories/shares |
| Brute Force | auth.test.js | Rate limiting, account lockout after 5 attempts |
| Session Fixation | session-security.test.js | Session ID regenerated on login |
| Session Hijacking | session-security.test.js | Secure, HttpOnly, SameSite=Strict cookies |
| Privilege Escalation | rbac.test.js | Child cannot access admin routes, guest cannot write |
| Data Exposure | encryption-audit.test.js | No plaintext passwords/fields in DB |
| Path Traversal | attachments.test.js | Filename sanitization, no ../ |
| File Upload | attachments.test.js | Mime-type whitelist, size limit (10 MB) |
| DoS | rate-limit.test.js | Global + per-endpoint rate limits |
| Timing Attack | auth.test.js | Constant-time comparison for password/token checks |

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Encryption key leak in logs/errors | Critical | Low | Never log keys; zero buffers; test assertions |
| Vault key lost (user forgets password) | Critical | Medium | Emergency access, admin override, recovery documentation |
| SQLite concurrent write contention | Medium | Medium | WAL mode, retry logic, single-writer pattern |
| Argon2id too slow on low-end hardware | Low | Medium | Configurable params; fallback PBKDF2 option |
| Large attachments slow down backup | Medium | Medium | Stream-based encryption; skip files in lightweight backup |
| Browser memory exposure (vault key) | Medium | Low | Auto-lock timer; clear on tab close; no localStorage for keys |

---

## File Tree (Final)

```
dataflow/
├── CLAUDE.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── README.md
├── LICENSE
├── package.json
├── .env.example
├── .gitignore
├── .eslintrc.json
├── Dockerfile
├── docker-compose.yml
├── docs/
│   ├── openapi.yaml
│   └── design/
│       ├── INDEX.md
│       ├── NICHE-PROBLEM-REQUIREMENTS.md
│       └── IMPLEMENTATION-PLAN.md
├── scripts/
│   └── backup.sh
├── data/                        # Runtime data (gitignored)
├── backups/                     # Auto-backups (gitignored)
├── src/
│   ├── server.js
│   ├── config.js
│   ├── logger.js
│   ├── errors.js
│   ├── helpers.js
│   ├── scheduler.js
│   ├── db/
│   │   ├── index.js
│   │   ├── migrate.js
│   │   ├── seed.js
│   │   └── migrations/
│   ├── routes/
│   │   ├── auth.js
│   │   ├── categories.js
│   │   ├── record-types.js
│   │   ├── items.js
│   │   ├── attachments.js
│   │   ├── tags.js
│   │   ├── members.js
│   │   ├── sharing.js
│   │   ├── emergency.js
│   │   ├── audit.js
│   │   ├── stats.js
│   │   ├── data.js
│   │   ├── settings.js
│   │   └── health.js
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── rbac.js
│   │   ├── csrf.js
│   │   ├── errors.js
│   │   ├── validate.js
│   │   └── request-logger.js
│   ├── schemas/
│   │   ├── common.schema.js
│   │   ├── auth.schema.js
│   │   ├── category.schema.js
│   │   ├── record-type.schema.js
│   │   ├── item.schema.js
│   │   ├── tag.schema.js
│   │   ├── member.schema.js
│   │   └── sharing.schema.js
│   ├── repositories/
│   │   ├── category.repository.js
│   │   ├── record-type.repository.js
│   │   ├── item.repository.js
│   │   ├── item-field.repository.js
│   │   ├── attachment.repository.js
│   │   ├── tag.repository.js
│   │   ├── member.repository.js
│   │   ├── sharing.repository.js
│   │   ├── emergency.repository.js
│   │   ├── audit.repository.js
│   │   └── stats.repository.js
│   └── services/
│       ├── encryption.js
│       ├── session-vault.js
│       ├── audit.js
│       ├── backup.js
│       ├── category.service.js
│       ├── record-type.service.js
│       ├── item.service.js
│       ├── attachment.service.js
│       ├── search.js
│       ├── password-generator.js
│       ├── emergency.service.js
│       └── importers/
│           ├── bitwarden.js
│           ├── onepassword.js
│           ├── keepass.js
│           ├── lastpass.js
│           └── chrome.js
├── public/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── sw.js
│   ├── store.js
│   ├── login.html
│   ├── landing.html
│   ├── landing.css
│   ├── manifest.json
│   └── js/
│       ├── api.js
│       └── utils.js
└── tests/
    ├── helpers.js
    ├── db.test.js
    ├── encryption.test.js
    ├── auth.test.js
    ├── csrf.test.js
    ├── categories.test.js
    ├── record-types.test.js
    ├── items.test.js
    ├── attachments.test.js
    ├── tags.test.js
    ├── members.test.js
    ├── rbac.test.js
    ├── sharing.test.js
    ├── emergency.test.js
    ├── audit.test.js
    ├── search.test.js
    ├── password-generator.test.js
    ├── import-bitwarden.test.js
    ├── import-1password.test.js
    ├── import-keepass.test.js
    ├── import-lastpass.test.js
    ├── import-chrome.test.js
    ├── data.test.js
    ├── stats.test.js
    ├── security.test.js
    ├── security-audit.test.js
    ├── sql-safety.test.js
    ├── xss.test.js
    ├── idor.test.js
    ├── idor-exhaustive.test.js
    ├── session-security.test.js
    ├── encryption-audit.test.js
    ├── performance.test.js
    ├── concurrency.test.js
    ├── multi-user.test.js
    ├── frontend-validation.test.js
    ├── a11y.test.js
    ├── mobile-responsive.test.js
    ├── e2e-smoke.test.js
    └── release-hygiene.test.js
```

---

## Definition of Done (Per Phase)

- [ ] All tests pass (`npm test`)
- [ ] No ESLint errors (`npm run lint`)
- [ ] CLAUDE.md updated (metrics, schema, routes, features)
- [ ] CHANGELOG.md entry added
- [ ] Security tests pass (IDOR, CSRF, injection)
- [ ] No sensitive data in logs (grep check)
- [ ] Docker build succeeds (`docker compose up --build -d`)
