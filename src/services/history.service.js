'use strict';

const createHistoryRepo = require('../repositories/history.repository');
const createItemRepo = require('../repositories/item.repository');

function createHistoryService(db) {
  const historyRepo = createHistoryRepo(db);
  const itemRepo = createItemRepo(db);

  return {
    recordChange(itemId, fieldName, oldValue, newValue, changedBy) {
      historyRepo.create({
        item_id: itemId,
        field_name: fieldName,
        old_value: oldValue != null ? String(oldValue) : null,
        new_value: newValue != null ? String(newValue) : null,
        changed_by: changedBy,
      });
    },

    getItemHistory(itemId, userId) {
      // Permission check: user must own the item
      itemRepo.findById(itemId, userId); // throws NotFoundError if not owned
      return historyRepo.findByItemId(itemId);
    },
  };
}

module.exports = createHistoryService;
