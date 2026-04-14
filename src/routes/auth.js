'use strict';

const { Router } = require('express');
const config = require('../config');
const crypto = require('crypto');
const validate = require('../middleware/validate');
const { registerSchema, loginSchema, changePasswordSchema } = require('../schemas/auth.schema');
const createAuthService = require('../services/auth.service');
const createSessionRepo = require('../repositories/session.repository');
const createAuthMiddleware = require('../middleware/auth');
const sessionVault = require('../services/session-vault');
const createRecoveryService = require('../services/recovery.service');

/** Helper: get the session cookie name based on environment */
function cookieName() {
  return config.secureCookie ? '__Host-df_sid' : 'df_sid';
}

/** Helper: build Set-Cookie header for session */
function sessionCookie(sid, maxAgeDays) {
  const name = cookieName();
  const parts = [
    `${name}=${sid}`,
    'HttpOnly',
    'SameSite=Strict',
    `Path=/`,
    `Max-Age=${maxAgeDays * 86400}`,
  ];
  if (config.secureCookie) parts.push('Secure');
  return parts.join('; ');
}

/** Helper: build clear-cookie header */
function clearSessionCookie() {
  const name = cookieName();
  const parts = [`${name}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (config.secureCookie) parts.push('Secure');
  return parts.join('; ');
}

module.exports = function createAuthRoutes({ db, audit }) {
  const router = Router();
  const authService = createAuthService(db, audit);
  const sessionRepo = createSessionRepo(db);
  const { requireAuth } = createAuthMiddleware(db);

  // ─── POST /api/auth/register ───
  router.post('/api/auth/register', validate({ body: registerSchema }), async (req, res, next) => {
    try {
      const { email, password, display_name, master_password } = req.body;

      const { user, sid } = await authService.register({
        email,
        password,
        displayName: display_name,
        masterPassword: master_password,
      });

      res.setHeader('Set-Cookie', sessionCookie(sid, config.session.maxAgeDays));

      audit.log({
        userId: user.id,
        action: 'register',
        resource: 'user',
        resourceId: user.id,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  });

  // ─── POST /api/auth/login ───
  router.post('/api/auth/login', validate({ body: loginSchema }), async (req, res, next) => {
    try {
      const { email, password, master_password } = req.body;

      const { user, sid } = await authService.login({
        email,
        password,
        masterPassword: master_password,
      });

      res.setHeader('Set-Cookie', sessionCookie(sid, config.session.maxAgeDays));

      audit.log({
        userId: user.id,
        action: 'login',
        resource: 'session',
        resourceId: null,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.json(user);
    } catch (err) {
      next(err);
    }
  });

  // ─── POST /api/auth/logout ───
  router.post('/api/auth/logout', (req, res) => {
    const sid = req.cookies && req.cookies[cookieName()];
    if (sid) {
      authService.logout(sid);
    }

    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true });
  });

  // ─── GET /api/auth/session ───
  router.get('/api/auth/session', (req, res) => {
    const sid = req.cookies && req.cookies[cookieName()];
    const user = authService.getSession(sid);

    if (!user) {
      return res.json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      user,
    });
  });

  // ─── GET /api/auth/me — alias for /api/auth/session ───
  router.get('/api/auth/me', (req, res) => {
    const sid = req.cookies && req.cookies[cookieName()];
    const user = authService.getSession(sid);

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({ user });
  });

  // ─── POST /api/auth/unlock — re-derive vault key from master password ───
  router.post('/api/auth/unlock', requireAuth, async (req, res, next) => {
    try {
      const { master_password } = req.body;
      if (!master_password) {
        return res.status(400).json({ error: 'master_password is required' });
      }

      const { deriveKey, unwrapVaultKey, zeroBuffer } = require('../services/encryption');
      const authRepo = require('../repositories/auth.repository')(db);
      const user = authRepo.findUserById(req.userId);
      if (!user || !user.vault_key_encrypted) {
        return res.status(400).json({ error: 'No vault key configured' });
      }

      const salt = Buffer.from(user.master_key_salt, 'hex');
      const params = JSON.parse(user.master_key_params);
      const derivedKey = await deriveKey(master_password, salt, params);

      const wrapped = JSON.parse(user.vault_key_encrypted);
      let vaultKey;
      try {
        vaultKey = unwrapVaultKey(wrapped, derivedKey);
      } catch {
        return res.status(401).json({ error: 'Invalid master password' });
      }

      const sid = req.cookies && req.cookies[cookieName()];
      sessionVault.setVaultKey(sid, vaultKey, req.userId);
      zeroBuffer(vaultKey);
      zeroBuffer(derivedKey);

      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // ─── PUT /api/auth/password ───
  router.put('/api/auth/password', validate({ body: changePasswordSchema }), async (req, res, next) => {
    try {
      const sid = req.cookies && req.cookies[cookieName()];

      const sessionUser = authService.getSession(sid);

      await authService.changePassword(sid, {
        currentPassword: req.body.current_password,
        newPassword: req.body.new_password,
        currentMasterPassword: req.body.current_master_password,
        newMasterPassword: req.body.new_master_password,
      });

      if (sessionUser) {
        audit.log({
          userId: sessionUser.id,
          action: 'password_change',
          resource: 'user',
          resourceId: sessionUser.id,
          ip: req.ip,
          ua: req.headers['user-agent'],
        });
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /api/auth/sessions — list active sessions for current user ───
  router.get('/api/auth/sessions', requireAuth, (req, res) => {
    const sessions = sessionRepo.findByUserId(req.userId);
    const currentSid = req.sessionId;

    const result = sessions.map(s => ({
      sid: s.sid.slice(0, 8) + '…',
      ref: crypto.createHash('sha256').update(s.sid).digest('hex').slice(0, 16),
      created_at: s.created_at,
      expires_at: s.expires_at,
      is_current: s.sid === currentSid,
    }));

    res.json(result);
  });

  // ─── DELETE /api/auth/sessions/:ref — revoke a specific session by ref ───
  router.delete('/api/auth/sessions/:ref', requireAuth, (req, res) => {
    const targetRef = req.params.ref;

    // Find the session matching this ref
    const sessions = sessionRepo.findByUserId(req.userId);
    const target = sessions.find(s => crypto.createHash('sha256').update(s.sid).digest('hex').slice(0, 16) === targetRef);

    if (!target) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (target.sid === req.sessionId) {
      return res.status(400).json({ error: 'Cannot revoke current session' });
    }

    sessionRepo.deleteSessionBySid(target.sid, req.userId);

    audit.log({
      userId: req.userId,
      action: 'session_revoke',
      resource: 'session',
      resourceId: null,
      ip: req.ip,
      ua: req.headers['user-agent'],
    });

    res.json({ ok: true });
  });

  // ─── DELETE /api/auth/sessions — revoke all sessions except current ───
  router.delete('/api/auth/sessions', requireAuth, (req, res) => {
    const result = sessionRepo.deleteOtherSessions(req.sessionId, req.userId);

    audit.log({
      userId: req.userId,
      action: 'session_revoke_all',
      resource: 'session',
      resourceId: null,
      ip: req.ip,
      ua: req.headers['user-agent'],
      detail: JSON.stringify({ revoked: result.changes }),
    });

    res.json({ ok: true, revoked: result.changes });
  });

  // ─── POST /api/auth/rotate-vault-key ───
  router.post('/api/auth/rotate-vault-key', requireAuth, async (req, res, next) => {
    try {
      const { new_master_password } = req.body;
      if (!new_master_password) {
        return res.status(400).json({ error: 'new_master_password is required' });
      }

      const result = await authService.rotateVaultKey(req.sessionId, {
        newMasterPassword: new_master_password,
      });

      audit.log({
        userId: req.userId,
        action: 'vault_key_rotation',
        resource: 'user',
        resourceId: req.userId,
        ip: req.ip,
        ua: req.headers['user-agent'],
        detail: JSON.stringify({ items_rotated: result.items_rotated }),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // ─── Recovery Codes ───
  const recoveryService = createRecoveryService(db);

  // POST /api/auth/recovery-codes/generate
  router.post('/api/auth/recovery-codes/generate', requireAuth, async (req, res, next) => {
    try {
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ error: 'Current password is required' });
      }

      // Verify current password
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const bcrypt = require('bcryptjs');
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid password' });
      }

      const codes = await recoveryService.generateCodes(req.userId);

      audit.log({
        userId: req.userId,
        action: 'recovery_codes.generate',
        resource: 'user',
        resourceId: req.userId,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.json({ codes });
    } catch (err) { next(err); }
  });

  // GET /api/auth/recovery-codes/status
  router.get('/api/auth/recovery-codes/status', requireAuth, (req, res, next) => {
    try {
      const status = recoveryService.getCodeStatus(req.userId);
      res.json(status);
    } catch (err) { next(err); }
  });

  // POST /api/auth/recover
  router.post('/api/auth/recover', async (req, res, next) => {
    try {
      const { email, recovery_code, new_password, new_master_password } = req.body;
      if (!email || !recovery_code || !new_password || !new_master_password) {
        return res.status(400).json({ error: 'email, recovery_code, new_password, and new_master_password are required' });
      }

      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user) {
        return res.status(401).json({ error: 'Recovery failed' });
      }

      const used = await recoveryService.useCode(user.id, recovery_code);
      if (!used) {
        return res.status(401).json({ error: 'Recovery failed' });
      }

      // Reset the password
      const bcrypt = require('bcryptjs');
      const crypto = require('crypto');
      const { deriveKey, generateVaultKey, wrapVaultKey } = require('../services/encryption');

      const passwordHash = await bcrypt.hash(new_password, config.isTest ? 4 : config.auth.saltRounds);

      const salt = crypto.randomBytes(32);
      const params = {
        memoryCost: config.isTest ? 1024 : config.argon2.memoryCost,
        timeCost: config.isTest ? 1 : config.argon2.timeCost,
        parallelism: config.argon2.parallelism,
      };
      const derivedKey = await deriveKey(new_master_password, salt, params);
      const vaultKey = generateVaultKey();
      const wrapped = wrapVaultKey(vaultKey, derivedKey);

      db.prepare(
        `UPDATE users SET password_hash = ?, master_key_salt = ?, master_key_params = ?, vault_key_encrypted = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(passwordHash, salt.toString('hex'), JSON.stringify(params), JSON.stringify(wrapped), user.id);

      audit.log({
        userId: user.id,
        action: 'recovery_codes.recover',
        resource: 'user',
        resourceId: user.id,
        ip: req.ip,
        ua: req.headers['user-agent'],
        detail: 'data_loss: new vault key generated, all encrypted items unrecoverable',
      });

      res.json({ ok: true, warning: 'All previously encrypted vault data is now unrecoverable. A new empty vault key was generated.' });
    } catch (err) { next(err); }
  });

  return router;
};
