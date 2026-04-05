'use strict';

const createItemService = require('./item.service');
const createAuditLogger = require('./audit');

function searchItems(db, userId, vaultKey, query, filters = {}) {
  const audit = createAuditLogger(db);
  const service = createItemService(db, audit);
  const items = service.findAll(userId, vaultKey, { ...filters, limit: 1000, page: 1 });
  const q = query.toLowerCase();
  return items.filter(item => {
    return (item.title && item.title.toLowerCase().includes(q)) ||
           (item.notes && item.notes.toLowerCase().includes(q));
  });
}

module.exports = { searchItems };
