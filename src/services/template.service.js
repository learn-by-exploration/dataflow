'use strict';

const { NotFoundError } = require('../errors');

function createTemplateService(db) {
  return {
    createFromItem(itemId, userId, name) {
      // Get the item (must belong to user)
      const item = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(itemId, userId);
      if (!item) throw new NotFoundError('Item', itemId);

      // Get field definitions (structure only, not encrypted values)
      const fields = db.prepare(
        `SELECT f.field_def_id, rtf.name as field_name, rtf.field_type, rtf.options, rtf.position, rtf.required
         FROM item_fields f
         LEFT JOIN record_type_fields rtf ON f.field_def_id = rtf.id
         WHERE f.item_id = ?`
      ).all(itemId);

      const defaultFields = fields.map(f => ({
        field_def_id: f.field_def_id,
        field_name: f.field_name,
        field_type: f.field_type,
        options: f.options,
        position: f.position,
        required: f.required,
      }));

      const result = db.prepare(
        'INSERT INTO item_templates (user_id, name, record_type_id, default_fields) VALUES (?, ?, ?, ?)'
      ).run(userId, name, item.record_type_id, JSON.stringify(defaultFields));

      return db.prepare('SELECT * FROM item_templates WHERE id = ?').get(result.lastInsertRowid);
    },

    listTemplates(userId) {
      return db.prepare('SELECT * FROM item_templates WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    },

    getTemplate(id, userId) {
      const tpl = db.prepare('SELECT * FROM item_templates WHERE id = ? AND user_id = ?').get(id, userId);
      if (!tpl) throw new NotFoundError('Template', id);
      tpl.default_fields = tpl.default_fields ? JSON.parse(tpl.default_fields) : [];
      return tpl;
    },

    deleteTemplate(id, userId) {
      const tpl = db.prepare('SELECT * FROM item_templates WHERE id = ? AND user_id = ?').get(id, userId);
      if (!tpl) throw new NotFoundError('Template', id);
      db.prepare('DELETE FROM item_templates WHERE id = ? AND user_id = ?').run(id, userId);
    },
  };
}

module.exports = createTemplateService;
