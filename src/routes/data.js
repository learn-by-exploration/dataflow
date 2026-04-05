'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const createItemService = require('../services/item.service');
const createAuditLogger = require('../services/audit');
const { createBackup, getBackups } = require('../services/backup');

const importers = {
  bitwarden: require('../services/importers/bitwarden'),
  chrome: require('../services/importers/chrome'),
  lastpass: require('../services/importers/lastpass'),
  onepassword: require('../services/importers/onepassword'),
  keepass: require('../services/importers/keepass'),
};

module.exports = function createDataRoutes(db, sessionVault) {
  const router = Router();
  const audit = createAuditLogger(db);
  const service = createItemService(db, audit);

  const uploadDir = path.join(config.dbDir, 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  function getVaultKey(req, res) {
    const vaultKey = sessionVault.getVaultKey(req.sessionId);
    if (!vaultKey) {
      res.status(401).json({ error: 'Vault locked. Please log in again.' });
      return null;
    }
    return vaultKey;
  }

  // POST /api/data/import
  router.post('/import', upload.single('file'), (req, res, next) => {
    try {
      const vaultKey = getVaultKey(req, res);
      if (!vaultKey) return;

      const format = req.body.format;
      if (!format || !importers[format]) {
        return res.status(400).json({ error: `Unsupported import format: ${format}. Supported: ${Object.keys(importers).join(', ')}` });
      }

      let content;
      if (req.file) {
        content = fs.readFileSync(req.file.path, 'utf8');
        // Clean up temp file
        try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      } else if (req.body.data) {
        content = req.body.data;
      } else {
        return res.status(400).json({ error: 'No file or data provided' });
      }

      const items = importers[format].parse(content);
      let imported = 0;

      for (const item of items) {
        const fields = (item.fields || []).map(f => ({
          field_def_id: null,
          value: f.value || '',
        }));

        service.create(req.userId, vaultKey, {
          title: item.title || 'Untitled',
          notes: item.notes || null,
          category_id: null,
          record_type_id: null,
          fields,
          tags: [],
          favorite: item.favorite || false,
        });
        imported++;
      }

      audit.log({ userId: req.userId, action: 'data.import', resource: 'data', detail: JSON.stringify({ format, count: imported }) });
      res.json({ imported, total: items.length });
    } catch (err) { next(err); }
  });

  // GET /api/data/export
  router.get('/export', (req, res, next) => {
    try {
      const vaultKey = getVaultKey(req, res);
      if (!vaultKey) return;

      const items = service.findAll(req.userId, vaultKey, { limit: 10000, page: 1 });
      const exportData = {
        version: '1.0',
        exported_at: new Date().toISOString(),
        items: items.map(item => ({
          title: item.title,
          notes: item.notes,
          favorite: !!item.favorite,
          fields: (item.fields || []).map(f => ({
            name: f.name || '',
            value: f.value || '',
            field_type: f.field_type || 'text',
          })),
          tags: item.tags || [],
        })),
      };

      audit.log({ userId: req.userId, action: 'data.export', resource: 'data', detail: JSON.stringify({ count: items.length }) });
      res.json(exportData);
    } catch (err) { next(err); }
  });

  // POST /api/data/backup
  router.post('/backup', (req, res, next) => {
    try {
      const backupDir = path.join(config.dbDir, 'backups');
      const backupPath = createBackup(db, backupDir);
      audit.log({ userId: req.userId, action: 'data.backup', resource: 'data' });
      res.json({ path: backupPath, created: new Date().toISOString() });
    } catch (err) { next(err); }
  });

  // GET /api/data/backups
  router.get('/backups', (req, res, next) => {
    try {
      const backupDir = path.join(config.dbDir, 'backups');
      const backups = getBackups(backupDir);
      res.json(backups);
    } catch (err) { next(err); }
  });

  return router;
};
