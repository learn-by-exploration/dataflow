'use strict';

function createSettingsRepo(db) {
  return {
    findAll(userId) {
      return db.prepare('SELECT key, value FROM settings WHERE user_id = ?').all(userId);
    },

    findByKey(userId, key) {
      return db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(userId, key);
    },

    upsert(userId, key, value) {
      db.prepare(
        'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value'
      ).run(userId, key, value);
    },

    delete(userId, key) {
      db.prepare('DELETE FROM settings WHERE user_id = ? AND key = ?').run(userId, key);
    },
  };
}

module.exports = createSettingsRepo;
