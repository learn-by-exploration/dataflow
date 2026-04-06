'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const createItemService = require('../services/item.service');
const createAuditLogger = require('../services/audit');
const { createBackup, getBackups } = require('../services/backup');
const { createChecksumFile, verifyAllBackups } = require('../services/backup.service');

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

      const format = req.query.format || 'json';
      const categoryIds = req.query.category_ids ? req.query.category_ids.split(',').map(Number).filter(n => !isNaN(n)) : null;
      const itemIds = req.query.item_ids ? req.query.item_ids.split(',').map(Number).filter(n => !isNaN(n)) : null;

      if (format === 'csv') {
        const createExportService = require('../services/export.service');
        const exportService = createExportService(db);
        const options = {};
        if (categoryIds) options.categoryIds = categoryIds;
        if (itemIds) options.itemIds = itemIds;
        const csv = exportService.exportCsv(req.userId, vaultKey, options);
        audit.log({ userId: req.userId, action: 'data.export', resource: 'data', detail: JSON.stringify({ format: 'csv' }) });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="dataflow-export.csv"');
        return res.send(csv);
      }

      if (format === 'pdf') {
        // Return JSON data formatted for client-side rendering
        let items = service.findAll(req.userId, vaultKey, { limit: 10000, page: 1 });
        if (categoryIds) items = items.filter(i => categoryIds.includes(i.category_id));
        if (itemIds) items = items.filter(i => itemIds.includes(i.id));
        const exportData = {
          format: 'pdf',
          exported_at: new Date().toISOString(),
          items: items.map(item => ({
            id: item.id,
            title: item.title,
            notes: item.notes,
            category_id: item.category_id,
            favorite: !!item.favorite,
            fields: (item.fields || []).map(f => ({
              name: f.name || '',
              value: f.value || '',
              field_type: f.field_type || 'text',
            })),
            tags: item.tags || [],
            created_at: item.created_at,
            updated_at: item.updated_at,
          })),
        };
        audit.log({ userId: req.userId, action: 'data.export', resource: 'data', detail: JSON.stringify({ format: 'pdf', count: items.length }) });
        return res.json(exportData);
      }

      // Default: JSON export
      let items = service.findAll(req.userId, vaultKey, { limit: 10000, page: 1 });
      if (categoryIds) items = items.filter(i => categoryIds.includes(i.category_id));
      if (itemIds) items = items.filter(i => itemIds.includes(i.id));
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
  router.post('/backup', async (req, res, next) => {
    try {
      const backupDir = path.join(config.dbDir, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `dataflow-backup-${timestamp}.db`);
      await db.backup(backupPath);
      createChecksumFile(backupPath);
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

  // GET /api/data/backups/verify — admin only
  router.get('/backups/verify', (req, res, next) => {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const backupDir = path.join(config.dbDir, 'backups');
      const results = verifyAllBackups(backupDir);
      const valid = results.filter(r => r.valid).length;
      const invalid = results.filter(r => !r.valid).length;
      res.json({ total: results.length, valid, invalid, results });
    } catch (err) { next(err); }
  });

  // POST /api/data/migrate-encryption
  router.post('/migrate-encryption', (req, res, next) => {
    try {
      const vaultKey = getVaultKey(req, res);
      if (!vaultKey) return;

      // Return all items decrypted for client to re-encrypt
      const items = service.findAll(req.userId, vaultKey, { limit: 10000, page: 1 });

      // Filter out already client-encrypted items (they can't be server-decrypted)
      const serverItems = items.filter(i => !i.client_encrypted);

      // Track progress in settings
      const settingsStmt = db.prepare(
        `INSERT INTO settings (user_id, key, value) VALUES (?, 'encryption_migration_progress', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = ?`
      );
      const progress = JSON.stringify({
        total: serverItems.length,
        started_at: new Date().toISOString(),
        status: 'in_progress',
      });
      settingsStmt.run(req.userId, progress, progress);

      audit.log({ userId: req.userId, action: 'data.migrate_encryption', resource: 'data', detail: JSON.stringify({ count: serverItems.length }) });

      res.json({
        items: serverItems.map(item => ({
          id: item.id,
          title: item.title,
          notes: item.notes,
          fields: (item.fields || []).map(f => ({
            field_def_id: f.field_def_id,
            value: f.value || '',
          })),
          tags: (item.tags || []).map(t => t.id || t),
          favorite: !!item.favorite,
          category_id: item.category_id,
          record_type_id: item.record_type_id,
        })),
        total: serverItems.length,
      });
    } catch (err) { next(err); }
  });

  return router;
};
