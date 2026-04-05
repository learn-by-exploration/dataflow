'use strict';

const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { requireRole } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const { inviteSchema, updateMemberSchema } = require('../schemas/member.schema');
const { idParam } = require('../schemas/common.schema');
const { deriveKey, generateVaultKey, wrapVaultKey, zeroBuffer } = require('../services/encryption');
const createAuditLogger = require('../services/audit');
const { ConflictError, NotFoundError, ForbiddenError } = require('../errors');

module.exports = function createMemberRoutes(db) {
  const router = Router();
  const audit = createAuditLogger(db);

  // GET / — list all members
  router.get('/', (req, res, next) => {
    try {
      if (['admin', 'adult'].includes(req.userRole)) {
        const members = db.prepare(
          'SELECT id, email, display_name, role, active, created_at FROM users ORDER BY id ASC'
        ).all();
        res.json(members);
      } else {
        const members = db.prepare(
          'SELECT id, display_name, role FROM users ORDER BY id ASC'
        ).all();
        res.json(members);
      }
    } catch (err) { next(err); }
  });

  // POST /invite — admin only
  router.post('/invite', requireRole('admin'), validate({ body: inviteSchema }), async (req, res, next) => {
    try {
      const { email, display_name, role, password, master_password } = req.body;

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) throw new ConflictError('Email already registered');

      const passwordHash = await bcrypt.hash(password, config.isTest ? 4 : config.auth.saltRounds);

      const salt = crypto.randomBytes(32);
      const params = {
        memoryCost: config.isTest ? 1024 : config.argon2.memoryCost,
        timeCost: config.isTest ? 1 : config.argon2.timeCost,
        parallelism: config.argon2.parallelism,
      };
      const derivedKey = await deriveKey(master_password, salt, params);
      const vaultKey = generateVaultKey();
      const wrapped = wrapVaultKey(vaultKey, derivedKey);

      const result = db.prepare(
        `INSERT INTO users (email, password_hash, display_name, role, master_key_salt, master_key_params, vault_key_encrypted, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      ).run(email, passwordHash, display_name, role,
        salt.toString('hex'), JSON.stringify(params), JSON.stringify(wrapped));

      zeroBuffer(derivedKey);
      zeroBuffer(vaultKey);

      audit.log({
        userId: req.userId,
        action: 'member.invite',
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
        active: 1,
      });
    } catch (err) { next(err); }
  });

  // GET /:id — get member profile
  router.get('/:id', validate({ params: idParam }), (req, res, next) => {
    try {
      const member = db.prepare(
        'SELECT id, email, display_name, role, active, created_at FROM users WHERE id = ?'
      ).get(req.params.id);
      if (!member) throw new NotFoundError('Member', req.params.id);
      res.json(member);
    } catch (err) { next(err); }
  });

  // PUT /:id — update member
  router.put('/:id', validate({ params: idParam, body: updateMemberSchema }), (req, res, next) => {
    try {
      const memberId = req.params.id;
      const member = db.prepare('SELECT id, role FROM users WHERE id = ?').get(memberId);
      if (!member) throw new NotFoundError('Member', memberId);

      const updates = {};

      if (req.body.role !== undefined) {
        if (req.userRole !== 'admin') throw new ForbiddenError('Only admin can change roles');
        updates.role = req.body.role;
      }

      if (req.body.display_name !== undefined) {
        if (req.userId !== memberId && req.userRole !== 'admin') {
          throw new ForbiddenError('Cannot update another member\'s profile');
        }
        updates.display_name = req.body.display_name;
      }

      const fields = [];
      const values = [];
      for (const [key, val] of Object.entries(updates)) {
        fields.push(`${key} = ?`);
        values.push(val);
      }

      if (fields.length > 0) {
        fields.push("updated_at = datetime('now')");
        values.push(memberId);
        db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      }

      const updated = db.prepare(
        'SELECT id, email, display_name, role, active, created_at FROM users WHERE id = ?'
      ).get(memberId);
      res.json(updated);
    } catch (err) { next(err); }
  });

  // PUT /:id/deactivate — admin only
  router.put('/:id/deactivate', requireRole('admin'), validate({ params: idParam }), (req, res, next) => {
    try {
      const memberId = req.params.id;
      const member = db.prepare('SELECT id FROM users WHERE id = ?').get(memberId);
      if (!member) throw new NotFoundError('Member', memberId);

      if (memberId === req.userId) throw new ForbiddenError('Cannot deactivate yourself');

      db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(memberId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(memberId);

      audit.log({
        userId: req.userId,
        action: 'member.deactivate',
        resource: 'user',
        resourceId: memberId,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      const updated = db.prepare(
        'SELECT id, email, display_name, role, active, created_at FROM users WHERE id = ?'
      ).get(memberId);
      res.json(updated);
    } catch (err) { next(err); }
  });

  // PUT /:id/activate — admin only
  router.put('/:id/activate', requireRole('admin'), validate({ params: idParam }), (req, res, next) => {
    try {
      const memberId = req.params.id;
      const member = db.prepare('SELECT id FROM users WHERE id = ?').get(memberId);
      if (!member) throw new NotFoundError('Member', memberId);

      db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(memberId);

      audit.log({
        userId: req.userId,
        action: 'member.activate',
        resource: 'user',
        resourceId: memberId,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      const updated = db.prepare(
        'SELECT id, email, display_name, role, active, created_at FROM users WHERE id = ?'
      ).get(memberId);
      res.json(updated);
    } catch (err) { next(err); }
  });

  // DELETE /:id — admin only, hard delete + cascade
  router.delete('/:id', requireRole('admin'), validate({ params: idParam }), (req, res, next) => {
    try {
      const memberId = req.params.id;
      const member = db.prepare('SELECT id FROM users WHERE id = ?').get(memberId);
      if (!member) throw new NotFoundError('Member', memberId);

      if (memberId === req.userId) throw new ForbiddenError('Cannot delete yourself');

      db.prepare('DELETE FROM users WHERE id = ?').run(memberId);

      audit.log({
        userId: req.userId,
        action: 'member.delete',
        resource: 'user',
        resourceId: memberId,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
};
