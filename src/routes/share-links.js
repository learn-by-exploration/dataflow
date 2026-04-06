'use strict';

const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const createShareLinkService = require('../services/share-link.service');
const createAuditLogger = require('../services/audit');
const { NotFoundError } = require('../errors');

const createShareLinkSchema = z.object({
  item_id: z.number().int().positive(),
  expiresIn: z.number().positive().optional(),
  oneTimeUse: z.boolean().optional(),
  passphrase: z.string().min(1).max(200).optional(),
});

module.exports = function createShareLinkRoutes(db) {
  const router = Router();
  const service = createShareLinkService(db);
  const audit = createAuditLogger(db);

  // POST /api/share-links — create share link (authenticated)
  router.post('/', validate({ body: createShareLinkSchema }), (req, res, next) => {
    try {
      const { item_id, expiresIn, oneTimeUse, passphrase } = req.body;

      // Verify item belongs to user
      const item = db.prepare('SELECT id FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(item_id, req.userId);
      if (!item) throw new NotFoundError('Item', item_id);

      const link = service.createShareLink(item_id, req.userId, { expiresIn, oneTimeUse, passphrase });

      audit.log({ userId: req.userId, action: 'share_link.create', resource: 'share_link', resourceId: link.id });

      res.status(201).json(link);
    } catch (err) { next(err); }
  });

  // GET /api/share-links/:token — resolve share link without passphrase (unauthenticated)
  router.get('/:token', (req, res, next) => {
    try {
      const { token } = req.params;
      if (!token || token.length !== 64) {
        return res.status(400).json({ error: 'Invalid token' });
      }

      const result = service.resolveShareLink(token, null);

      if (result.error) {
        const statusMap = {
          not_found: 404,
          expired: 410,
          already_used: 410,
          passphrase_required: 401,
          wrong_passphrase: 403,
          item_not_found: 404,
        };
        return res.status(statusMap[result.error] || 400).json({ error: result.error });
      }

      res.json({ item: result.item });
    } catch (err) { next(err); }
  });

  // POST /api/share-links/:token/resolve — resolve share link with passphrase in body (unauthenticated)
  router.post('/:token/resolve', (req, res, next) => {
    try {
      const { token } = req.params;
      if (!token || token.length !== 64) {
        return res.status(400).json({ error: 'Invalid token' });
      }

      const passphrase = (req.body && req.body.passphrase) || null;
      const result = service.resolveShareLink(token, passphrase);

      if (result.error) {
        const statusMap = {
          not_found: 404,
          expired: 410,
          already_used: 410,
          passphrase_required: 401,
          wrong_passphrase: 403,
          item_not_found: 404,
        };
        return res.status(statusMap[result.error] || 400).json({ error: result.error });
      }

      res.json({ item: result.item });
    } catch (err) { next(err); }
  });

  return router;
};
