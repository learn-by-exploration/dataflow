'use strict';

const { NotFoundError } = require('../errors');
const { getNextPosition } = require('../helpers');

function createCategoryRepo(db) {
  return {
    findAll(userId) {
      return db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY position ASC, id ASC').all(userId);
    },

    findById(id, userId) {
      const row = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(id, userId);
      if (!row) throw new NotFoundError('Category', id);
      return row;
    },

    create(userId, { name, icon, color, position }) {
      const pos = position != null ? position : getNextPosition(db, 'categories', 'user_id', userId);
      const result = db.prepare(
        'INSERT INTO categories (user_id, name, icon, color, position) VALUES (?, ?, ?, ?, ?)'
      ).run(userId, name, icon || '📁', color || '#2563EB', pos);
      return this.findById(result.lastInsertRowid, userId);
    },

    update(id, userId, data) {
      this.findById(id, userId); // ensure exists + ownership
      const fields = [];
      const values = [];
      for (const key of ['name', 'icon', 'color', 'position']) {
        if (data[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(data[key]);
        }
      }
      if (fields.length === 0) return this.findById(id, userId);
      values.push(id, userId);
      db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
      return this.findById(id, userId);
    },

    delete(id, userId) {
      this.findById(id, userId);
      db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(id, userId);
    },

    reorder(userId, orderedIds) {
      const updateStmt = db.prepare('UPDATE categories SET position = ? WHERE id = ? AND user_id = ?');
      const txn = db.transaction(() => {
        for (let i = 0; i < orderedIds.length; i++) {
          updateStmt.run(i, orderedIds[i], userId);
        }
      });
      txn();
    },
  };
}

module.exports = createCategoryRepo;
