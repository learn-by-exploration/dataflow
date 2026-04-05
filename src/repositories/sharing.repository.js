'use strict';

function createSharingRepo(db) {
  return {
    shareItem(itemId, sharedBy, sharedWith, permission) {
      const existing = db.prepare(
        'SELECT id FROM item_shares WHERE item_id = ? AND shared_with = ?'
      ).get(itemId, sharedWith);
      if (existing) {
        db.prepare('UPDATE item_shares SET permission = ? WHERE id = ?')
          .run(permission, existing.id);
        return db.prepare('SELECT * FROM item_shares WHERE id = ?').get(existing.id);
      }
      const result = db.prepare(
        'INSERT INTO item_shares (item_id, shared_by, shared_with, permission) VALUES (?, ?, ?, ?)'
      ).run(itemId, sharedBy, sharedWith, permission);
      return db.prepare('SELECT * FROM item_shares WHERE id = ?').get(result.lastInsertRowid);
    },

    unshareItem(itemId, sharedWith) {
      return db.prepare(
        'DELETE FROM item_shares WHERE item_id = ? AND shared_with = ?'
      ).run(itemId, sharedWith);
    },

    getItemShares(itemId) {
      return db.prepare(
        `SELECT s.*, u.email, u.display_name
         FROM item_shares s JOIN users u ON s.shared_with = u.id
         WHERE s.item_id = ?`
      ).all(itemId);
    },

    isItemSharedWith(itemId, userId) {
      return db.prepare(
        'SELECT permission FROM item_shares WHERE item_id = ? AND shared_with = ?'
      ).get(itemId, userId) || null;
    },

    shareCategory(catId, sharedBy, sharedWith, permission) {
      const existing = db.prepare(
        'SELECT id FROM category_shares WHERE category_id = ? AND shared_with = ?'
      ).get(catId, sharedWith);
      if (existing) {
        db.prepare('UPDATE category_shares SET permission = ? WHERE id = ?')
          .run(permission, existing.id);
        return db.prepare('SELECT * FROM category_shares WHERE id = ?').get(existing.id);
      }
      const result = db.prepare(
        'INSERT INTO category_shares (category_id, shared_by, shared_with, permission) VALUES (?, ?, ?, ?)'
      ).run(catId, sharedBy, sharedWith, permission);
      return db.prepare('SELECT * FROM category_shares WHERE id = ?').get(result.lastInsertRowid);
    },

    unshareCategory(catId, sharedWith) {
      return db.prepare(
        'DELETE FROM category_shares WHERE category_id = ? AND shared_with = ?'
      ).run(catId, sharedWith);
    },

    getCategoryShares(catId) {
      return db.prepare(
        `SELECT s.*, u.email, u.display_name
         FROM category_shares s JOIN users u ON s.shared_with = u.id
         WHERE s.category_id = ?`
      ).all(catId);
    },

    isCategorySharedWith(catId, userId) {
      return db.prepare(
        'SELECT permission FROM category_shares WHERE category_id = ? AND shared_with = ?'
      ).get(catId, userId) || null;
    },

    getSharedItems(userId) {
      return db.prepare(
        `SELECT i.*, s.permission, s.shared_by, u.display_name as shared_by_name
         FROM item_shares s
         JOIN items i ON s.item_id = i.id
         JOIN users u ON s.shared_by = u.id
         WHERE s.shared_with = ?`
      ).all(userId);
    },

    getSharedCategories(userId) {
      return db.prepare(
        `SELECT c.*, s.permission, s.shared_by, u.display_name as shared_by_name
         FROM category_shares s
         JOIN categories c ON s.category_id = c.id
         JOIN users u ON s.shared_by = u.id
         WHERE s.shared_with = ?`
      ).all(userId);
    },
  };
}

module.exports = createSharingRepo;
