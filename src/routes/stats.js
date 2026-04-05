'use strict';

const { Router } = require('express');
const createStatsRepo = require('../repositories/stats.repository');

module.exports = function createStatsRoutes(db) {
  const router = Router();
  const stats = createStatsRepo(db);

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

  return router;
};
