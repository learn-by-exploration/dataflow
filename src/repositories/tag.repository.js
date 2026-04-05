'use strict';

const { NotFoundError, ConflictError } = require('../errors');

function createTagRepo(db) {
  return {
    findAll(userId) {
      return db.prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY name ASC').all(userId);
    },

    findById(id, userId) {
      const row = db.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(id, userId);
      if (!row) throw new NotFoundError('Tag', id);
      return row;
    },

    create(userId, name, color) {
      const existing = db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(userId, name);
      if (existing) throw new ConflictError(`Tag "${name}" already exists`);
      const result = db.prepare(
        'INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)'
      ).run(userId, name, color || '#64748B');
      return this.findById(result.lastInsertRowid, userId);
    },

    update(id, userId, name, color) {
      this.findById(id, userId);
      if (name != null) {
        const dup = db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ? AND id != ?').get(userId, name, id);
        if (dup) throw new ConflictError(`Tag "${name}" already exists`);
      }
      const fields = [];
      const values = [];
      if (name != null) { fields.push('name = ?'); values.push(name); }
      if (color != null) { fields.push('color = ?'); values.push(color); }
      if (fields.length === 0) return this.findById(id, userId);
      values.push(id, userId);
      db.prepare(`UPDATE tags SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
      return this.findById(id, userId);
    },

    delete(id, userId) {
      this.findById(id, userId);
      db.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').run(id, userId);
    },

    linkItem(itemId, tagId) {
      try {
        db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(itemId, tagId);
      } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') throw new NotFoundError('Tag or Item');
        throw e;
      }
    },

    unlinkItem(itemId, tagId) {
      db.prepare('DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?').run(itemId, tagId);
    },

    unlinkAllFromItem(itemId) {
      db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(itemId);
    },

    findByItem(itemId) {
      return db.prepare(
        'SELECT t.* FROM tags t JOIN item_tags it ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name ASC'
      ).all(itemId);
    },

    usageCounts(userId) {
      return db.prepare(
        `SELECT t.id, t.name, t.color, COUNT(it.item_id) as count
         FROM tags t LEFT JOIN item_tags it ON t.id = it.tag_id
         WHERE t.user_id = ? GROUP BY t.id ORDER BY count DESC`
      ).all(userId);
    },
  };
}

module.exports = createTagRepo;
