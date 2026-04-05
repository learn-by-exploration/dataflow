'use strict';

module.exports = function createStatsRepo(db) {
  return {
    itemCount(userId) {
      return db.prepare('SELECT COUNT(*) as count FROM items WHERE user_id = ?').get(userId);
    },

    categoryCount(userId) {
      return db.prepare('SELECT COUNT(*) as count FROM categories WHERE user_id = ?').get(userId);
    },

    sharedItemCount(userId) {
      return db.prepare('SELECT COUNT(*) as count FROM item_shares WHERE shared_with = ?').get(userId);
    },

    memberCount() {
      return db.prepare('SELECT COUNT(*) as count FROM users').get();
    },

    recentActivity(userId, limit = 10) {
      return db.prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
    },

    itemsByCategory(userId) {
      return db.prepare(
        'SELECT c.name, COUNT(i.id) as count FROM categories c LEFT JOIN items i ON i.category_id = c.id AND i.user_id = ? WHERE c.user_id = ? GROUP BY c.id'
      ).all(userId, userId);
    },

    activityByDay(userId, days = 30) {
      return db.prepare(
        `SELECT date(created_at) as day, COUNT(*) as count FROM audit_log WHERE user_id = ? AND created_at >= datetime('now', '-' || ? || ' days') GROUP BY day ORDER BY day`
      ).all(userId, days);
    },
  };
};
