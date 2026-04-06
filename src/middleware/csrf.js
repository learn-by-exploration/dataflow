'use strict';

const crypto = require('crypto');

function createCsrfMiddleware() {
  return function csrfProtection(req, res, next) {
    // Read-only methods are exempt
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      ensureTokenCookie(req, res);
      return next();
    }

    // Auth endpoints exempt from CSRF (login/register use password as proof)
    if (req.path === '/auth/login' || req.path === '/auth/register' || req.path === '/auth/logout' || req.path === '/auth/recover') {
      ensureTokenCookie(req, res);
      return next();
    }

    // Validate CSRF token
    const headerToken = req.headers['x-csrf-token'];
    const cookieToken = req.cookies && req.cookies.csrf_token;

    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token' });
    }

    next();
  };
}

function ensureTokenCookie(req, res) {
  const existing = req.cookies && req.cookies.csrf_token;
  if (!existing) {
    const token = crypto.randomBytes(32).toString('hex');
    const parts = [
      `csrf_token=${token}`,
      'SameSite=Strict',
      'Path=/',
      'Max-Age=86400',
    ];
    if (req.secure || (req.headers && req.headers['x-forwarded-proto'] === 'https')) {
      parts.push('Secure');
    }
    const prev = res.getHeader('Set-Cookie');
    const cookies = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
    cookies.push(parts.join('; '));
    res.setHeader('Set-Cookie', cookies);
  }
}

module.exports = createCsrfMiddleware;
