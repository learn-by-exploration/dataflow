'use strict';

const { Router } = require('express');
const config = require('../config');
const { formatMetrics } = require('../middleware/metrics');

const startTime = Date.now();

module.exports = function createHealthRoutes(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    if (req.query.detail === 'true') {
      // Try to validate session for detailed info
      let authenticated = false;
      try {
        const sid = req.cookies && req.cookies.df_sid;
        if (sid) {
          const session = db.prepare("SELECT user_id FROM sessions WHERE sid = ? AND expires_at > datetime('now')").get(sid);
          if (session) authenticated = true;
        }
      } catch { /* ignore */ }

      if (!authenticated) {
        return res.json({ status: 'ok', uptime, version: config.version });
      }

      let dbInfo = {};
      try {
        const pageCount = db.pragma('page_count', { simple: true });
        const pageSize = db.pragma('page_size', { simple: true });
        const tables = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get().c;
        const migrationVersion = db.prepare('SELECT COUNT(*) as c FROM _migrations').get().c;
        dbInfo = {
          connected: true,
          size: pageCount * pageSize,
          tables,
          migrationVersion,
        };
      } catch {
        dbInfo = { connected: false };
      }

      return res.json({
        status: 'ok',
        uptime,
        version: config.version,
        db: dbInfo,
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
      });
    }

    res.json({ status: 'ok', uptime, version: config.version });
  });

  // GET /api/health/metrics — Prometheus metrics endpoint
  router.get('/metrics', (_req, res) => {
    try {
      const text = formatMetrics(db);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(text);
    } catch (err) {
      res.status(500).send('# Error generating metrics\n');
    }
  });

  return router;
};
