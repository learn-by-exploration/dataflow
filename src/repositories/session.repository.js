'use strict';

function createSessionRepo(db) {
  return {
    findValidSession(sid) {
      return db.prepare(
        "SELECT * FROM sessions WHERE sid = ? AND expires_at > datetime('now')"
      ).get(sid) || null;
    },

    createSession(sid, userId, maxAgeDays) {
      db.prepare(
        "INSERT INTO sessions (sid, user_id, expires_at) VALUES (?, ?, datetime('now', ? || ' days'))"
      ).run(sid, userId, String(maxAgeDays));
    },

    deleteSession(sid) {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    },

    deleteUserSessions(userId) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    },
  };
}

module.exports = createSessionRepo;
