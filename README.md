# DataFlow

Secure, self-hosted family data vault — an encrypted web application for managing passwords, documents, and sensitive family data.

## Features

- **End-to-end encryption** — AES-256-GCM with per-item unique IVs
- **Zero-knowledge architecture** — vault key derived via Argon2id, server never sees plaintext
- **Multi-user support** — admin, adult, child, and guest roles with RBAC
- **Categories & record types** — organize items by customizable categories and templates
- **Secure sharing** — share items and categories with family members (read/write permissions)
- **Tags & favorites** — organize and quickly access important items
- **Item attachments** — encrypted file storage
- **Data import** — import from Bitwarden, Chrome, LastPass, 1Password, KeePass
- **Data export** — full vault export in JSON format
- **Password generator** — customizable secure password generation
- **Audit logging** — track all actions for accountability
- **Emergency access** — configurable emergency access for trusted contacts
- **Automatic backups** — scheduled database backups with retention
- **Session management** — secure cookie-based sessions with auto-lock
- **OWASP hardened** — Helmet, CORS, CSRF protection, rate limiting, input validation

## Quick Start

### Prerequisites

- Node.js >= 22
- npm

### Development

```bash
# Clone the repository
git clone <repo-url>
cd dataflow

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Start development server
npm run dev

# Run tests
npm test
```

### Docker

```bash
docker compose up --build -d
```

The app will be available at `http://localhost:3460`.

## API Overview

All API routes are prefixed with `/api`. Authentication is required for all routes except:

- `POST /api/auth/register` — Register a new user
- `POST /api/auth/login` — Login
- `GET /api/health` — Health check

### Core Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/register | Register user |
| POST | /api/auth/login | Login |
| POST | /api/auth/logout | Logout |
| GET | /api/categories | List categories |
| POST | /api/categories | Create category |
| GET | /api/items | List items |
| POST | /api/items | Create item |
| GET | /api/items/:id | Get item (decrypted) |
| PUT | /api/items/:id | Update item |
| DELETE | /api/items/:id | Delete item |
| GET | /api/tags | List tags |
| POST | /api/tags | Create tag |
| GET | /api/record-types | List record types |
| GET | /api/settings | Get settings |
| GET | /api/data/export | Export vault |
| POST | /api/data/import | Import data |
| GET | /api/stats/dashboard | Dashboard stats |
| GET | /api/audit | Audit log |

## Architecture

- **Backend**: Express 5, better-sqlite3 (WAL mode)
- **Encryption**: AES-256-GCM (Node.js crypto), Argon2id key derivation
- **Authentication**: bcrypt (login), Argon2id (vault key), cookie-based sessions
- **Validation**: Zod schemas
- **Testing**: node:test, supertest, c8 coverage

## Deployment

### Environment Variables

See `.env.example` for all available configuration options.

### Docker Compose (Recommended)

```bash
docker compose up --build -d
```

Data is persisted in the `data/` volume.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for security policy and vulnerability reporting.

## License

[MIT](LICENSE)
