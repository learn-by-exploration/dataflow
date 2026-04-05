'use strict';

function createEmergencyRepo(db) {
  return {
    create(grantorId, granteeId, waitDays) {
      const result = db.prepare(
        'INSERT INTO emergency_access (grantor_id, grantee_id, wait_days) VALUES (?, ?, ?)'
      ).run(grantorId, granteeId, waitDays);
      return db.prepare('SELECT * FROM emergency_access WHERE id = ?').get(result.lastInsertRowid);
    },

    findById(id) {
      return db.prepare('SELECT * FROM emergency_access WHERE id = ?').get(id);
    },

    findByUser(userId) {
      return db.prepare(
        `SELECT ea.*,
          gr.email as grantor_email, gr.display_name as grantor_name,
          ge.email as grantee_email, ge.display_name as grantee_name
         FROM emergency_access ea
         JOIN users gr ON ea.grantor_id = gr.id
         JOIN users ge ON ea.grantee_id = ge.id
         WHERE ea.grantor_id = ? OR ea.grantee_id = ?
         ORDER BY ea.requested_at DESC`
      ).all(userId, userId);
    },

    approve(id) {
      db.prepare(
        `UPDATE emergency_access SET status = 'approved', approved_at = datetime('now'),
         expires_at = datetime('now', '+30 days') WHERE id = ?`
      ).run(id);
      return this.findById(id);
    },

    reject(id) {
      db.prepare("UPDATE emergency_access SET status = 'rejected' WHERE id = ?").run(id);
      return this.findById(id);
    },

    cancel(id) {
      db.prepare('DELETE FROM emergency_access WHERE id = ?').run(id);
    },
  };
}

module.exports = createEmergencyRepo;
