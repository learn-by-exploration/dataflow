'use strict';

const { NotFoundError } = require('../errors');
const { getNextPosition } = require('../helpers');

function createItemRepo(db) {
  return {
    findAll(userId, { category_id, record_type_id, tag_id, favorite, limit, offset, sort } = {}) {
      const conditions = ['i.user_id = ?'];
      const params = [userId];

      if (category_id != null) {
        conditions.push('i.category_id = ?');
        params.push(category_id);
      }
      if (record_type_id != null) {
        conditions.push('i.record_type_id = ?');
        params.push(record_type_id);
      }
      if (favorite != null) {
        conditions.push('i.favorite = ?');
        params.push(favorite ? 1 : 0);
      }
      if (tag_id != null) {
        conditions.push('i.id IN (SELECT item_id FROM item_tags WHERE tag_id = ?)');
        params.push(tag_id);
      }

      let orderBy = 'i.position ASC, i.id DESC';
      if (sort === 'created') orderBy = 'i.created_at DESC, i.id DESC';
      else if (sort === 'updated') orderBy = 'i.updated_at DESC, i.id DESC';
      else if (sort === 'title') orderBy = 'i.title_encrypted ASC';

      let sql = `SELECT i.* FROM items i WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy}`;
      if (limit != null) {
        sql += ' LIMIT ?';
        params.push(limit);
      }
      if (offset != null) {
        sql += ' OFFSET ?';
        params.push(offset);
      }

      return db.prepare(sql).all(...params);
    },

    findById(id, userId) {
      const row = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(id, userId);
      if (!row) throw new NotFoundError('Item', id);
      return row;
    },

    create(userId, data) {
      const pos = data.position != null ? data.position : getNextPosition(db, 'items', 'user_id', userId);
      const result = db.prepare(
        `INSERT INTO items (user_id, category_id, record_type_id, title_encrypted, title_iv, title_tag,
         notes_encrypted, notes_iv, notes_tag, favorite, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        userId,
        data.category_id,
        data.record_type_id || null,
        data.title_encrypted, data.title_iv, data.title_tag,
        data.notes_encrypted || null, data.notes_iv || null, data.notes_tag || null,
        data.favorite ? 1 : 0,
        pos
      );
      return this.findById(result.lastInsertRowid, userId);
    },

    update(id, userId, data) {
      this.findById(id, userId);
      const fields = [];
      const values = [];
      for (const key of ['category_id', 'record_type_id', 'title_encrypted', 'title_iv', 'title_tag',
        'notes_encrypted', 'notes_iv', 'notes_tag', 'favorite', 'position']) {
        if (data[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(key === 'favorite' ? (data[key] ? 1 : 0) : data[key]);
        }
      }
      if (fields.length === 0) return this.findById(id, userId);
      fields.push("updated_at = datetime('now')");
      values.push(id, userId);
      db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
      return this.findById(id, userId);
    },

    delete(id, userId) {
      this.findById(id, userId);
      db.prepare('DELETE FROM items WHERE id = ? AND user_id = ?').run(id, userId);
    },

    reorder(userId, categoryId, orderedIds) {
      const updateStmt = db.prepare('UPDATE items SET position = ? WHERE id = ? AND user_id = ? AND category_id = ?');
      const txn = db.transaction(() => {
        for (let i = 0; i < orderedIds.length; i++) {
          updateStmt.run(i, orderedIds[i], userId, categoryId);
        }
      });
      txn();
    },

    bulkDelete(userId, ids) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM items WHERE user_id = ? AND id IN (${placeholders})`).run(userId, ...ids);
    },

    bulkMove(userId, ids, categoryId) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(
        `UPDATE items SET category_id = ?, updated_at = datetime('now') WHERE user_id = ? AND id IN (${placeholders})`
      ).run(categoryId, userId, ...ids);
    },

    countByUser(userId) {
      return db.prepare('SELECT COUNT(*) as count FROM items WHERE user_id = ?').get(userId).count;
    },
  };
}

module.exports = createItemRepo;
