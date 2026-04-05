'use strict';

const { Router } = require('express');
const createRecordTypeService = require('../services/record-type.service');
const createAuditLogger = require('../services/audit');
const validate = require('../middleware/validate');
const { createRecordTypeSchema, updateRecordTypeSchema, addFieldSchema, updateFieldSchema } = require('../schemas/record-type.schema');
const { idParam, reorderSchema } = require('../schemas/common.schema');
const { z } = require('zod');

const fieldIdParams = z.object({
  id: z.coerce.number().int().positive(),
  fieldId: z.coerce.number().int().positive(),
});

module.exports = function createRecordTypeRoutes(db) {
  const router = Router();
  const audit = createAuditLogger(db);
  const service = createRecordTypeService(db, audit);

  // GET /api/record-types
  router.get('/', (req, res, next) => {
    try {
      const types = service.findAll(req.userId);
      res.json(types);
    } catch (err) { next(err); }
  });

  // POST /api/record-types
  router.post('/', validate({ body: createRecordTypeSchema }), (req, res, next) => {
    try {
      const rt = service.create(req.userId, req.body);
      res.status(201).json(rt);
    } catch (err) { next(err); }
  });

  // GET /api/record-types/:id
  router.get('/:id', validate({ params: idParam }), (req, res, next) => {
    try {
      const rt = service.findById(req.params.id);
      const fields = service.findFields(req.params.id);
      res.json({ ...rt, fields });
    } catch (err) { next(err); }
  });

  // PUT /api/record-types/:id
  router.put('/:id', validate({ params: idParam, body: updateRecordTypeSchema }), (req, res, next) => {
    try {
      const rt = service.update(req.params.id, req.userId, req.body);
      res.json(rt);
    } catch (err) { next(err); }
  });

  // DELETE /api/record-types/:id
  router.delete('/:id', validate({ params: idParam }), (req, res, next) => {
    try {
      service.delete(req.params.id, req.userId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // POST /api/record-types/:id/fields
  router.post('/:id/fields', validate({ params: idParam, body: addFieldSchema }), (req, res, next) => {
    try {
      const field = service.addField(req.params.id, req.body);
      res.status(201).json(field);
    } catch (err) { next(err); }
  });

  // PUT /api/record-types/:id/fields/reorder — BEFORE /:fieldId
  router.put('/:id/fields/reorder', validate({ params: idParam, body: reorderSchema }), (req, res, next) => {
    try {
      service.reorderFields(req.params.id, req.body.ids);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // PUT /api/record-types/:id/fields/:fieldId
  router.put('/:id/fields/:fieldId', validate({ params: fieldIdParams, body: updateFieldSchema }), (req, res, next) => {
    try {
      const field = service.updateField(req.params.fieldId, req.body);
      res.json(field);
    } catch (err) { next(err); }
  });

  // DELETE /api/record-types/:id/fields/:fieldId
  router.delete('/:id/fields/:fieldId', validate({ params: fieldIdParams }), (req, res, next) => {
    try {
      service.deleteField(req.params.fieldId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
};
