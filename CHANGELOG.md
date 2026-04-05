# Changelog

All notable changes to DataFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
