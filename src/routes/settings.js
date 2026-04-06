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
  const createSettingsService = require('../services/settings.service');
  const service = createSettingsService(db);

  // GET /api/settings
  router.get('/', (req, res, next) => {
    try {
      res.json(service.findAll(req.userId));
    } catch (err) { next(err); }
  });

  // PUT /api/settings/:key
  router.put('/:key', validate({ params: settingKeyParam, body: settingValueSchema }), (req, res, next) => {
    try {
      res.json(service.upsert(req.userId, req.params.key, req.body.value));
    } catch (err) { next(err); }
  });

  // DELETE /api/settings/:key
  router.delete('/:key', validate({ params: settingKeyParam }), (req, res, next) => {
    try {
      service.delete(req.userId, req.params.key);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
};
