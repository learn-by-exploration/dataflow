'use strict';

const { Router } = require('express');
const createCategoryService = require('../services/category.service');
const createAuditLogger = require('../services/audit');
const createSharingRepo = require('../repositories/sharing.repository');
const validate = require('../middleware/validate');
const { createCategorySchema, updateCategorySchema } = require('../schemas/category.schema');
const { shareItemSchema } = require('../schemas/sharing.schema');
const { idParam, reorderSchema } = require('../schemas/common.schema');
const { NotFoundError, ForbiddenError } = require('../errors');
const createCategoryRepo = require('../repositories/category.repository');
const createAuthRepo = require('../repositories/auth.repository');

module.exports = function createCategoryRoutes(db) {
  const router = Router();
  const audit = createAuditLogger(db);
  const service = createCategoryService(db, audit);
  const sharingRepo = createSharingRepo(db);
  const categoryRepo = createCategoryRepo(db);
  const authRepo = createAuthRepo(db);

  // GET /api/categories
  router.get('/', (req, res, next) => {
    try {
      const categories = service.findAll(req.userId);
      res.json(categories);
    } catch (err) { next(err); }
  });

  // POST /api/categories
  router.post('/', validate({ body: createCategorySchema }), (req, res, next) => {
    try {
      const category = service.create(req.userId, req.body);
      res.status(201).json(category);
    } catch (err) { next(err); }
  });

  // PUT /api/categories/reorder — MUST be before /:id
  router.put('/reorder', validate({ body: reorderSchema }), (req, res, next) => {
    try {
      service.reorder(req.userId, req.body.ids);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // GET /api/categories/:id
  router.get('/:id', validate({ params: idParam }), (req, res, next) => {
    try {
      const category = service.findById(req.params.id, req.userId);
      res.json(category);
    } catch (err) { next(err); }
  });

  // PUT /api/categories/:id
  router.put('/:id', validate({ params: idParam, body: updateCategorySchema }), (req, res, next) => {
    try {
      const category = service.update(req.params.id, req.userId, req.body);
      res.json(category);
    } catch (err) { next(err); }
  });

  // DELETE /api/categories/:id
  router.delete('/:id', validate({ params: idParam }), (req, res, next) => {
    try {
      service.delete(req.params.id, req.userId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // ─── Sharing sub-routes ───

  // POST /api/categories/:id/share
  router.post('/:id/share', validate({ params: idParam, body: shareItemSchema }), (req, res, next) => {
    try {
      const catId = req.params.id;
      const { user_id: sharedWith, permission } = req.body;

      const cat = categoryRepo.findByIdRaw(catId);
      if (cat.user_id !== req.userId && req.userRole !== 'admin') {
        throw new ForbiddenError('Only the owner or admin can share categories');
      }
      if (sharedWith === cat.user_id) {
        return res.status(400).json({ error: 'Cannot share a category with its owner' });
      }
      const targetUser = authRepo.findUserBasic(sharedWith);
      if (!targetUser) throw new NotFoundError('User', sharedWith);

      const share = sharingRepo.shareCategory(catId, req.userId, sharedWith, permission);

      audit.log({
        userId: req.userId,
        action: 'category.share',
        resource: 'category',
        resourceId: catId,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.status(201).json(share);
    } catch (err) { next(err); }
  });

  // DELETE /api/categories/:id/share/:shareUserId
  router.delete('/:id/share/:shareUserId', (req, res, next) => {
    try {
      const catId = Number(req.params.id);
      const shareUserId = Number(req.params.shareUserId);

      const cat = categoryRepo.findByIdRaw(catId);
      if (cat.user_id !== req.userId && req.userRole !== 'admin') {
        throw new ForbiddenError('Only the owner or admin can revoke shares');
      }

      sharingRepo.unshareCategory(catId, shareUserId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // GET /api/categories/:id/shares
  router.get('/:id/shares', (req, res, next) => {
    try {
      const catId = Number(req.params.id);
      const cat = categoryRepo.findByIdRaw(catId);
      if (cat.user_id !== req.userId && req.userRole !== 'admin') {
        throw new ForbiddenError('Only the owner or admin can view shares');
      }

      const shares = sharingRepo.getCategoryShares(catId);
      res.json(shares);
    } catch (err) { next(err); }
  });

  return router;
};
