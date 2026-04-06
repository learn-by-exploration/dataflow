'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const createAttachmentService = require('../services/attachment.service');
const createAuditLogger = require('../services/audit');
const createItemRepo = require('../repositories/item.repository');
const validate = require('../middleware/validate');
const { idParam } = require('../schemas/common.schema');
const { z } = require('zod');
const config = require('../config');

const itemIdParam = z.object({
  itemId: z.coerce.number().int().positive(),
});

module.exports = function createAttachmentRoutes(db, sessionVault) {
  const router = Router();
  const audit = createAuditLogger(db);
  const service = createAttachmentService(db, audit);
  const itemRepo = createItemRepo(db);

  // Configure multer for temp uploads
  const uploadDir = path.join(config.dbDir, 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: config.maxAttachmentSize },
  });

  function getVaultKey(req, res) {
    const vaultKey = sessionVault.getVaultKey(req.sessionId);
    if (!vaultKey) {
      res.status(401).json({ error: 'Vault locked. Please log in again.' });
      return null;
    }
    return vaultKey;
  }

  // GET /api/items/:itemId/attachments
  router.get('/items/:itemId/attachments', validate({ params: itemIdParam }), (req, res, next) => {
    try {
      // Verify item belongs to user
      itemRepo.findById(req.params.itemId, req.userId);
      const attachments = service.findByItem(req.params.itemId);
      res.json(attachments);
    } catch (err) { next(err); }
  });

  // POST /api/items/:itemId/attachments
  router.post('/items/:itemId/attachments', upload.single('file'), validate({ params: itemIdParam }), async (req, res, next) => {
    try {
      const vaultKey = getVaultKey(req, res);
      if (!vaultKey) return;
      // Verify item belongs to user
      itemRepo.findById(req.params.itemId, req.userId);
      const attachment = await service.upload(req.userId, req.params.itemId, req.file, vaultKey);
      res.status(201).json(attachment);
    } catch (err) { next(err); }
  });

  // GET /api/attachments/:id
  router.get('/attachments/:id', validate({ params: idParam }), async (req, res, next) => {
    try {
      const vaultKey = getVaultKey(req, res);
      if (!vaultKey) return;
      const { attachment, decryptedPath } = await service.download(req.params.id, req.userId, vaultKey);
      // Sanitize filename: strip directory traversal, control chars, and quotes
      const safeName = (attachment.original_name || 'download')
        .replace(/[/\\]/g, '_')
        .replace(/[\x00-\x1f"]/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.setHeader('Content-Type', attachment.mime_type);
      const stream = fs.createReadStream(decryptedPath);
      stream.pipe(res);
      stream.on('end', () => {
        try { fs.unlinkSync(decryptedPath); } catch { /* ignore */ }
      });
      stream.on('error', () => {
        try { fs.unlinkSync(decryptedPath); } catch { /* ignore */ }
      });
    } catch (err) { next(err); }
  });

  // DELETE /api/attachments/:id
  router.delete('/attachments/:id', validate({ params: idParam }), (req, res, next) => {
    try {
      service.delete(req.params.id, req.userId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
};
