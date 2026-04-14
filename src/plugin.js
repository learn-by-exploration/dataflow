'use strict';

/**
 * DataFlow Plugin Adapter for Synclyf Monolith.
 *
 * Wraps all DataFlow routes into a plugin interface.
 * Route style: RELATIVE paths (/, /:id) mounted with app.use('/api/xxx', ...)
 * The monolith mounts this at /api/df/.
 *
 * Special: DataFlow has a session vault (in-memory key store) and
 * an auth/unlock endpoint for vault key derivation.
 */

const { Router } = require('express');

module.exports = function initPlugin(context) {
  if (!context?.authDb || !context?.config || !context?.logger) {
    throw new Error('DataFlow plugin context incomplete: missing authDb, config, or logger');
  }

  const { authDb, config, logger } = context;

  // ─── Initialize DataFlow's own database ───
  const initDatabase = require('./db');
  const db = initDatabase(config.dataDir);

  // ─── Session vault (in-memory vault key store) ───
  const sessionVault = require('./services/session-vault');

  // ─── Create DataFlow dependencies ───
  const createAuditLogger = require('./services/audit');
  const audit = createAuditLogger(db);
  const createScheduler = require('./scheduler');
  const scheduler = createScheduler(db, logger);
  scheduler.registerBuiltinJobs();

  const deps = { db, dbDir: config.dataDir, audit, sessionVault };

  // ─── Ensure user exists in DataFlow DB ───
  function ensureUser(req, _res, next) {
    if (!req.userId) return next();
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(req.userId);
    if (!existing) {
      const authUser = authDb.prepare('SELECT id, email, display_name, created_at FROM users WHERE id = ?').get(req.userId);
      if (authUser) {
        // DataFlow uses Argon2 for vault encryption, but for the users table
        // we just need a placeholder since auth is handled by the monolith
        db.prepare(
          "INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role, active, created_at) VALUES (?, ?, ?, ?, 'adult', 1, ?)"
        ).run(authUser.id, authUser.email, 'MONOLITH_MANAGED', authUser.display_name || '', authUser.created_at);
      }
    }
    // Set userRole from DataFlow's users table
    const dfUser = db.prepare('SELECT role FROM users WHERE id = ?').get(req.userId);
    if (dfUser) {
      req.userRole = dfUser.role;
    }
    next();
  }

  // ─── Build router with all DataFlow routes ───
  const router = Router();

  // ─── Plugin-mode auth proxy routes ───
  // The standalone routes/auth.js uses absolute paths (/api/auth/xxx) which
  // don't work when mounted as a plugin. Add relative-path adapters here.

  // GET /auth/me — return current user info
  router.get('/auth/me', (req, res) => {
    if (!req.userId) return res.status(401).json({ error: 'Not authenticated' });
    const authUser = authDb.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(req.userId);
    if (!authUser) return res.status(401).json({ error: 'User not found' });
    const dfUser = db.prepare('SELECT role FROM users WHERE id = ?').get(req.userId);
    res.json({ user: { id: authUser.id, email: authUser.email, display_name: authUser.display_name, role: dfUser?.role || 'user' } });
  });

  // GET /auth/session — alias for me
  router.get('/auth/session', (req, res) => {
    if (!req.userId) return res.status(401).json({ error: 'Not authenticated' });
    const authUser = authDb.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(req.userId);
    if (!authUser) return res.status(401).json({ error: 'User not found' });
    const dfUser = db.prepare('SELECT role FROM users WHERE id = ?').get(req.userId);
    res.json({ user: { id: authUser.id, email: authUser.email, display_name: authUser.display_name, role: dfUser?.role || 'user' } });
  });

  // POST /auth/unlock — derive vault key from master password and store in session memory
  router.post('/auth/unlock', async (req, res) => {
    try {
      const { master_password } = req.body;
      if (!master_password) return res.status(400).json({ error: 'master_password is required' });
      const { deriveKey, unwrapVaultKey, zeroBuffer } = require('./services/encryption');
      const authRepo = require('./repositories/auth.repository')(db);
      const user = authRepo.findUserById(req.userId);
      if (!user || !user.vault_key_encrypted) {
        return res.status(400).json({ error: 'No vault key configured. Please set up your vault first.' });
      }
      const salt = Buffer.from(user.master_key_salt, 'hex');
      const params = JSON.parse(user.master_key_params);
      const derivedKey = await deriveKey(master_password, salt, params);
      const wrapped = JSON.parse(user.vault_key_encrypted);
      let vaultKey;
      try {
        vaultKey = unwrapVaultKey(wrapped, derivedKey);
      } catch {
        zeroBuffer(derivedKey);
        return res.status(401).json({ error: 'Invalid master password' });
      }
      sessionVault.setVaultKey(req.sessionId, vaultKey, req.userId);
      zeroBuffer(vaultKey);
      zeroBuffer(derivedKey);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Vault unlock error');
      res.status(500).json({ error: 'Vault unlock failed' });
    }
  });

  // POST /auth/setup-vault — first-time vault setup for monolith-managed users
  router.post('/auth/setup-vault', async (req, res) => {
    try {
      const { master_password } = req.body;
      if (!master_password) return res.status(400).json({ error: 'master_password is required' });
      const authRepo = require('./repositories/auth.repository')(db);
      const user = authRepo.findUserById(req.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.vault_key_encrypted) return res.status(409).json({ error: 'Vault already configured' });
      const crypto = require('crypto');
      const { deriveKey, generateVaultKey, wrapVaultKey, zeroBuffer } = require('./services/encryption');
      const salt = crypto.randomBytes(32);
      const params = { algorithm: 'argon2id', parallelism: 1, iterations: 3, memory: 65536 };
      const derivedKey = await deriveKey(master_password, salt, params);
      const vaultKey = generateVaultKey();
      const wrapped = wrapVaultKey(vaultKey, derivedKey);
      db.prepare(
        'UPDATE users SET master_key_salt = ?, master_key_params = ?, vault_key_encrypted = ? WHERE id = ?'
      ).run(salt.toString('hex'), JSON.stringify(params), JSON.stringify(wrapped), req.userId);
      sessionVault.setVaultKey(req.sessionId, vaultKey, req.userId);
      zeroBuffer(vaultKey);
      zeroBuffer(derivedKey);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Vault setup error');
      res.status(500).json({ error: 'Vault setup failed' });
    }
  });

  // POST /auth/logout — clear vault key from session memory
  router.post('/auth/logout', (req, res) => {
    if (req.sessionId) sessionVault.clearVaultKey(req.sessionId);
    res.json({ ok: true });
  });

  // DataFlow has its own auth/unlock endpoint for vault key derivation
  // This is NOT the login endpoint — it's a vault-specific unlock
  router.use('/auth', require('./routes/auth')(deps));

  // Mount domain routes (relative paths)
  router.use('/health', require('./routes/health')(db));
  router.use('/categories', require('./routes/categories')(db));
  router.use('/record-types', require('./routes/record-types')(db));
  router.use('/items', require('./routes/items')(db, sessionVault));
  router.use('/', require('./routes/attachments')(db, sessionVault));
  router.use('/tags', require('./routes/tags')(db));
  router.use('/settings', require('./routes/settings')(db));
  router.use('/members', require('./routes/members')(db));
  router.use('/shared', require('./routes/sharing')(db));
  router.use('/emergency', require('./routes/emergency')(db));
  router.use('/audit', require('./routes/audit')(db));
  router.use('/', require('./routes/password-generator')());
  router.use('/stats', require('./routes/stats')(db));
  router.use('/security', require('./routes/security')(db));
  router.use('/data', require('./routes/data')(db, sessionVault));
  router.use('/share-links', require('./routes/share-links')(db));
  router.use('/templates', require('./routes/templates')(db));

  return {
    name: 'dataflow',
    router,
    ensureUser,
    scheduler,

    healthCheck() {
      try {
        db.prepare('SELECT 1').get();
        const integ = db.pragma('integrity_check');
        const ok = integ && integ[0] && integ[0].integrity_check === 'ok';
        return { status: ok ? 'ok' : 'degraded' };
      } catch (err) {
        return { status: 'error', message: err.message };
      }
    },

    shutdown() {
      if (scheduler) {
        scheduler.stop();
      }

      // Clear all vault keys from memory
      sessionVault.clearAll();

      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.close();
      } catch (err) {
        logger.error({ err, plugin: 'dataflow' }, 'DB close error');
        try { db.close(); } catch (_closeErr) { /* best-effort close */ }
      }
    },
  };
};
