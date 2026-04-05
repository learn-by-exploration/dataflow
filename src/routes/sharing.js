'use strict';

const { Router } = require('express');
const createSharingRepo = require('../repositories/sharing.repository');

module.exports = function createSharingRoutes(db) {
  const router = Router();
  const sharingRepo = createSharingRepo(db);

  // GET /api/shared/items — items shared with current user
  router.get('/items', (req, res, next) => {
    try {
      const items = sharingRepo.getSharedItems(req.userId);
      res.json(items.map(i => ({ ...i, shared: true })));
    } catch (err) { next(err); }
  });

  // GET /api/shared/categories — categories shared with current user
  router.get('/categories', (req, res, next) => {
    try {
      const categories = sharingRepo.getSharedCategories(req.userId);
      res.json(categories.map(c => ({ ...c, shared: true })));
    } catch (err) { next(err); }
  });

  return router;
};
