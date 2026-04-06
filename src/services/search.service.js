'use strict';

const createItemService = require('./item.service');
const createAuditLogger = require('./audit');

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Escape HTML entities.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Highlight search terms in text.
 * CRITICAL: escapes HTML first, then wraps matches in <mark> tags.
 */
function highlightMatches(text, searchTerms) {
  if (!text || !searchTerms || !searchTerms.length) return text || '';

  // First escape all HTML
  let escaped = escapeHtml(text);

  // Filter out empty terms and escape regex special chars in search terms
  const validTerms = searchTerms
    .map(t => String(t).trim())
    .filter(Boolean)
    .map(t => escapeHtml(t)); // Also escape the search term for safe matching

  if (!validTerms.length) return escaped;

  // Build regex from escaped terms
  const pattern = validTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');

  return escaped.replace(regex, '<mark>$1</mark>');
}

/**
 * Create search service with FTS5 support.
 */
function createSearchService(db) {
  const audit = createAuditLogger(db);
  const service = createItemService(db, audit);

  return {
    /**
     * Rebuild FTS5 index for a user by decrypting all items.
     */
    rebuildIndex(userId, vaultKey) {
      // Clear existing index entries for this user
      const existingIds = db.prepare('SELECT id FROM items WHERE user_id = ? AND deleted_at IS NULL').all(userId).map(r => r.id);
      if (existingIds.length > 0) {
        const placeholders = existingIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM items_fts WHERE item_id IN (${placeholders})`).run(...existingIds);
      }

      // Decrypt and index all items
      const items = service.findAll(userId, vaultKey, { limit: 100000, page: 1 });
      const insertStmt = db.prepare('INSERT INTO items_fts (item_id, title, notes) VALUES (?, ?, ?)');
      const txn = db.transaction(() => {
        for (const item of items) {
          if (item.client_encrypted) continue;
          insertStmt.run(item.id, item.title || '', item.notes || '');
        }
      });
      txn();
      return { indexed: items.length };
    },

    /**
     * Update a single item in the FTS index.
     */
    updateIndex(itemId, title, notes) {
      db.prepare('DELETE FROM items_fts WHERE item_id = ?').run(itemId);
      db.prepare('INSERT INTO items_fts (item_id, title, notes) VALUES (?, ?, ?)').run(itemId, title || '', notes || '');
    },

    /**
     * Search using FTS5 MATCH, with fuzzy fallback.
     */
    search(userId, query) {
      if (!query || !query.trim()) return [];

      const q = query.trim();
      // Get user's item IDs
      const userItemIds = db.prepare('SELECT id FROM items WHERE user_id = ? AND deleted_at IS NULL').all(userId).map(r => r.id);
      if (!userItemIds.length) return [];

      const placeholders = userItemIds.map(() => '?').join(',');

      // Try FTS5 MATCH first
      let ftsResults = [];
      try {
        // Use prefix matching with *
        const ftsQuery = q.split(/\s+/).map(t => '"' + t.replace(/"/g, '') + '"*').join(' OR ');
        ftsResults = db.prepare(
          `SELECT item_id, rank FROM items_fts WHERE items_fts MATCH ? AND item_id IN (${placeholders}) ORDER BY rank`
        ).all(ftsQuery, ...userItemIds);
      } catch {
        // FTS query syntax error — fall through to fuzzy
      }

      if (ftsResults.length > 0) {
        return ftsResults.map(r => ({ item_id: r.item_id, score: -r.rank }));
      }

      // Fuzzy fallback: get all indexed content and find close matches
      return this.fuzzySearch(userId, q);
    },

    /**
     * Fuzzy search using Levenshtein distance.
     */
    fuzzySearch(userId, query) {
      const userItemIds = db.prepare('SELECT id FROM items WHERE user_id = ? AND deleted_at IS NULL').all(userId).map(r => r.id);
      if (!userItemIds.length) return [];

      const placeholders = userItemIds.map(() => '?').join(',');
      const indexed = db.prepare(
        `SELECT item_id, title, notes FROM items_fts WHERE item_id IN (${placeholders})`
      ).all(...userItemIds);

      const q = query.toLowerCase();
      const results = [];

      for (const row of indexed) {
        const titleLower = (row.title || '').toLowerCase();
        const notesLower = (row.notes || '').toLowerCase();
        const combined = titleLower + ' ' + notesLower;

        let score = 0;

        // Exact match
        if (combined.includes(q)) {
          if (titleLower === q || notesLower === q) {
            score = 100; // exact
          } else if (titleLower.startsWith(q) || notesLower.startsWith(q)) {
            score = 80; // starts-with
          } else {
            score = 60; // contains
          }
        } else {
          // Fuzzy: check each word against query
          const words = combined.split(/\s+/);
          let bestDist = Infinity;
          for (const word of words) {
            const dist = levenshtein(q, word);
            if (dist < bestDist) bestDist = dist;
          }
          if (bestDist <= 3) {
            score = Math.max(1, 40 - bestDist * 10);
          }
        }

        if (score > 0) {
          results.push({ item_id: row.item_id, score });
        }
      }

      results.sort((a, b) => b.score - a.score);
      return results;
    },
  };
}

module.exports = createSearchService;
module.exports.highlightMatches = highlightMatches;
module.exports.levenshtein = levenshtein;
