'use strict';

/**
 * Recovery codes service.
 * Generate, verify, and manage recovery codes.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');

function createRecoveryService(db) {
  const saltRounds = config.isTest ? 4 : 10;

  return {
    async generateCodes(userId) {
      // Delete existing codes
      db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);

      const codes = [];
      const hashes = [];

      // Generate codes and hash them (async bcrypt)
      for (let i = 0; i < 10; i++) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
        let code = '';
        const bytes = crypto.randomBytes(8);
        for (let j = 0; j < 8; j++) {
          code += chars[bytes[j] % chars.length];
        }
        const hash = await bcrypt.hash(code, saltRounds);
        codes.push(code);
        hashes.push(hash);
      }

      // Insert all in a synchronous transaction
      const insertStmt = db.prepare(
        'INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)'
      );
      const txn = db.transaction(() => {
        for (const hash of hashes) {
          insertStmt.run(userId, hash);
        }
      });
      txn();

      return codes;
    },

    async useCode(userId, code) {
      const rows = db.prepare(
        'SELECT * FROM recovery_codes WHERE user_id = ? AND used_at IS NULL'
      ).all(userId);

      for (const row of rows) {
        const match = await bcrypt.compare(code, row.code_hash);
        if (match) {
          db.prepare(
            "UPDATE recovery_codes SET used_at = datetime('now') WHERE id = ?"
          ).run(row.id);
          return true;
        }
      }

      return false;
    },

    getCodeStatus(userId) {
      const total = db.prepare(
        'SELECT COUNT(*) as count FROM recovery_codes WHERE user_id = ?'
      ).get(userId).count;
      const used = db.prepare(
        'SELECT COUNT(*) as count FROM recovery_codes WHERE user_id = ? AND used_at IS NOT NULL'
      ).get(userId).count;

      return {
        total,
        used,
        remaining: total - used,
      };
    },
  };
}

module.exports = createRecoveryService;
