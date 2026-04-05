'use strict';

const { NotFoundError, ForbiddenError } = require('../errors');
const { getNextPosition } = require('../helpers');

function createRecordTypeRepo(db) {
  return {
    findAll(userId) {
      return db.prepare(
        'SELECT * FROM record_types WHERE user_id IS NULL OR user_id = ? ORDER BY is_builtin DESC, name ASC'
      ).all(userId);
    },

    findById(id) {
      const row = db.prepare('SELECT * FROM record_types WHERE id = ?').get(id);
      if (!row) throw new NotFoundError('RecordType', id);
      return row;
    },

    create(userId, { name, icon, description }) {
      const result = db.prepare(
        'INSERT INTO record_types (user_id, name, icon, description, is_builtin) VALUES (?, ?, ?, ?, 0)'
      ).run(userId, name, icon || '📄', description || '');
      return this.findById(result.lastInsertRowid);
    },

    update(id, userId, data) {
      const existing = this.findById(id);
      if (existing.is_builtin) throw new ForbiddenError('Cannot modify built-in record type');
      if (existing.user_id !== userId) throw new NotFoundError('RecordType', id);
      const fields = [];
      const values = [];
      for (const key of ['name', 'icon', 'description']) {
        if (data[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(data[key]);
        }
      }
      if (fields.length === 0) return existing;
      values.push(id);
      db.prepare(`UPDATE record_types SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return this.findById(id);
    },

    delete(id, userId) {
      const existing = this.findById(id);
      if (existing.is_builtin) throw new ForbiddenError('Cannot delete built-in record type');
      if (existing.user_id !== userId) throw new NotFoundError('RecordType', id);
      db.prepare('DELETE FROM record_types WHERE id = ?').run(id);
    },

    findFields(recordTypeId) {
      return db.prepare(
        'SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position ASC'
      ).all(recordTypeId);
    },

    addField(recordTypeId, { name, field_type, options, position, required }) {
      const pos = position != null ? position : getNextPosition(db, 'record_type_fields', 'record_type_id', recordTypeId);
      const result = db.prepare(
        'INSERT INTO record_type_fields (record_type_id, name, field_type, options, position, required) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(recordTypeId, name, field_type || 'text', options ? JSON.stringify(options) : null, pos, required ? 1 : 0);
      return db.prepare('SELECT * FROM record_type_fields WHERE id = ?').get(result.lastInsertRowid);
    },

    updateField(id, data) {
      const existing = db.prepare('SELECT * FROM record_type_fields WHERE id = ?').get(id);
      if (!existing) throw new NotFoundError('Field', id);
      const fields = [];
      const values = [];
      for (const key of ['name', 'field_type', 'required']) {
        if (data[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(key === 'required' ? (data[key] ? 1 : 0) : data[key]);
        }
      }
      if (data.options !== undefined) {
        fields.push('options = ?');
        values.push(data.options ? JSON.stringify(data.options) : null);
      }
      if (fields.length === 0) return existing;
      values.push(id);
      db.prepare(`UPDATE record_type_fields SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return db.prepare('SELECT * FROM record_type_fields WHERE id = ?').get(id);
    },

    deleteField(id) {
      const existing = db.prepare('SELECT * FROM record_type_fields WHERE id = ?').get(id);
      if (!existing) throw new NotFoundError('Field', id);
      db.prepare('DELETE FROM record_type_fields WHERE id = ?').run(id);
    },

    reorderFields(recordTypeId, orderedIds) {
      const updateStmt = db.prepare('UPDATE record_type_fields SET position = ? WHERE id = ? AND record_type_id = ?');
      const txn = db.transaction(() => {
        for (let i = 0; i < orderedIds.length; i++) {
          updateStmt.run(i, orderedIds[i], recordTypeId);
        }
      });
      txn();
    },
  };
}

module.exports = createRecordTypeRepo;
