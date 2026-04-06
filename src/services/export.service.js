'use strict';

const createItemService = require('./item.service');
const createAuditLogger = require('./audit');

function createExportService(db) {
  const audit = createAuditLogger(db);
  const service = createItemService(db, audit);

  /**
   * Escape a CSV field value: wrap in quotes if it contains commas, quotes, or newlines.
   */
  function csvEscape(val) {
    if (val == null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  return {
    /**
     * Export items as CSV string.
     * @param {number} userId
     * @param {Buffer} vaultKey
     * @param {{ categoryIds?: number[], itemIds?: number[] }} options
     * @returns {string} CSV content
     */
    exportCsv(userId, vaultKey, options = {}) {
      let items = service.findAll(userId, vaultKey, { limit: 100000, page: 1 });

      // Filter by category IDs
      if (options.categoryIds && options.categoryIds.length > 0) {
        const catSet = new Set(options.categoryIds.map(Number));
        items = items.filter(i => catSet.has(i.category_id));
      }

      // Filter by item IDs
      if (options.itemIds && options.itemIds.length > 0) {
        const idSet = new Set(options.itemIds.map(Number));
        items = items.filter(i => idSet.has(i.id));
      }

      // Build CSV
      const headers = ['id', 'title', 'notes', 'category_id', 'favorite', 'created_at', 'updated_at'];
      const rows = [headers.join(',')];

      for (const item of items) {
        const row = [
          csvEscape(item.id),
          csvEscape(item.title),
          csvEscape(item.notes),
          csvEscape(item.category_id),
          csvEscape(item.favorite ? 1 : 0),
          csvEscape(item.created_at),
          csvEscape(item.updated_at),
        ];
        rows.push(row.join(','));
      }

      return rows.join('\n');
    },
  };
}

module.exports = createExportService;
