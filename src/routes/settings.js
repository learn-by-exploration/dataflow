'use strict';

const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');

const settingKeyParam = z.object({
  key: z.string().min(1).max(100),
});

const settingValueSchema = z.object({
  value: z.string(),
});

module.exports = function createSettingsRoutes(db) {
  const router = Router();

  // GET /api/settings
  router.get('/', (req, res, next) => {
    try {
      const rows = db.prepare('SELECT key, value FROM settings WHERE user_id = ?').all(req.userId);
      const settings = {};
      for (const row of rows) {
        settings[row.key] = row.value;
      }
      res.json(settings);
    } catch (err) { next(err); }
  });

  // PUT /api/settings/:key
  router.put('/:key', validate({ params: settingKeyParam, body: settingValueSchema }), (req, res, next) => {
    try {
      db.prepare(
        'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value'
      ).run(req.userId, req.params.key, req.body.value);
      res.json({ key: req.params.key, value: req.body.value });
    } catch (err) { next(err); }
  });

  // DELETE /api/settings/:key
  router.delete('/:key', validate({ params: settingKeyParam }), (req, res, next) => {
    try {
      db.prepare('DELETE FROM settings WHERE user_id = ? AND key = ?').run(req.userId, req.params.key);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
};
