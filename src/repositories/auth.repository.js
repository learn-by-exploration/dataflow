'use strict';

function createAuthRepo(db) {
  return {
    findUserByEmail(email) {
      return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
    },

    findUserById(id) {
      return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
    },

    getUserCount() {
      return db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
    },

    createUser({ email, passwordHash, displayName, role, masterKeySalt, masterKeyParams, vaultKeyEncrypted }) {
      const result = db.prepare(
        `INSERT INTO users (email, password_hash, display_name, role, master_key_salt, master_key_params, vault_key_encrypted)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(email, passwordHash, displayName, role, masterKeySalt, masterKeyParams, vaultKeyEncrypted);
      return { id: Number(result.lastInsertRowid), email, display_name: displayName, role };
    },

    findUserBasic(id) {
      return db.prepare('SELECT id FROM users WHERE id = ?').get(id) || null;
    },

    updateUserPassword(id, { passwordHash, masterKeySalt, masterKeyParams, vaultKeyEncrypted }) {
      db.prepare(
        `UPDATE users SET password_hash = ?, master_key_salt = ?, master_key_params = ?, vault_key_encrypted = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(passwordHash, masterKeySalt, masterKeyParams, vaultKeyEncrypted, id);
    },

    findLoginAttempt(email) {
      return db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(email) || null;
    },

    createLoginAttempt(email, now) {
      db.prepare(
        'INSERT INTO login_attempts (email, attempts, first_attempt_at) VALUES (?, 1, ?)'
      ).run(email, now);
    },

    resetLoginAttempt(email, now) {
      db.prepare(
        'UPDATE login_attempts SET attempts = 1, first_attempt_at = ?, locked_until = NULL WHERE email = ?'
      ).run(now, email);
    },

    incrementLoginAttempt(email, newAttempts, lockedUntil) {
      if (lockedUntil) {
        db.prepare(
          'UPDATE login_attempts SET attempts = ?, locked_until = ? WHERE email = ?'
        ).run(newAttempts, lockedUntil, email);
      } else {
        db.prepare(
          'UPDATE login_attempts SET attempts = ? WHERE email = ?'
        ).run(newAttempts, email);
      }
    },

    deleteLoginAttempt(email) {
      db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email);
    },
  };
}

module.exports = createAuthRepo;
