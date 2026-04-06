'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const breachService = require('../services/breach.service');
const totpService = require('../services/totp.service');
const createSecurityService = require('../services/security.service');
const sessionVault = require('../services/session-vault');
const createItemFieldRepo = require('../repositories/item-field.repository');
const { decrypt } = require('../services/encryption');

const HEX5_RE = /^[0-9a-fA-F]{5}$/;

module.exports = function createSecurityRoutes(db) {
  const router = Router();
  const securityService = createSecurityService(db);
  const fieldRepo = createItemFieldRepo(db);

  // Rate limit: 10/min per user for breach checks
  const breachLimiter = config.isTest ? (_req, _res, next) => next() : rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.userId || req.ip,
    message: { error: 'Too many breach check requests, please try again later' },
  });

  // GET /api/security/breach-check/:prefix
  router.get('/breach-check/:prefix', breachLimiter, async (req, res, next) => {
    try {
      const { prefix } = req.params;
      if (!HEX5_RE.test(prefix)) {
        return res.status(400).json({ error: 'Prefix must be exactly 5 hex characters' });
      }
      const results = await breachService.checkPassword(prefix);
      res.json(results);
    } catch (err) { next(err); }
  });

  // POST /api/security/totp/verify
  router.post('/totp/verify', (req, res, next) => {
    try {
      const { code, secret } = req.body;
      if (!code || !secret) {
        return res.status(400).json({ error: 'code and secret are required' });
      }
      const valid = totpService.verifyCode(code, secret);
      res.json({ valid });
    } catch (err) { next(err); }
  });

  // GET /api/security/totp/generate/:itemId/:fieldId
  router.get('/totp/generate/:itemId/:fieldId', (req, res, next) => {
    try {
      const vaultKey = sessionVault.getVaultKey(req.sessionId);
      if (!vaultKey) {
        return res.status(401).json({ error: 'Vault locked' });
      }

      const itemId = parseInt(req.params.itemId, 10);
      const fieldId = parseInt(req.params.fieldId, 10);

      if (!itemId || !fieldId) {
        return res.status(400).json({ error: 'Invalid item or field ID' });
      }

      // Verify item belongs to user
      const item = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(itemId, req.userId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      // Get field
      const field = db.prepare('SELECT * FROM item_fields WHERE id = ? AND item_id = ?').get(fieldId, itemId);
      if (!field) {
        return res.status(404).json({ error: 'Field not found' });
      }

      // Decrypt the field value to get the TOTP secret
      const secret = decrypt(field.value_encrypted, field.value_iv, field.value_tag, vaultKey);

      // Try to parse as otpauth URI first
      let totpSecret = secret;
      let period = 30;
      try {
        const parsed = totpService.parseOtpauthUri(secret);
        totpSecret = parsed.secret;
        period = parsed.period;
      } catch { /* not a URI, use raw secret */ }

      const code = totpService.generateCode(totpSecret);
      const remaining = totpService.getRemainingSeconds(period);

      res.json({ code, remaining, period });
    } catch (err) { next(err); }
  });

  // GET /api/security/reused-passwords
  router.get('/reused-passwords', (req, res, next) => {
    try {
      const vaultKey = sessionVault.getVaultKey(req.sessionId);
      if (!vaultKey) {
        return res.status(401).json({ error: 'Vault locked' });
      }

      const reused = securityService.detectReusedPasswords(req.userId, vaultKey);
      res.json(reused);
    } catch (err) { next(err); }
  });

  return router;
};
