'use strict';

const { Router } = require('express');
const createTagRepo = require('../repositories/tag.repository');
const validate = require('../middleware/validate');
const { createTagSchema, updateTagSchema } = require('../schemas/tag.schema');
const { idParam } = require('../schemas/common.schema');

module.exports = function createTagRoutes(db) {
  const router = Router();
  const tagRepo = createTagRepo(db);

  // GET /api/tags
  router.get('/', (req, res, next) => {
    try {
      const tags = tagRepo.findAll(req.userId);
      res.json(tags);
    } catch (err) { next(err); }
  });

  // POST /api/tags
  router.post('/', validate({ body: createTagSchema }), (req, res, next) => {
    try {
      const tag = tagRepo.create(req.userId, req.body.name, req.body.color);
      res.status(201).json(tag);
    } catch (err) { next(err); }
  });

  // GET /api/tags/usage — BEFORE /:id
  router.get('/usage', (req, res, next) => {
    try {
      const usage = tagRepo.usageCounts(req.userId);
      res.json(usage);
    } catch (err) { next(err); }
  });

  // PUT /api/tags/:id
  router.put('/:id', validate({ params: idParam, body: updateTagSchema }), (req, res, next) => {
    try {
      const tag = tagRepo.update(req.params.id, req.userId, req.body.name || null, req.body.color || null);
      res.json(tag);
    } catch (err) { next(err); }
  });

  // DELETE /api/tags/:id
  router.delete('/:id', validate({ params: idParam }), (req, res, next) => {
    try {
      tagRepo.delete(req.params.id, req.userId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
};
