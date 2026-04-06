'use strict';

const { NotFoundError } = require('../errors');
const { getNextPosition } = require('../helpers');

function createItemRepo(db) {
  return {
    findAll(userId, { category_id, record_type_id, tag_id, favorite, created_after, created_before, has_attachments, min_strength, limit, offset, sort } = {}) {
      const conditions = ['i.user_id = ?', 'i.deleted_at IS NULL'];
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
      if (created_after != null) {
        conditions.push('i.created_at >= ?');
        params.push(created_after);
      }
      if (created_before != null) {
        conditions.push('i.created_at <= ?');
        params.push(created_before);
      }
      if (has_attachments === true) {
        conditions.push('i.id IN (SELECT item_id FROM item_attachments)');
      } else if (has_attachments === false) {
        conditions.push('i.id NOT IN (SELECT item_id FROM item_attachments)');
      }
      if (min_strength != null) {
        conditions.push('i.id IN (SELECT item_id FROM item_fields WHERE strength_score >= ?)');
        params.push(min_strength);
      }

      let orderBy = 'i.favorite DESC, i.position ASC, i.id DESC';
      if (sort === 'created') orderBy = 'i.favorite DESC, i.created_at DESC, i.id DESC';
      else if (sort === 'updated') orderBy = 'i.favorite DESC, i.updated_at DESC, i.id DESC';
      else if (sort === 'title') orderBy = 'i.favorite DESC, i.title_sort_key ASC, i.id ASC';

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
      const row = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, userId);
      if (!row) throw new NotFoundError('Item', id);
      return row;
    },

    create(userId, data) {
      const pos = data.position != null ? data.position : getNextPosition(db, 'items', 'user_id', userId);
      const result = db.prepare(
        `INSERT INTO items (user_id, category_id, record_type_id, title_encrypted, title_iv, title_tag,
         notes_encrypted, notes_iv, notes_tag, favorite, position, title_sort_key, client_encrypted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        userId,
        data.category_id,
        data.record_type_id || null,
        data.title_encrypted, data.title_iv, data.title_tag,
        data.notes_encrypted || null, data.notes_iv || null, data.notes_tag || null,
        data.favorite ? 1 : 0,
        pos,
        data.title_sort_key || null,
        data.client_encrypted ? 1 : 0
      );
      return this.findById(result.lastInsertRowid, userId);
    },

    update(id, userId, data) {
      this.findById(id, userId);
      const fields = [];
      const values = [];
      for (const key of ['category_id', 'record_type_id', 'title_encrypted', 'title_iv', 'title_tag',
        'notes_encrypted', 'notes_iv', 'notes_tag', 'favorite', 'position', 'title_sort_key', 'client_encrypted']) {
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

    softDelete(id, userId) {
      this.findById(id, userId);
      db.prepare("UPDATE items SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?").run(id, userId);
    },

    restore(id, userId) {
      const row = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL').get(id, userId);
      if (!row) return null;
      db.prepare('UPDATE items SET deleted_at = NULL WHERE id = ? AND user_id = ?').run(id, userId);
      return db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    },

    findDeleted(userId) {
      return db.prepare('SELECT * FROM items WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC').all(userId);
    },

    permanentlyDelete(id) {
      db.prepare('DELETE FROM items WHERE id = ?').run(id);
    },

    purgeOldDeletedItems(days) {
      const result = db.prepare(
        "DELETE FROM items WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-' || ? || ' days')"
      ).run(String(days));
      return result.changes;
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
      db.prepare(`UPDATE items SET deleted_at = datetime('now') WHERE user_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`).run(userId, ...ids);
    },

    bulkMove(userId, ids, categoryId) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(
        `UPDATE items SET category_id = ?, updated_at = datetime('now') WHERE user_id = ? AND id IN (${placeholders})`
      ).run(categoryId, userId, ...ids);
    },

    bulkEdit(userId, ids, changes) {
      const fields = [];
      const values = [];
      if (changes.category_id !== undefined) {
        fields.push('category_id = ?');
        values.push(changes.category_id);
      }
      if (changes.record_type_id !== undefined) {
        fields.push('record_type_id = ?');
        values.push(changes.record_type_id);
      }
      if (fields.length === 0) return;
      fields.push("updated_at = datetime('now')");
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(
        `UPDATE items SET ${fields.join(', ')} WHERE user_id = ? AND id IN (${placeholders})`
      ).run(...values, userId, ...ids);
    },

    countByUser(userId) {
      return db.prepare('SELECT COUNT(*) as count FROM items WHERE user_id = ? AND deleted_at IS NULL').get(userId).count;
    },

    existsForUser(id, userId) {
      return !!db.prepare('SELECT id FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, userId);
    },

    toggleFavorite(id, userId) {
      const row = db.prepare('SELECT favorite FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, userId);
      if (!row) throw new NotFoundError('Item', id);
      const newVal = row.favorite ? 0 : 1;
      db.prepare('UPDATE items SET favorite = ? WHERE id = ? AND user_id = ?').run(newVal, id, userId);
      return db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    },

    findByIdRaw(id) {
      return db.prepare('SELECT * FROM items WHERE id = ?').get(id) || null;
    },

    updatePartial(id, fieldValues) {
      const ALLOWED_COLUMNS = ['favorite', 'category_id', 'title', 'title_encrypted', 'title_sort_key', 'notes', 'notes_encrypted', 'position', 'client_encrypted'];
      const keys = Object.keys(fieldValues).filter(k => ALLOWED_COLUMNS.includes(k));
      if (keys.length === 0) return;
      const setClauses = keys.map(k => `${k} = ?`);
      setClauses.push("updated_at = datetime('now')");
      const values = keys.map(k => fieldValues[k]);
      values.push(id);
      db.prepare(`UPDATE items SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    },
  };
}

module.exports = createItemRepo;
