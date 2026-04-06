'use strict';

const { Router } = require('express');
const createStatsRepo = require('../repositories/stats.repository');
const createSecurityService = require('../services/security.service');

module.exports = function createStatsRoutes(db) {
  const router = Router();
  const stats = createStatsRepo(db);
  const securityService = createSecurityService(db);

  // GET /api/stats/dashboard
  router.get('/dashboard', (req, res, next) => {
    try {
      const items = stats.itemCount(req.userId);
      const categories = stats.categoryCount(req.userId);
      const shared = stats.sharedItemCount(req.userId);
      const members = stats.memberCount();
      const recent = stats.recentActivity(req.userId);
      res.json({
        items: items.count,
        categories: categories.count,
        shared: shared.count,
        members: members.count,
        recent,
      });
    } catch (err) { next(err); }
  });

  // GET /api/stats/activity
  router.get('/activity', (req, res, next) => {
    try {
      const days = parseInt(req.query.days, 10) || 30;
      const activity = stats.activityByDay(req.userId, days);
      res.json(activity);
    } catch (err) { next(err); }
  });

  // GET /api/stats/encryption-health
  router.get('/encryption-health', (req, res, next) => {
    try {
      const total = db.prepare('SELECT COUNT(*) as count FROM items WHERE user_id = ?').get(req.userId).count;
      const serverEncrypted = db.prepare(
        'SELECT COUNT(*) as count FROM items WHERE user_id = ? AND client_encrypted = 0 AND title_encrypted IS NOT NULL'
      ).get(req.userId).count;
      const clientEncrypted = db.prepare(
        'SELECT COUNT(*) as count FROM items WHERE user_id = ? AND client_encrypted = 1'
      ).get(req.userId).count;
      const unencrypted = db.prepare(
        'SELECT COUNT(*) as count FROM items WHERE user_id = ? AND client_encrypted = 0 AND title_encrypted IS NULL'
      ).get(req.userId).count;
      const lastRotation = db.prepare(
        "SELECT value FROM settings WHERE user_id = ? AND key = 'last_vault_key_rotation'"
      ).get(req.userId);

      res.json({
        total,
        server_encrypted: serverEncrypted,
        client_encrypted: clientEncrypted,
        unencrypted,
        last_rotation_date: lastRotation ? lastRotation.value : null,
      });
    } catch (err) { next(err); }
  });

  // GET /api/stats/password-health
  router.get('/password-health', (req, res, next) => {
    try {
      const health = securityService.getPasswordHealth(req.userId);
      res.json(health);
    } catch (err) { next(err); }
  });

  // GET /api/stats/security-score
  router.get('/security-score', (req, res, next) => {
    try {
      const score = securityService.calculateSecurityScore(req.userId);
      res.json(score);
    } catch (err) { next(err); }
  });

  // GET /api/stats/health-report
  router.get('/health-report', (req, res, next) => {
    try {
      const report = securityService.getHealthReport(req.userId);
      res.json(report);
    } catch (err) { next(err); }
  });

  // GET /api/stats/analytics
  router.get('/analytics', (req, res, next) => {
    try {
      const itemsByCategory = stats.itemsByCategory(req.userId);

      const itemsPerMonth = db.prepare(
        `SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
         FROM items WHERE user_id = ? AND deleted_at IS NULL
         GROUP BY month ORDER BY month DESC LIMIT 12`
      ).all(req.userId);

      const sharesPerMonth = db.prepare(
        `SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
         FROM item_shares WHERE shared_by = ?
         GROUP BY month ORDER BY month DESC LIMIT 12`
      ).all(req.userId);

      const loginsPerDay = db.prepare(
        `SELECT date(created_at) as day, COUNT(*) as count
         FROM audit_log WHERE action = 'auth.login' AND created_at >= datetime('now', '-30 days')
         GROUP BY day ORDER BY day DESC`
      ).all();

      const topTags = db.prepare(
        `SELECT t.name, COUNT(it.item_id) as count
         FROM item_tags it
         JOIN tags t ON it.tag_id = t.id
         JOIN items i ON it.item_id = i.id
         WHERE i.user_id = ? AND i.deleted_at IS NULL
         GROUP BY t.id ORDER BY count DESC LIMIT 10`
      ).all(req.userId);

      res.json({
        itemsByCategory,
        itemsPerMonth,
        sharesPerMonth,
        loginsPerDay,
        topTags,
      });
    } catch (err) { next(err); }
  });

  // GET /api/stats/activity-feed
  router.get('/activity-feed', (req, res, next) => {
    try {
      let limit = parseInt(req.query.limit, 10) || 50;
      if (limit > 200) limit = 200;
      const memberId = req.query.member_id ? parseInt(req.query.member_id, 10) : null;

      // RBAC: children see only their own activity
      let userId = null;
      if (req.userRole === 'child') {
        userId = req.userId;
      } else if (memberId) {
        userId = memberId;
      }

      let sql = `SELECT a.*, u.display_name, u.email
                 FROM audit_log a
                 LEFT JOIN users u ON a.user_id = u.id`;
      const params = [];

      if (userId) {
        sql += ' WHERE a.user_id = ?';
        params.push(userId);
      }

      sql += ' ORDER BY a.created_at DESC LIMIT ?';
      params.push(limit);

      const feed = db.prepare(sql).all(...params);
      res.json(feed);
    } catch (err) { next(err); }
  });

  return router;
};
