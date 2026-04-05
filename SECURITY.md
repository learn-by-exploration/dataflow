# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in DataFlow, please report it responsibly:

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Email the maintainer with a description of the vulnerability
3. Include steps to reproduce if possible
4. Allow reasonable time for a fix before public disclosure

## Security Measures

DataFlow implements the following security measures:

- **Encryption at rest**: AES-256-GCM with per-item unique IVs
- **Key derivation**: Argon2id with configurable memory/time cost
- **Password hashing**: bcrypt for login passwords
- **Zero-knowledge**: Server never stores or logs plaintext vault keys
- **Session security**: HttpOnly, SameSite=Strict cookies
- **CSRF protection**: Double-submit cookie pattern
- **Input validation**: Zod schemas on all endpoints
- **SQL injection prevention**: Parameterized queries only (better-sqlite3)
- **Rate limiting**: Configurable per-endpoint rate limits
- **Account lockout**: Automatic lockout after failed login attempts
- **Security headers**: Helmet (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- **CORS**: Configurable allowed origins
- **Audit logging**: All security-relevant actions logged
- **No version leakage**: X-Powered-By header removed
