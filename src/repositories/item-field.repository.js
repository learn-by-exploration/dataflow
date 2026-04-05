'use strict';

const { NotFoundError } = require('../errors');

function createItemFieldRepo(db) {
  return {
    findByItem(itemId) {
      return db.prepare('SELECT * FROM item_fields WHERE item_id = ? ORDER BY id ASC').all(itemId);
    },

    create(itemId, { field_def_id, value_encrypted, value_iv, value_tag }) {
      const result = db.prepare(
        'INSERT INTO item_fields (item_id, field_def_id, value_encrypted, value_iv, value_tag) VALUES (?, ?, ?, ?, ?)'
      ).run(itemId, field_def_id, value_encrypted, value_iv, value_tag);
      return db.prepare('SELECT * FROM item_fields WHERE id = ?').get(result.lastInsertRowid);
    },

    update(id, data) {
      const existing = db.prepare('SELECT * FROM item_fields WHERE id = ?').get(id);
      if (!existing) throw new NotFoundError('ItemField', id);
      const fields = [];
      const values = [];
      for (const key of ['value_encrypted', 'value_iv', 'value_tag', 'field_def_id']) {
        if (data[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(data[key]);
        }
      }
      if (fields.length === 0) return existing;
      values.push(id);
      db.prepare(`UPDATE item_fields SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return db.prepare('SELECT * FROM item_fields WHERE id = ?').get(id);
    },

    deleteByItem(itemId) {
      db.prepare('DELETE FROM item_fields WHERE item_id = ?').run(itemId);
    },

    bulkCreate(itemId, fields) {
      const insertStmt = db.prepare(
        'INSERT INTO item_fields (item_id, field_def_id, value_encrypted, value_iv, value_tag) VALUES (?, ?, ?, ?, ?)'
      );
      const txn = db.transaction(() => {
        const created = [];
        for (const f of fields) {
          const result = insertStmt.run(itemId, f.field_def_id, f.value_encrypted, f.value_iv, f.value_tag);
          created.push(db.prepare('SELECT * FROM item_fields WHERE id = ?').get(result.lastInsertRowid));
        }
        return created;
      });
      return txn();
    },
  };
}

module.exports = createItemFieldRepo;
