'use strict';

const { Router } = require('express');
const { z } = require('zod');
const createAuditRepo = require('../repositories/audit.repository');
const { requireRole } = require('../middleware/rbac');
const validate = require('../middleware/validate');

const auditQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().optional(),
  resource: z.string().optional(),
  user_id: z.coerce.number().int().positive().optional(),
});

const clientErrorSchema = z.object({
  action: z.enum(['client_error']),
  detail: z.string().max(5000),
});

module.exports = function createAuditRoutes(db) {
  const router = Router();
  const repo = createAuditRepo(db);

  // POST / — log client-side errors
  router.post('/', validate({ body: clientErrorSchema }), (req, res, next) => {
    try {
      const { action, detail } = req.body;
      const result = db.prepare(
        'INSERT INTO audit_log (user_id, action, resource, resource_id, ip, ua, detail) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        req.userId,
        action,
        'client',
        null,
        typeof req.ip === 'string' ? req.ip.slice(0, 45) : '',
        typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 256) : '',
        detail
      );
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (err) { next(err); }
  });

  // GET / — list audit log
  router.get('/', validate({ query: auditQuerySchema }), (req, res, next) => {
    try {
      const query = req._parsedQuery || req.query;
      const isAdmin = req.userRole === 'admin';

      const params = {
        action: query.action,
        resource: query.resource,
        page: query.page,
        limit: query.limit,
        isAdmin,
      };

      if (isAdmin && query.user_id) {
        params.userId = query.user_id;
      } else if (!isAdmin) {
        params.userId = req.userId;
      }

      const result = repo.findAll(params);
      res.json(result);
    } catch (err) { next(err); }
  });

  // GET /export — admin only, CSV
  router.get('/export', requireRole('admin'), (req, res, next) => {
    try {
      const entries = repo.exportAll();

      const headers = ['id', 'user_id', 'action', 'resource', 'resource_id', 'ip', 'ua', 'detail', 'created_at'];
      const csvRows = [headers.join(',')];

      for (const entry of entries) {
        const row = headers.map(h => {
          const val = entry[h];
          if (val == null) return '';
          const str = String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        });
        csvRows.push(row.join(','));
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit-log.csv');
      res.send(csvRows.join('\n'));
    } catch (err) { next(err); }
  });

  return router;
};
