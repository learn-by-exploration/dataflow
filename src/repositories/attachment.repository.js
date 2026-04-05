'use strict';

const { NotFoundError } = require('../errors');

function createAttachmentRepo(db) {
  return {
    findByItem(itemId) {
      return db.prepare('SELECT * FROM item_attachments WHERE item_id = ? ORDER BY created_at DESC').all(itemId);
    },

    findById(id) {
      const row = db.prepare('SELECT * FROM item_attachments WHERE id = ?').get(id);
      if (!row) throw new NotFoundError('Attachment', id);
      return row;
    },

    findByIdAndUser(id, userId) {
      const row = db.prepare('SELECT * FROM item_attachments WHERE id = ? AND user_id = ?').get(id, userId);
      if (!row) throw new NotFoundError('Attachment', id);
      return row;
    },

    create({ item_id, user_id, filename, original_name, mime_type, size_bytes, encryption_iv, encryption_tag }) {
      const result = db.prepare(
        `INSERT INTO item_attachments (item_id, user_id, filename, original_name, mime_type, size_bytes, encryption_iv, encryption_tag)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(item_id, user_id, filename, original_name, mime_type || 'application/octet-stream', size_bytes, encryption_iv, encryption_tag);
      return this.findById(result.lastInsertRowid);
    },

    delete(id) {
      this.findById(id);
      db.prepare('DELETE FROM item_attachments WHERE id = ?').run(id);
    },

    countByUser(userId) {
      return db.prepare('SELECT COUNT(*) as count FROM item_attachments WHERE user_id = ?').get(userId).count;
    },

    totalSizeByUser(userId) {
      return db.prepare('SELECT COALESCE(SUM(size_bytes), 0) as total FROM item_attachments WHERE user_id = ?').get(userId).total;
    },
  };
}

module.exports = createAttachmentRepo;
