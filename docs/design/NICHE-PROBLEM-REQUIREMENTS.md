# DataFlow — Secure Family Data Vault

> **Status:** Active
> **Created:** 5 April 2026
> **Baseline:** v0.1.0 — greenfield

---

## 1. Niche

**Self-hosted, zero-knowledge family data vault — web application.**

No existing product covers the full spectrum of structured personal data that families need to store securely: passwords, identity documents, medical records, financial info, emergency contacts, addresses, key-value notes, media, and file attachments — all with per-member access control, shared vaults, and audit trails.

### Market Gap

| Existing Category | What It Does Well | What It Lacks |
|---|---|---|
| Password Managers (Bitwarden, 1Password) | Passwords, TOTP, autofill | Arbitrary structured data, document storage, family RBAC |
| Encrypted Notes (Notesnook, Standard Notes) | Rich text, E2EE | Structured fields, typed records, family sharing |
| File Encryption (Cryptomator) | Transparent file encryption | Search, metadata, application logic, structured data |
| Cloud Storage (Google Drive, Dropbox) | File storage, sharing | Encryption, structured data, vault semantics |
| Keeper (commercial) | Custom record types, flexibility | Self-hosting, open-source, cost ($75/yr) |

**DataFlow fills the gap:** a self-hosted web app that combines **Keeper-style custom record types** with **Bitwarden-level encryption** and **family RBAC** — all free, open-source, and running on your own hardware.

### Target Users

- Privacy-conscious families who want to own their data
- Technical users comfortable with Docker / self-hosting
- Families transitioning from spreadsheets, shared docs, or multiple apps
- Users leaving LastPass / commercial vaults for self-hosted alternatives

---

## 2. Problem Statement

### Primary Problem

Families accumulate sensitive structured data across dozens of categories — passwords, WiFi credentials, passport numbers, insurance policy details, vehicle registrations, medical records, emergency contacts, safe combinations, bank account details, subscription logins, software licenses — and currently store them in:

- Insecure locations (sticky notes, unencrypted spreadsheets, shared Google Docs)
- Siloed apps (password manager for logins only, notes app for everything else)
- Single points of failure (one family member's phone/head)

### Secondary Problems

1. **No family access control** — Parents need to share WiFi passwords with teens but not bank credentials. Existing tools are all-or-nothing.
2. **No structured data** — Password managers force everything into login/password fields. A vehicle registration has plate number, VIN, expiry, insurance provider, policy number — these need typed fields.
3. **No emergency access** — If the primary "family IT person" is incapacitated, nobody can access critical information (insurance, medical directives, legal documents).
4. **Vendor lock-in** — Commercial vaults hold data hostage. LastPass breach proved cloud-only storage is a liability.
5. **Cost** — Family plans for commercial vaults run $30–75/year. Self-hosted should be free.

### Lessons from the Field

| Incident | Lesson for DataFlow |
|---|---|
| LastPass breach (2022–ongoing): $438M+ crypto stolen from cracked vaults | Argon2id mandatory, encrypt ALL metadata, AEAD ciphers only |
| ETH Zurich 2026: 25 vulns across Bitwarden/LastPass/Dashlane | Treat server as potential adversary, enforce KDF params client-side |
| 170+ Supabase apps with exposed DBs (2025) | RLS/auth on every route, defense in depth |
| LastPass: unencrypted URLs, AES-CBC without integrity | Never store plaintext metadata, use AES-256-GCM (authenticated) |
| LastPass: PBKDF2 at 5,000 iterations on legacy accounts | Enforce minimum KDF parameters, no grandfather clauses |

---

## 3. Requirements

### 3.1 Functional Requirements

#### 3.1.1 Core Hierarchy

```
Family (Vault) → Member → Category → Item → Field/Attachment
```

- **Family** — A single vault instance. One family per deployment.
- **Member** — A user with a role (admin/adult/child/guest). Each has their own master password.
- **Category** — Organizes items (e.g., Passwords, IDs, Medical, Financial, Emergency). User-creatable.
- **Item** — A single record (e.g., "Home WiFi", "Dad's Passport", "Car Insurance Policy").
- **Field** — A typed key-value pair within an item (text, password, date, number, phone, email, URL, select, textarea, file).
- **Attachment** — File/image/document attached to an item (encrypted at rest).

#### 3.1.2 Record Types (Custom Templates)

Users can define **record types** (templates) with named, typed fields. Built-in types ship by default:

| Record Type | Default Fields |
|---|---|
| **Login** | website, username, password, TOTP, notes |
| **Identity** | type (passport/DL/SSN/etc), number, full_name, issuing_authority, issue_date, expiry_date, photo_front, photo_back |
| **Credit Card** | cardholder, number, expiry, CVV, PIN, billing_address, issuing_bank |
| **Bank Account** | bank_name, account_holder, account_number, routing_number, SWIFT/BIC, branch, type (checking/savings) |
| **Address** | label, street, city, state, zip, country, type (home/work/other) |
| **Emergency Contact** | name, relationship, phone_primary, phone_secondary, email, address, notes |
| **Medical** | type (allergy/condition/medication/insurance), name, details, provider, policy_number, dosage, frequency |
| **Vehicle** | make, model, year, plate, VIN, color, insurance_provider, policy_number, registration_expiry |
| **WiFi** | network_name, password, encryption_type, notes |
| **Software License** | software, license_key, email, purchase_date, expiry, seats |
| **Secure Note** | title, content (markdown), tags |
| **Key-Value** | arbitrary key-value pairs (freeform) |
| **Document** | title, description, file(s), tags |
| **Subscription** | service, plan, cost, billing_cycle, next_billing, username, password, URL |

Users can create **custom record types** defining their own field sets.

#### 3.1.3 Family Access Control

| Role | Own Items | Shared Items | Categories | Members | Settings | Audit |
|---|---|---|---|---|---|---|
| **Admin** | Full CRUD | Full CRUD | Full CRUD | Manage | Full | View all |
| **Adult** | Full CRUD | Full CRUD | Create | — | Own prefs | Own only |
| **Child** | Full CRUD | Read shared | — | — | Own prefs | Own only |
| **Guest** | — | Read shared | — | — | — | — |

- Items are **private by default** — visible only to the creator.
- Sharing is explicit: share an item or category with specific members or "all adults" / "all members".
- Shared items can be read-only or read-write per grantee.
- Admin can see all items (emergency override).

#### 3.1.4 Encryption Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Client (Browser)                      │
│                                                         │
│  Master Password                                        │
│       │                                                 │
│       ▼                                                 │
│  PBKDF2 (600K iterations, SHA-256) ──► Auth Hash ──────►│──► Server (verify)
│       │                                    (via Web Crypto) │
│       ▼                                                 │
│  Argon2id (server-side, 64 MiB, t=3) ──► Encryption Key │
│       │                                                 │
│       ▼                                                 │
│  AES-256-GCM (per-item, unique IV)                      │
│       │                                                 │
│       ▼                                                 │
│  Encrypted Item JSON ──────────────────►│──► SQLite      │
└─────────────────────────────────────────────────────────┘
```

**Practical approach for webapp-only (Phase 1):**
- Server-side encryption using Node.js `crypto` module
- AES-256-GCM for item-level encryption with per-item random IVs
- Argon2id for master password → encryption key derivation
- Separate auth hash (PBKDF2) for session authentication — encryption key never stored on server
- All sensitive fields encrypted before writing to SQLite
- Encryption key derived per-session, held in server memory only during active session
- File attachments encrypted with item's key before writing to disk

**Phase 2 (future):** Client-side encryption via Web Crypto API for true zero-knowledge.

#### 3.1.5 Search & Navigation

- **Encrypted search index** — FTS5 on item titles + category names (titles stored encrypted, decrypted for indexing in memory)
- Full-text search across all accessible items
- Filter by: category, record type, tag, shared status, date range
- Sort by: name, created, updated, category
- Keyboard shortcuts for power users

#### 3.1.6 Emergency Access

- Designated trusted contacts can request vault access
- Configurable wait period (1–30 days) before access granted
- Grantor receives notification and can reject during wait period
- Optional: Shamir's Secret Sharing — split recovery key into K-of-N shares across family members

#### 3.1.7 Audit Trail

- Log every: login, item view, item create/update/delete, share change, member change, export, setting change
- Admin dashboard: who accessed what, when
- Retention: configurable (default 90 days)

#### 3.1.8 Import / Export

- Import from: Bitwarden JSON/CSV, 1Password CSV, KeePass XML, LastPass CSV, Chrome CSV
- Export to: encrypted JSON backup, CSV (with warning)
- Auto-backup: daily, rotates last 7

### 3.2 Non-Functional Requirements

#### 3.2.1 Security

| Requirement | Specification |
|---|---|
| Encryption at rest | AES-256-GCM, per-item unique IV |
| Key derivation | Argon2id (m=64 MiB, t=3, p=1) |
| Auth hash | PBKDF2-SHA256 (600,000 iterations) |
| Session management | Secure, HttpOnly, SameSite=Strict cookies |
| CSRF protection | Double-submit cookie pattern |
| Rate limiting | Login: 5 attempts / 15 min, then lockout. API: 200 req/min |
| Password policy | Minimum 12 characters, zxcvbn score ≥ 3 |
| Auto-lock | Configurable (1/5/15/30 min), default 5 min |
| Clipboard | Auto-clear after 30 seconds |
| Content Security Policy | Strict CSP, no inline scripts |
| HTTPS | Required in production (enforced via HSTS) |

#### 3.2.2 Performance

| Metric | Target |
|---|---|
| Page load (cold) | < 2 seconds |
| Search response | < 200ms for 10,000 items |
| Item decrypt + render | < 100ms |
| File upload (10 MB) | < 5 seconds |
| Memory (server) | < 150 MB |
| SQLite DB size | Efficient up to 100,000 items |

#### 3.2.3 Reliability

- Auto-backup on startup + every 24 hours (rotate last 7)
- Data watermark — detect >50% data loss, auto-restore from richest backup
- WAL mode for crash resilience
- Graceful shutdown with in-flight request completion

#### 3.2.4 Usability

- Responsive design (desktop + tablet + mobile browser)
- Keyboard navigable (WCAG 2.1 AA target)
- Dark/light theme + auto-detect
- Onboarding wizard for first-time vault setup
- Password generator (configurable length, character sets, passphrase mode)
- One-click copy for passwords, account numbers, etc.

### 3.3 Technical Stack

| Layer | Technology | Rationale |
|---|---|---|
| Runtime | Node.js 22 | Consistent with LifeFlow/PersonalFi ecosystem |
| Framework | Express 5 | Proven, lightweight, same patterns |
| Database | better-sqlite3 (WAL mode) | Single-file, zero-config, proven at scale |
| Encryption | Node.js `crypto` (AES-256-GCM) | Built-in, hardware-accelerated, no native deps |
| KDF | argon2 (npm) | Memory-hard, GPU-resistant |
| Auth hashing | bcryptjs | Password verification |
| Validation | Zod v4 | Same patterns as sibling projects |
| Logging | Pino | Structured JSON, same as siblings |
| Frontend | Vanilla JS SPA | No build step, same as siblings |
| Testing | node:test + supertest | Same as siblings |
| Deployment | Docker (node:22-slim) | Same as siblings |

### 3.4 Out of Scope (v1)

- Mobile native apps (iOS/Android)
- Browser extension / autofill
- Client-side (browser) encryption (Phase 2)
- Cloud sync / multi-device (single server deployment)
- TOTP generation / authenticator functionality
- Biometric unlock
- Shamir's Secret Sharing (Phase 2)
- Post-quantum cryptography
- WebAuthn / FIDO2 (Phase 2)

---

## 4. Success Criteria

| Criteria | Measurement |
|---|---|
| All 14 built-in record types working | CRUD + encryption verified by tests |
| Custom record types | Create, use, modify templates |
| Family RBAC | 4 roles enforced, sharing works correctly |
| Encryption | Every sensitive field encrypted at rest, verified by DB inspection |
| Auth security | Rate limiting, lockout, session management, CSRF pass security tests |
| Import | At least Bitwarden + 1Password + CSV import working |
| Performance | Search < 200ms at 10K items |
| Test coverage | 80%+ line coverage, security-specific test suite |
| Docker deployment | `docker compose up --build -d` works end-to-end |

---

## 5. Competitive Positioning

```
                        Structured Data Flexibility
                                    ▲
                                    │
                    DataFlow ★      │      Keeper
                                    │
                    Bitwarden       │      1Password
                                    │
                ────────────────────┼────────────────────►
                  Self-Hosted       │         Cloud-Only
                                    │
                    KeePassXC       │      NordPass
                                    │
                    Cryptomator     │      LastPass
                                    │
                                    ▼
                        File/Password Focus Only
```

**DataFlow's unique position:** Top-left quadrant — maximum data flexibility + fully self-hosted. No existing solution occupies this space.
