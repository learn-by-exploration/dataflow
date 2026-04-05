'use strict';

const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { UnauthorizedError, ConflictError } = require('../errors');
const { deriveKey, generateVaultKey, wrapVaultKey, unwrapVaultKey, zeroBuffer } = require('../services/encryption');
const sessionVault = require('../services/session-vault');
const validate = require('../middleware/validate');
const { registerSchema, loginSchema, changePasswordSchema } = require('../schemas/auth.schema');

module.exports = function createAuthRoutes({ db, audit }) {
  const router = Router();

  // ─── POST /api/auth/register ───
  router.post('/api/auth/register', validate({ body: registerSchema }), async (req, res, next) => {
    try {
      const { email, password, display_name, master_password } = req.body;

      // Check duplicate email
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        throw new ConflictError('Email already registered');
      }

      // First user becomes admin
      const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
      const role = userCount === 0 ? 'admin' : 'adult';

      // Hash login password with bcrypt
      const passwordHash = await bcrypt.hash(password, config.isTest ? 4 : config.auth.saltRounds);

      // Derive encryption key from master password
      const salt = crypto.randomBytes(32);
      const params = {
        memoryCost: config.isTest ? 1024 : config.argon2.memoryCost,
        timeCost: config.isTest ? 1 : config.argon2.timeCost,
        parallelism: config.argon2.parallelism,
      };
      const derivedKey = await deriveKey(master_password, salt, params);

      // Generate and wrap vault key
      const vaultKey = generateVaultKey();
      const wrapped = wrapVaultKey(vaultKey, derivedKey);

      // Store user
      const result = db.prepare(
        `INSERT INTO users (email, password_hash, display_name, role, master_key_salt, master_key_params, vault_key_encrypted)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        email,
        passwordHash,
        display_name,
        role,
        salt.toString('hex'),
        JSON.stringify(params),
        JSON.stringify(wrapped),
      );

      // Create session
      const sid = crypto.randomBytes(32).toString('hex');
      const maxAge = config.session.maxAgeDays;
      db.prepare(
        "INSERT INTO sessions (sid, user_id, expires_at) VALUES (?, ?, datetime('now', ? || ' days'))"
      ).run(sid, result.lastInsertRowid, String(maxAge));

      // Store vault key in session vault before zeroing
      sessionVault.setVaultKey(sid, vaultKey, Number(result.lastInsertRowid));

      // Zero sensitive buffers
      zeroBuffer(derivedKey);
      zeroBuffer(vaultKey);

      // Set session cookie
      const cookieOpts = [
        `df_sid=${sid}`,
        'HttpOnly',
        'SameSite=Strict',
        `Path=/`,
        `Max-Age=${maxAge * 86400}`,
      ];
      if (config.isProd) cookieOpts.push('Secure');
      res.setHeader('Set-Cookie', cookieOpts.join('; '));

      audit.log({
        userId: result.lastInsertRowid,
        action: 'register',
        resource: 'user',
        resourceId: result.lastInsertRowid,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.status(201).json({
        id: Number(result.lastInsertRowid),
        email,
        display_name,
        role,
      });
    } catch (err) {
      next(err);
    }
  });

  // ─── POST /api/auth/login ───
  router.post('/api/auth/login', validate({ body: loginSchema }), async (req, res, next) => {
    try {
      const { email, password, master_password } = req.body;

      // Check lockout
      const attempt = db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(email);
      if (attempt && attempt.locked_until) {
        const lockedUntil = new Date(attempt.locked_until);
        if (lockedUntil > new Date()) {
          throw new UnauthorizedError('Account temporarily locked. Try again later.');
        }
        // Lockout expired, reset
        db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email);
      }

      // Find user
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user) {
        recordFailedAttempt(db, email);
        throw new UnauthorizedError('Invalid email or password');
      }

      // Verify login password
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        recordFailedAttempt(db, email);
        throw new UnauthorizedError('Invalid email or password');
      }

      // Reset login attempts on success
      db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email);

      // Derive vault key from master password
      const salt = Buffer.from(user.master_key_salt, 'hex');
      const params = JSON.parse(user.master_key_params);
      const derivedKey = await deriveKey(master_password, salt, params);

      // Unwrap vault key
      const wrapped = JSON.parse(user.vault_key_encrypted);
      let vaultKey;
      try {
        vaultKey = unwrapVaultKey(wrapped, derivedKey);
      } catch (_e) {
        zeroBuffer(derivedKey);
        throw new UnauthorizedError('Invalid master password');
      }
      zeroBuffer(derivedKey);

      // Create session
      const sid = crypto.randomBytes(32).toString('hex');
      const maxAge = config.session.maxAgeDays;
      db.prepare(
        "INSERT INTO sessions (sid, user_id, expires_at) VALUES (?, ?, datetime('now', ? || ' days'))"
      ).run(sid, user.id, String(maxAge));

      // Store vault key in session vault
      sessionVault.setVaultKey(sid, vaultKey, user.id);

      // Set session cookie
      const cookieOpts = [
        `df_sid=${sid}`,
        'HttpOnly',
        'SameSite=Strict',
        `Path=/`,
        `Max-Age=${maxAge * 86400}`,
      ];
      if (config.isProd) cookieOpts.push('Secure');
      res.setHeader('Set-Cookie', cookieOpts.join('; '));

      audit.log({
        userId: user.id,
        action: 'login',
        resource: 'session',
        resourceId: null,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.json({
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
      });
    } catch (err) {
      next(err);
    }
  });

  // ─── POST /api/auth/logout ───
  router.post('/api/auth/logout', (req, res) => {
    const sid = req.cookies && req.cookies.df_sid;
    if (sid) {
      sessionVault.clearVaultKey(sid);
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    }

    res.setHeader('Set-Cookie', 'df_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  // ─── GET /api/auth/session ───
  router.get('/api/auth/session', (req, res) => {
    const sid = req.cookies && req.cookies.df_sid;
    if (!sid) {
      return res.json({ authenticated: false });
    }

    const session = db.prepare(
      "SELECT * FROM sessions WHERE sid = ? AND expires_at > datetime('now')"
    ).get(sid);

    if (!session) {
      return res.json({ authenticated: false });
    }

    const user = db.prepare('SELECT id, email, display_name, role FROM users WHERE id = ?').get(session.user_id);
    if (!user) {
      return res.json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
      },
    });
  });

  // ─── PUT /api/auth/password ───
  router.put('/api/auth/password', validate({ body: changePasswordSchema }), async (req, res, next) => {
    try {
      const sid = req.cookies && req.cookies.df_sid;
      if (!sid) throw new UnauthorizedError();

      const session = db.prepare(
        "SELECT * FROM sessions WHERE sid = ? AND expires_at > datetime('now')"
      ).get(sid);
      if (!session) throw new UnauthorizedError();

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
      if (!user) throw new UnauthorizedError();

      const { current_password, new_password, current_master_password, new_master_password } = req.body;

      // Verify current password
      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) throw new UnauthorizedError('Current password is incorrect');

      // Derive old vault key
      const oldSalt = Buffer.from(user.master_key_salt, 'hex');
      const oldParams = JSON.parse(user.master_key_params);
      const oldDerivedKey = await deriveKey(current_master_password, oldSalt, oldParams);

      // Unwrap old vault key
      const oldWrapped = JSON.parse(user.vault_key_encrypted);
      let vaultKey;
      try {
        vaultKey = unwrapVaultKey(oldWrapped, oldDerivedKey);
      } catch (_e) {
        zeroBuffer(oldDerivedKey);
        throw new UnauthorizedError('Current master password is incorrect');
      }
      zeroBuffer(oldDerivedKey);

      // Hash new login password
      const newPasswordHash = await bcrypt.hash(new_password, config.isTest ? 4 : config.auth.saltRounds);

      // Derive new encryption key
      const newSalt = crypto.randomBytes(32);
      const newParams = {
        memoryCost: config.isTest ? 1024 : config.argon2.memoryCost,
        timeCost: config.isTest ? 1 : config.argon2.timeCost,
        parallelism: config.argon2.parallelism,
      };
      const newDerivedKey = await deriveKey(new_master_password, newSalt, newParams);

      // Re-wrap vault key
      const newWrapped = wrapVaultKey(vaultKey, newDerivedKey);
      zeroBuffer(newDerivedKey);

      // Update user
      db.prepare(
        `UPDATE users SET password_hash = ?, master_key_salt = ?, master_key_params = ?, vault_key_encrypted = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(newPasswordHash, newSalt.toString('hex'), JSON.stringify(newParams), JSON.stringify(newWrapped), user.id);

      // Update session vault with same vault key
      sessionVault.setVaultKey(sid, vaultKey, user.id);

      audit.log({
        userId: user.id,
        action: 'password_change',
        resource: 'user',
        resourceId: user.id,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
};

function recordFailedAttempt(db, email) {
  const attempt = db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(email);
  const now = new Date().toISOString();

  if (!attempt) {
    db.prepare(
      'INSERT INTO login_attempts (email, attempts, first_attempt_at) VALUES (?, 1, ?)'
    ).run(email, now);
    return;
  }

  const windowMs = 15 * 60 * 1000; // 15 minutes
  const firstAttempt = new Date(attempt.first_attempt_at + 'Z');
  if (Date.now() - firstAttempt.getTime() > windowMs) {
    // Window expired, reset
    db.prepare('UPDATE login_attempts SET attempts = 1, first_attempt_at = ?, locked_until = NULL WHERE email = ?').run(now, email);
    return;
  }

  const newAttempts = attempt.attempts + 1;
  if (newAttempts >= 5) {
    // Lock for 15 minutes
    const lockedUntil = new Date(Date.now() + windowMs).toISOString();
    db.prepare('UPDATE login_attempts SET attempts = ?, locked_until = ? WHERE email = ?').run(newAttempts, lockedUntil, email);
  } else {
    db.prepare('UPDATE login_attempts SET attempts = ? WHERE email = ?').run(newAttempts, email);
  }
}
