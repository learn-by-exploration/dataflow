'use strict';

const crypto = require('crypto');

function createShareLinkService(db) {
  return {
    createShareLink(itemId, userId, options = {}) {
      const token = crypto.randomBytes(32).toString('hex');
      const { expiresIn, oneTimeUse, passphrase } = options;

      let expiresAt = null;
      if (expiresIn && expiresIn > 0) {
        expiresAt = new Date(Date.now() + expiresIn * 3600 * 1000).toISOString();
      }

      let passphraseHash = null;
      if (passphrase) {
        // Use HMAC-SHA256 as a hash for the passphrase (no bcrypt dependency)
        passphraseHash = crypto.createHmac('sha256', 'dataflow-share-link')
          .update(passphrase).digest('hex');
      }

      const result = db.prepare(
        `INSERT INTO share_links (item_id, user_id, token, passphrase_hash, expires_at, one_time)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(itemId, userId, token, passphraseHash, expiresAt, oneTimeUse ? 1 : 0);

      return db.prepare('SELECT * FROM share_links WHERE id = ?').get(result.lastInsertRowid);
    },

    resolveShareLink(token, passphrase) {
      const link = db.prepare('SELECT * FROM share_links WHERE token = ?').get(token);
      if (!link) return { error: 'not_found' };

      // Check expiry
      if (link.expires_at && new Date(link.expires_at) < new Date()) {
        return { error: 'expired' };
      }

      // Check one-time use
      if (link.one_time && link.used_at) {
        return { error: 'already_used' };
      }

      // Check passphrase
      if (link.passphrase_hash) {
        if (!passphrase) return { error: 'passphrase_required' };
        const hash = crypto.createHmac('sha256', 'dataflow-share-link')
          .update(passphrase).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(link.passphrase_hash))) {
          return { error: 'wrong_passphrase' };
        }
      }

      // Mark as used if one-time
      if (link.one_time) {
        db.prepare("UPDATE share_links SET used_at = datetime('now') WHERE id = ?").run(link.id);
      }

      // Get item data
      const item = db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').get(link.item_id);
      if (!item) return { error: 'item_not_found' };

      return { item, link };
    },

    getLinksForItem(itemId, userId) {
      return db.prepare('SELECT * FROM share_links WHERE item_id = ? AND user_id = ? ORDER BY created_at DESC')
        .all(itemId, userId);
    },

    deleteLink(id, userId) {
      db.prepare('DELETE FROM share_links WHERE id = ? AND user_id = ?').run(id, userId);
    },
  };
}

module.exports = createShareLinkService;
