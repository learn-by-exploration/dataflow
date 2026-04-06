'use strict';

function createHistoryRepo(db) {
  return {
    create(entry) {
      return db.prepare(
        `INSERT INTO item_history (item_id, field_name, old_value, new_value, changed_by)
         VALUES (?, ?, ?, ?, ?)`
      ).run(entry.item_id, entry.field_name, entry.old_value, entry.new_value, entry.changed_by);
    },

    findByItemId(itemId) {
      return db.prepare(
        'SELECT * FROM item_history WHERE item_id = ? ORDER BY changed_at DESC'
      ).all(itemId);
    },
  };
}

module.exports = createHistoryRepo;
