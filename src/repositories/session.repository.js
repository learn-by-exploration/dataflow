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

    findByUserId(userId) {
      return db.prepare(
        "SELECT sid, user_id, expires_at, created_at FROM sessions WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at DESC"
      ).all(userId);
    },

    deleteSessionBySid(sid, userId) {
      return db.prepare('DELETE FROM sessions WHERE sid = ? AND user_id = ?').run(sid, userId);
    },

    deleteOtherSessions(currentSid, userId) {
      return db.prepare('DELETE FROM sessions WHERE user_id = ? AND sid != ?').run(userId, currentSid);
    },
  };
}

module.exports = createSessionRepo;
