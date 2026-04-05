'use strict';

function createAuditRepo(db) {
  return {
    findAll({ userId, isAdmin, action, resource, page = 1, limit = 20 }) {
      const conditions = [];
      const params = [];

      if (!isAdmin) {
        conditions.push('user_id = ?');
        params.push(userId);
      } else if (userId && isAdmin) {
        // Admin filtering by specific user
        conditions.push('user_id = ?');
        params.push(userId);
      }

      if (action) {
        conditions.push('action = ?');
        params.push(action);
      }
      if (resource) {
        conditions.push('resource = ?');
        params.push(resource);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const offset = (page - 1) * limit;
      const total = db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(...params).count;
      const entries = db.prepare(
        `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      ).all(...params, limit, offset);

      return { entries, total, page, limit };
    },

    exportAll() {
      return db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC').all();
    },
  };
}

module.exports = createAuditRepo;
