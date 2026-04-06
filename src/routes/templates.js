'use strict';

const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const createTemplateService = require('../services/template.service');
const { idParam } = require('../schemas/common.schema');

const createTemplateSchema = z.object({
  item_id: z.number().int().positive(),
  name: z.string().min(1).max(200),
});

module.exports = function createTemplateRoutes(db) {
  const router = Router();
  const service = createTemplateService(db);

  // POST /api/templates — create template from item
  router.post('/', validate({ body: createTemplateSchema }), (req, res, next) => {
    try {
      const tpl = service.createFromItem(req.body.item_id, req.userId, req.body.name);
      res.status(201).json(tpl);
    } catch (err) { next(err); }
  });

  // GET /api/templates — list templates
  router.get('/', (req, res, next) => {
    try {
      const templates = service.listTemplates(req.userId);
      res.json(templates);
    } catch (err) { next(err); }
  });

  // GET /api/templates/:id — get template
  router.get('/:id', validate({ params: idParam }), (req, res, next) => {
    try {
      const tpl = service.getTemplate(req.params.id, req.userId);
      res.json(tpl);
    } catch (err) { next(err); }
  });

  // DELETE /api/templates/:id — delete template
  router.delete('/:id', validate({ params: idParam }), (req, res, next) => {
    try {
      service.deleteTemplate(req.params.id, req.userId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
};
