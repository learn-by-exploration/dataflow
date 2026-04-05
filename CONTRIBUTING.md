# Contributing to DataFlow

Thank you for your interest in contributing to DataFlow!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone <your-fork-url>`
3. Install dependencies: `npm install`
4. Copy environment config: `cp .env.example .env`
5. Run tests: `npm test`

## Development Workflow

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Write tests for new functionality
4. Run the full test suite: `npm test`
5. Run linting: `npm run lint`
6. Submit a pull request

## Code Standards

- **Testing**: All new features must include tests. We use `node:test` with `node:assert/strict` and `supertest`.
- **Coverage**: Maintain or improve test coverage (measured with `c8`).
- **Linting**: Code must pass ESLint. Run `npm run lint:fix` to auto-fix issues.
- **No secrets**: Never commit `.env` files, database files, or credentials.
- **Security**: Follow OWASP guidelines. All user input must be validated with Zod schemas. Use parameterized queries only.

## Testing Requirements

- All tests must pass before submitting a PR
- New API endpoints require integration tests
- Security-sensitive changes require security tests
- Run the full suite: `npm test`
- Run fast (no coverage): `npm run test:fast`

## Architecture Notes

- Express 5 with `/{*splat}` syntax
- better-sqlite3 with WAL mode
- AES-256-GCM for encryption, Argon2id for key derivation
- Cookie-based sessions (no JWT)
- Zod for request validation

## Reporting Issues

Use GitHub Issues to report bugs. Include:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Node.js version and OS
