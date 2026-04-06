'use strict';

const { Router } = require('express');
const createItemService = require('../services/item.service');
const createAuditLogger = require('../services/audit');
const createSharingRepo = require('../repositories/sharing.repository');
const validate = require('../middleware/validate');
const { createItemSchema, updateItemSchema, bulkItemSchema } = require('../schemas/item.schema');
const { shareItemSchema } = require('../schemas/sharing.schema');
const { idParam, reorderSchema } = require('../schemas/common.schema');
const { NotFoundError, ForbiddenError } = require('../errors');
const { z } = require('zod');

const itemQuerySchema = z.object({
  category_id: z.coerce.number().int().positive().optional(),
  record_type_id: z.coerce.number().int().positive().optional(),
  tag_id: z.coerce.number().int().positive().optional(),
  favorite: z.enum(['true', 'false', '1', '0']).optional().transform(v => v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : undefined),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['position', 'created', 'updated', 'title']).optional(),
});

const reorderItemsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  category_id: z.number().int().positive(),
});

module.exports = function createItemRoutes(db, sessionVault) {
  const router = Router();
  const audit = createAuditLogger(db);
  const service = createItemService(db, audit);
  const sharingRepo = createSharingRepo(db);
  const createItemRepo = require('../repositories/item.repository');
  const createAuthRepo = require('../repositories/auth.repository');
  const itemRepo = createItemRepo(db);
  const authRepo = createAuthRepo(db);

  function getVaultKey(req, res) {
    const vaultKey = sessionVault.getVaultKey(req.sessionId);
    if (!vaultKey) {
      res.status(401).json({ error: 'Vault locked. Please log in again.' });
      return null;
    }
    return vaultKey;
  }

  // GET /api/items
  router.get('/', (req, res, next) => {
    try {
      const vaultKey = getVaultKey(req, res);
      if (!vaultKey) return;
      const parsed = itemQuerySchema.parse(req.query);
      const items = service.findAll(req.userId, vaultKey, parsed);
      const sharedItems = sharingRepo.getSharedItems(req.userId);
      const allItems = [
        ...items,
        ...sharedItems.map(i => ({ ...i, shared: true })),
      ];
      res.json(allItems);
    } catch (err) { next(err); }
  });

  // POST /api/items
  router.post('/', validate({ body: createItemSchema }), (req, res, next) => {
    try {
      const vaultKey = getVaultKey(req, res);
      if (!vaultKey) return;
      const item = service.create(req.userId, vaultKey, req.body);
      res.status(201).json(item);
    } catch (err) { next(err); }
  });

  // POST /api/items/bulk — BEFORE /:id
  router.post('/bulk', validate({ body: bulkItemSchema }), (req, res, next) => {
    try {
      const { ids, action, category_id } = req.body;
      if (action === 'delete') {
        service.bulkDelete(req.userId, ids);
      } else if (action === 'move') {
        service.bulkMove(req.userId, ids, category_id);
      }
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // GET /api/items/count — BEFORE /:id
  router.get('/count', (req, res, next) => {
    try {
      const count = service.countByUser(req.userId);
      res.json({ count });
    } catch (err) { next(err); }
  });

  // GET /api/items/recent — BEFORE /:id
  router.get('/recent', (req, res, next) => {
    try {
      const vaultKey = getVaultKey(req, res);
      if (!vaultKey) return;
      const items = service.findAll(req.userId, vaultKey, { sort: 'updated', limit: 10, page: 1 });
      res.json(items);
    } catch (err) { next(err); }
  });

  // PUT /api/items/reorder — BEFORE /:id
  router.put('/reorder', validate({ body: reorderItemsSchema }), (req, res, next) => {
    try {
      itemRepo.reorder(req.userId, req.body.category_id, req.body.ids);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // GET /api/items/:id
  router.get('/:id', validate({ params: idParam }), (req, res, next) => {
    try {
      const vaultKey = getVaultKey(req, res);
      if (!vaultKey) return;

      // Try as owner first
      if (itemRepo.existsForUser(req.params.id, req.userId)) {
        const item = service.findById(req.params.id, req.userId, vaultKey);
        return res.json(item);
      }

      // Check if shared
      const shared = sharingRepo.isItemSharedWith(req.params.id, req.userId);
      if (shared) {
        const item = itemRepo.findByIdRaw(req.params.id);
        if (!item) throw new NotFoundError('Item', req.params.id);

        // Try to decrypt using the owner's vault key
        const ownerVaultKey = sessionVault.getVaultKeyByUserId(item.user_id);
        if (ownerVaultKey) {
          const decrypted = service.findById(req.params.id, item.user_id, ownerVaultKey);
          return res.json({ ...decrypted, shared: true, permission: shared.permission });
        }
        // Owner offline — cannot decrypt
        return res.json({
          id: item.id,
          user_id: item.user_id,
          category_id: item.category_id,
          record_type_id: item.record_type_id,
          favorite: item.favorite,
          position: item.position,
          created_at: item.created_at,
          updated_at: item.updated_at,
          shared: true,
          permission: shared.permission,
          encrypted: true,
          error: "Owner's vault is locked. Item cannot be decrypted.",
        });
      }

      throw new NotFoundError('Item', req.params.id);
    } catch (err) { next(err); }
  });

  // PUT /api/items/:id
  router.put('/:id', validate({ params: idParam, body: updateItemSchema }), (req, res, next) => {
    try {
      const vaultKey = getVaultKey(req, res);
      if (!vaultKey) return;

      // Try as owner
      if (itemRepo.existsForUser(req.params.id, req.userId)) {
        const item = service.update(req.params.id, req.userId, vaultKey, req.body);
        return res.json(item);
      }

      // Check shared with write
      const shared = sharingRepo.isItemSharedWith(req.params.id, req.userId);
      if (shared && shared.permission === 'write') {
        const item = itemRepo.findByIdRaw(req.params.id);
        if (!item) throw new NotFoundError('Item', req.params.id);
        const updates = {};
        if (req.body.favorite !== undefined) {
          updates.favorite = req.body.favorite ? 1 : 0;
        }
        if (req.body.category_id !== undefined) {
          updates.category_id = req.body.category_id;
        }
        if (Object.keys(updates).length > 0) {
          itemRepo.updatePartial(req.params.id, updates);
        }
        const updated = itemRepo.findByIdRaw(req.params.id);
        return res.json({ ...updated, shared: true, permission: 'write' });
      }

      if (shared) {
        throw new ForbiddenError('Read-only access');
      }

      throw new NotFoundError('Item', req.params.id);
    } catch (err) { next(err); }
  });

  // DELETE /api/items/:id
  router.delete('/:id', validate({ params: idParam }), (req, res, next) => {
    try {
      service.delete(req.params.id, req.userId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // PUT /api/items/:id/favorite
  router.put('/:id/favorite', validate({ params: idParam }), (req, res, next) => {
    try {
      const vaultKey = getVaultKey(req, res);
      if (!vaultKey) return;
      // Toggle: get current, flip it
      const current = service.findById(req.params.id, req.userId, vaultKey);
      const item = service.update(req.params.id, req.userId, vaultKey, { favorite: !current.favorite });
      res.json(item);
    } catch (err) { next(err); }
  });

  // ─── Sharing sub-routes ───

  // POST /api/items/:id/share
  router.post('/:id/share', validate({ params: idParam, body: shareItemSchema }), (req, res, next) => {
    try {
      const itemId = req.params.id;
      const { user_id: sharedWith, permission } = req.body;

      const item = itemRepo.findByIdRaw(itemId);
      if (!item) throw new NotFoundError('Item', itemId);
      if (item.user_id !== req.userId && req.userRole !== 'admin') {
        throw new ForbiddenError('Only the owner or admin can share items');
      }
      if (sharedWith === item.user_id) {
        return res.status(400).json({ error: 'Cannot share an item with its owner' });
      }
      const targetUser = authRepo.findUserBasic(sharedWith);
      if (!targetUser) throw new NotFoundError('User', sharedWith);

      const share = sharingRepo.shareItem(itemId, req.userId, sharedWith, permission);

      audit.log({
        userId: req.userId,
        action: 'item.share',
        resource: 'item',
        resourceId: itemId,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.status(201).json(share);
    } catch (err) { next(err); }
  });

  // DELETE /api/items/:id/share/:shareUserId
  router.delete('/:id/share/:shareUserId', (req, res, next) => {
    try {
      const itemId = Number(req.params.id);
      const shareUserId = Number(req.params.shareUserId);

      const item = itemRepo.findByIdRaw(itemId);
      if (!item) throw new NotFoundError('Item', itemId);
      if (item.user_id !== req.userId && req.userRole !== 'admin') {
        throw new ForbiddenError('Only the owner or admin can revoke shares');
      }

      sharingRepo.unshareItem(itemId, shareUserId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // GET /api/items/:id/shares
  router.get('/:id/shares', (req, res, next) => {
    try {
      const itemId = Number(req.params.id);
      const item = itemRepo.findByIdRaw(itemId);
      if (!item) throw new NotFoundError('Item', itemId);
      if (item.user_id !== req.userId && req.userRole !== 'admin') {
        throw new ForbiddenError('Only the owner or admin can view shares');
      }

      const shares = sharingRepo.getItemShares(itemId);
      res.json(shares);
    } catch (err) { next(err); }
  });

  return router;
};
