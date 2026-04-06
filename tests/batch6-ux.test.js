'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Batch 6 — UX Completeness', () => {
  let app, db, user;

  before(async () => {
    ({ app, db } = setup());
    cleanDb();
    user = await makeUser(app);
    const logged = await loginUser(app, user);
    user.sid = logged.sid;
  });

  afterEach(() => {
    // Clean item-related tables but preserve user/session
    db.exec('DELETE FROM item_tags');
    db.exec('DELETE FROM item_fields');
    db.exec('DELETE FROM item_attachments');
    db.exec('DELETE FROM item_shares');
    db.exec('DELETE FROM items');
    db.exec('DELETE FROM tags');
    db.exec('DELETE FROM categories');
    db.exec('DELETE FROM settings');
    try { db.exec('DELETE FROM item_history'); } catch { /* table may not exist yet */ }
  });

  after(() => teardown());

  // ─── Helpers ───
  function getBuiltinRT() {
    return db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();
  }

  async function createCategory(name) {
    const res = await authRequest(app, user.sid)
      .post('/api/categories')
      .send({ name: name || 'Cat-' + crypto.randomUUID().slice(0, 6) })
      .expect(201);
    return res.body;
  }

  async function createItem(catId, title, extra = {}) {
    const rt = getBuiltinRT();
    const res = await authRequest(app, user.sid)
      .post('/api/items')
      .send({
        category_id: catId,
        record_type_id: rt.id,
        title: title || 'Item-' + crypto.randomUUID().slice(0, 6),
        ...extra,
      })
      .expect(201);
    return res.body;
  }

  async function createTag(name) {
    const res = await authRequest(app, user.sid)
      .post('/api/tags')
      .send({ name: name || 'Tag-' + crypto.randomUUID().slice(0, 6) })
      .expect(201);
    return res.body;
  }

  // ═══════════════════════════════════════════
  // #51: Trash / Soft Delete
  // ═══════════════════════════════════════════
  describe('#51: Trash / Soft Delete', () => {
    it('DELETE /api/items/:id soft-deletes (sets deleted_at)', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'SoftDeleteMe');
      await authRequest(app, user.sid).delete('/api/items/' + item.id).expect(204);

      // Item should have deleted_at set in DB
      const row = db.prepare('SELECT deleted_at FROM items WHERE id = ?').get(item.id);
      assert.ok(row, 'Item should still exist in DB');
      assert.ok(row.deleted_at, 'deleted_at should be set');
    });

    it('GET /api/items excludes soft-deleted items', async () => {
      const cat = await createCategory();
      const item1 = await createItem(cat.id, 'Visible');
      const item2 = await createItem(cat.id, 'Deleted');
      await authRequest(app, user.sid).delete('/api/items/' + item2.id).expect(204);

      const res = await authRequest(app, user.sid).get('/api/items').expect(200);
      const titles = (Array.isArray(res.body) ? res.body : []).map(i => i.title);
      assert.ok(titles.includes('Visible'));
      assert.ok(!titles.includes('Deleted'));
    });

    it('GET /api/items/trash lists soft-deleted items', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'TrashItem');
      await authRequest(app, user.sid).delete('/api/items/' + item.id).expect(204);

      const res = await authRequest(app, user.sid).get('/api/items/trash').expect(200);
      const body = Array.isArray(res.body) ? res.body : [];
      assert.ok(body.length >= 1);
      assert.ok(body.some(i => i.id === item.id));
    });

    it('POST /api/items/:id/restore restores a trashed item', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'RestoreMe');
      await authRequest(app, user.sid).delete('/api/items/' + item.id).expect(204);
      await authRequest(app, user.sid).post('/api/items/' + item.id + '/restore').expect(200);

      // Should appear in vault again
      const res = await authRequest(app, user.sid).get('/api/items').expect(200);
      const ids = (Array.isArray(res.body) ? res.body : []).map(i => i.id);
      assert.ok(ids.includes(item.id));

      // deleted_at should be null
      const row = db.prepare('SELECT deleted_at FROM items WHERE id = ?').get(item.id);
      assert.equal(row.deleted_at, null);
    });

    it('DELETE /api/items/trash empties all trash', async () => {
      const cat = await createCategory();
      const item1 = await createItem(cat.id, 'Trash1');
      const item2 = await createItem(cat.id, 'Trash2');
      await authRequest(app, user.sid).delete('/api/items/' + item1.id).expect(204);
      await authRequest(app, user.sid).delete('/api/items/' + item2.id).expect(204);

      await authRequest(app, user.sid).delete('/api/items/trash').expect(200);

      // No items in trash
      const res = await authRequest(app, user.sid).get('/api/items/trash').expect(200);
      assert.equal((Array.isArray(res.body) ? res.body : []).length, 0);

      // Items permanently deleted from DB
      const count = db.prepare('SELECT COUNT(*) as c FROM items WHERE user_id = ?').get(user.id).c;
      assert.equal(count, 0);
    });

    it('Trash purge removes items deleted > 30 days ago', async () => {
      const cat = await createCategory();
      const item1 = await createItem(cat.id, 'OldTrash');
      const item2 = await createItem(cat.id, 'RecentTrash');

      // Soft-delete both
      await authRequest(app, user.sid).delete('/api/items/' + item1.id).expect(204);
      await authRequest(app, user.sid).delete('/api/items/' + item2.id).expect(204);

      // Backdate item1 to 31 days ago
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(oldDate, item1.id);

      // Purge
      const createItemRepo = require('../src/repositories/item.repository');
      const itemRepo = createItemRepo(db);
      const purged = itemRepo.purgeOldDeletedItems(30);
      assert.ok(purged >= 1, 'Should purge at least 1 item');

      // item1 gone, item2 still in trash
      const row1 = db.prepare('SELECT id FROM items WHERE id = ?').get(item1.id);
      assert.equal(row1, undefined, 'Old trashed item should be permanently deleted');
      const row2 = db.prepare('SELECT id FROM items WHERE id = ?').get(item2.id);
      assert.ok(row2, 'Recent trashed item should remain');
    });

    it('Cannot restore an item that is not soft-deleted', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'NotDeleted');
      await authRequest(app, user.sid).post('/api/items/' + item.id + '/restore').expect(400);
    });

    it('Cannot soft-delete another user\'s item', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'MyItem');

      // Create second user
      const user2 = await makeUser(app, { email: 'other-' + crypto.randomUUID().slice(0, 6) + '@test.com' });
      const logged2 = await loginUser(app, user2);
      user2.sid = logged2.sid;

      await authRequest(app, user2.sid).delete('/api/items/' + item.id).expect(404);
    });
  });

  // ═══════════════════════════════════════════
  // #54: Favorites
  // ═══════════════════════════════════════════
  describe('#54: Favorites', () => {
    it('POST /api/items/:id/favorite toggles favorite', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'FavItem');

      // Toggle on
      const res1 = await authRequest(app, user.sid)
        .post('/api/items/' + item.id + '/favorite')
        .expect(200);
      assert.equal(res1.body.favorite, 1);

      // Toggle off
      const res2 = await authRequest(app, user.sid)
        .post('/api/items/' + item.id + '/favorite')
        .expect(200);
      assert.equal(res2.body.favorite, 0);
    });

    it('GET /api/items sorts favorites first', async () => {
      const cat = await createCategory();
      const item1 = await createItem(cat.id, 'Normal');
      const item2 = await createItem(cat.id, 'Faved');

      // Favorite item2
      await authRequest(app, user.sid).post('/api/items/' + item2.id + '/favorite').expect(200);

      const res = await authRequest(app, user.sid).get('/api/items').expect(200);
      const body = Array.isArray(res.body) ? res.body : [];
      assert.ok(body.length >= 2);
      // First item should be the favorite
      assert.equal(body[0].favorite, 1);
    });

    it('GET /api/items?favorite=true filters to favorites only', async () => {
      const cat = await createCategory();
      await createItem(cat.id, 'Not Faved');
      const item2 = await createItem(cat.id, 'Faved');
      await authRequest(app, user.sid).post('/api/items/' + item2.id + '/favorite').expect(200);

      const res = await authRequest(app, user.sid).get('/api/items?favorite=true').expect(200);
      const body = Array.isArray(res.body) ? res.body : [];
      assert.equal(body.length, 1);
      assert.equal(body[0].id, item2.id);
    });
  });

  // ═══════════════════════════════════════════
  // #55: Theme Persistence
  // ═══════════════════════════════════════════
  describe('#55: Theme Persistence', () => {
    it('PUT /api/settings/theme saves theme preference', async () => {
      await authRequest(app, user.sid)
        .put('/api/settings/theme')
        .send({ value: 'dark' })
        .expect(200);

      const res = await authRequest(app, user.sid).get('/api/settings').expect(200);
      assert.equal(res.body.theme, 'dark');
    });

    it('Theme setting persists across requests', async () => {
      await authRequest(app, user.sid)
        .put('/api/settings/theme')
        .send({ value: 'light' })
        .expect(200);

      await authRequest(app, user.sid)
        .put('/api/settings/theme')
        .send({ value: 'dark' })
        .expect(200);

      const res = await authRequest(app, user.sid).get('/api/settings').expect(200);
      assert.equal(res.body.theme, 'dark');
    });
  });

  // ═══════════════════════════════════════════
  // #56: Item Version History
  // ═══════════════════════════════════════════
  describe('#56: Item Version History', () => {
    it('Updating an item records history entries', async () => {
      const cat = await createCategory();
      const cat2 = await createCategory('NewCat');
      const item = await createItem(cat.id, 'HistoryItem');

      // Update title
      await authRequest(app, user.sid)
        .put('/api/items/' + item.id)
        .send({ title: 'Updated Title' })
        .expect(200);

      // Update category
      await authRequest(app, user.sid)
        .put('/api/items/' + item.id)
        .send({ category_id: cat2.id })
        .expect(200);

      const res = await authRequest(app, user.sid)
        .get('/api/items/' + item.id + '/history')
        .expect(200);
      const history = Array.isArray(res.body) ? res.body : [];
      assert.ok(history.length >= 2, 'Should have at least 2 history entries');
    });

    it('GET /api/items/:id/history returns entries ordered by changed_at DESC', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'HistItem');

      await authRequest(app, user.sid)
        .put('/api/items/' + item.id)
        .send({ title: 'Change 1' })
        .expect(200);

      await authRequest(app, user.sid)
        .put('/api/items/' + item.id)
        .send({ title: 'Change 2' })
        .expect(200);

      const res = await authRequest(app, user.sid)
        .get('/api/items/' + item.id + '/history')
        .expect(200);
      const history = Array.isArray(res.body) ? res.body : [];
      assert.ok(history.length >= 2);
      // Most recent first
      if (history.length >= 2) {
        assert.ok(history[0].changed_at >= history[1].changed_at);
      }
    });

    it('History records field_name, old_value, new_value', async () => {
      const cat = await createCategory();
      const cat2 = await createCategory('Target');
      const item = await createItem(cat.id, 'FieldHistItem');

      await authRequest(app, user.sid)
        .put('/api/items/' + item.id)
        .send({ category_id: cat2.id })
        .expect(200);

      const res = await authRequest(app, user.sid)
        .get('/api/items/' + item.id + '/history')
        .expect(200);
      const history = Array.isArray(res.body) ? res.body : [];
      const catChange = history.find(h => h.field_name === 'category_id');
      assert.ok(catChange, 'Should have category_id change');
      assert.equal(String(catChange.old_value), String(cat.id));
      assert.equal(String(catChange.new_value), String(cat2.id));
    });

    it('Cannot view history of another user\'s item', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'Private');

      const user2 = await makeUser(app, { email: 'hist-' + crypto.randomUUID().slice(0, 6) + '@test.com' });
      const logged2 = await loginUser(app, user2);
      user2.sid = logged2.sid;

      await authRequest(app, user2.sid)
        .get('/api/items/' + item.id + '/history')
        .expect(404);
    });
  });

  // ═══════════════════════════════════════════
  // #57: Duplicate Detection
  // ═══════════════════════════════════════════
  describe('#57: Duplicate Detection', () => {
    it('Creating a duplicate item returns possibleDuplicate', async () => {
      const cat = await createCategory();
      const rt = getBuiltinRT();
      await createItem(cat.id, 'LoginEntry', { record_type_id: rt.id });

      const res = await authRequest(app, user.sid)
        .post('/api/items')
        .send({ category_id: cat.id, record_type_id: rt.id, title: 'LoginEntry' })
        .expect(201);
      assert.ok(res.body.possibleDuplicate, 'Should return possibleDuplicate');
      assert.ok(res.body.possibleDuplicate.id, 'possibleDuplicate should have id');
      assert.ok(res.body.possibleDuplicate.title, 'possibleDuplicate should have title');
    });

    it('Non-duplicate items do not return possibleDuplicate', async () => {
      const cat = await createCategory();
      const rt = getBuiltinRT();
      await createItem(cat.id, 'UniqueItem1');

      const res = await authRequest(app, user.sid)
        .post('/api/items')
        .send({ category_id: cat.id, record_type_id: rt.id, title: 'UniqueItem2' })
        .expect(201);
      assert.equal(res.body.possibleDuplicate, undefined);
    });

    it('Duplicate detection uses title + record_type_id', async () => {
      const cat = await createCategory();
      const rt = getBuiltinRT();
      // Same title, different record type => not a duplicate
      await createItem(cat.id, 'SameTitle', { record_type_id: rt.id });

      // Create a custom record type
      const rt2Res = await authRequest(app, user.sid)
        .post('/api/record-types')
        .send({ name: 'CustomType-' + crypto.randomUUID().slice(0, 6) })
        .expect(201);

      const res = await authRequest(app, user.sid)
        .post('/api/items')
        .send({ category_id: cat.id, record_type_id: rt2Res.body.id, title: 'SameTitle' })
        .expect(201);
      assert.equal(res.body.possibleDuplicate, undefined, 'Different record type should not trigger duplicate');
    });
  });

  // ═══════════════════════════════════════════
  // #58: Copy Item
  // ═══════════════════════════════════════════
  describe('#58: Copy Item', () => {
    it('POST /api/items/:id/copy creates a copy with " (Copy)" suffix', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'OrigItem');

      const res = await authRequest(app, user.sid)
        .post('/api/items/' + item.id + '/copy')
        .expect(201);
      assert.ok(res.body.id !== item.id);
      assert.equal(res.body.title, 'OrigItem (Copy)');
    });

    it('Copy preserves category and record type', async () => {
      const cat = await createCategory();
      const rt = getBuiltinRT();
      const item = await createItem(cat.id, 'CopyMe', { record_type_id: rt.id });

      const res = await authRequest(app, user.sid)
        .post('/api/items/' + item.id + '/copy')
        .expect(201);
      assert.equal(res.body.category_id, cat.id);
      assert.equal(res.body.record_type_id, rt.id);
    });

    it('Copy to a different category', async () => {
      const cat1 = await createCategory('Source');
      const cat2 = await createCategory('Target');
      const item = await createItem(cat1.id, 'MoveCopy');

      const res = await authRequest(app, user.sid)
        .post('/api/items/' + item.id + '/copy')
        .send({ category_id: cat2.id })
        .expect(201);
      assert.equal(res.body.category_id, cat2.id);
    });

    it('Cannot copy another user\'s item', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'MyItem');

      const user2 = await makeUser(app, { email: 'copy-' + crypto.randomUUID().slice(0, 6) + '@test.com' });
      const logged2 = await loginUser(app, user2);
      user2.sid = logged2.sid;

      await authRequest(app, user2.sid)
        .post('/api/items/' + item.id + '/copy')
        .expect(404);
    });
  });

  // ═══════════════════════════════════════════
  // #59: Bulk Tag Management
  // ═══════════════════════════════════════════
  describe('#59: Bulk Tag Management', () => {
    it('POST /api/items/bulk/tags adds tags to multiple items', async () => {
      const cat = await createCategory();
      const item1 = await createItem(cat.id, 'BulkTag1');
      const item2 = await createItem(cat.id, 'BulkTag2');
      const tag = await createTag('BulkTestTag');

      await authRequest(app, user.sid)
        .post('/api/items/bulk/tags')
        .send({ itemIds: [item1.id, item2.id], tagId: tag.id, action: 'add' })
        .expect(200);

      // Verify tags applied
      const res1 = await authRequest(app, user.sid).get('/api/items/' + item1.id).expect(200);
      const tags1 = (res1.body.tags || []).map(t => t.id || t.tag_id);
      assert.ok(tags1.includes(tag.id), 'Item 1 should have the tag');

      const res2 = await authRequest(app, user.sid).get('/api/items/' + item2.id).expect(200);
      const tags2 = (res2.body.tags || []).map(t => t.id || t.tag_id);
      assert.ok(tags2.includes(tag.id), 'Item 2 should have the tag');
    });

    it('POST /api/items/bulk/tags removes tags from multiple items', async () => {
      const cat = await createCategory();
      const tag = await createTag('RemoveTag');
      const item1 = await createItem(cat.id, 'TagRm1', { tags: [tag.id] });
      const item2 = await createItem(cat.id, 'TagRm2', { tags: [tag.id] });

      await authRequest(app, user.sid)
        .post('/api/items/bulk/tags')
        .send({ itemIds: [item1.id, item2.id], tagId: tag.id, action: 'remove' })
        .expect(200);

      const res1 = await authRequest(app, user.sid).get('/api/items/' + item1.id).expect(200);
      const tags1 = (res1.body.tags || []).map(t => t.id || t.tag_id);
      assert.ok(!tags1.includes(tag.id), 'Item 1 should not have the tag');
    });

    it('Bulk tag with invalid action returns 400', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'BadAction');
      const tag = await createTag('Invalid');

      await authRequest(app, user.sid)
        .post('/api/items/bulk/tags')
        .send({ itemIds: [item.id], tagId: tag.id, action: 'invalid' })
        .expect(400);
    });

    it('Bulk tag ignores items not owned by user', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'OwnedItem');
      const tag = await createTag('OwnerTag');

      const user2 = await makeUser(app, { email: 'bulktag-' + crypto.randomUUID().slice(0, 6) + '@test.com' });
      const logged2 = await loginUser(app, user2);
      user2.sid = logged2.sid;

      // user2 tries to tag user1's item - should succeed for API but not apply to items they don't own
      await authRequest(app, user2.sid)
        .post('/api/items/bulk/tags')
        .send({ itemIds: [item.id], tagId: tag.id, action: 'add' })
        .expect(200);

      // Item should still not have the tag (user2 doesn't own it)
      const res = await authRequest(app, user.sid).get('/api/items/' + item.id).expect(200);
      const itemTags = (res.body.tags || []).map(t => t.id || t.tag_id);
      assert.ok(!itemTags.includes(tag.id));
    });
  });

  // ═══════════════════════════════════════════
  // #60: Onboarding
  // ═══════════════════════════════════════════
  describe('#60: Onboarding / Settings', () => {
    it('Can save and retrieve onboarding_dismissed setting', async () => {
      await authRequest(app, user.sid)
        .put('/api/settings/onboarding_dismissed')
        .send({ value: 'true' })
        .expect(200);

      const res = await authRequest(app, user.sid).get('/api/settings').expect(200);
      assert.equal(res.body.onboarding_dismissed, 'true');
    });
  });

  // ═══════════════════════════════════════════
  // Additional edge cases
  // ═══════════════════════════════════════════
  describe('Edge cases', () => {
    it('GET /api/items/:id returns 404 for soft-deleted item', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'Gone');
      await authRequest(app, user.sid).delete('/api/items/' + item.id).expect(204);
      await authRequest(app, user.sid).get('/api/items/' + item.id).expect(404);
    });

    it('Trash route is registered before /:id (no conflict)', async () => {
      // GET /api/items/trash should return array, not 404 or try to parse "trash" as id
      const res = await authRequest(app, user.sid).get('/api/items/trash').expect(200);
      assert.ok(Array.isArray(res.body));
    });

    it('Count excludes soft-deleted items', async () => {
      const cat = await createCategory();
      await createItem(cat.id, 'A');
      const b = await createItem(cat.id, 'B');
      await authRequest(app, user.sid).delete('/api/items/' + b.id).expect(204);

      const res = await authRequest(app, user.sid).get('/api/items/count').expect(200);
      assert.equal(res.body.count, 1);
    });

    it('Soft-deleted items do not appear in recent', async () => {
      const cat = await createCategory();
      const item = await createItem(cat.id, 'Recent');
      await authRequest(app, user.sid).delete('/api/items/' + item.id).expect(204);

      const res = await authRequest(app, user.sid).get('/api/items/recent').expect(200);
      const ids = (Array.isArray(res.body) ? res.body : []).map(i => i.id);
      assert.ok(!ids.includes(item.id));
    });

    it('Bulk delete uses soft delete', async () => {
      const cat = await createCategory();
      const item1 = await createItem(cat.id, 'Bulk1');
      const item2 = await createItem(cat.id, 'Bulk2');

      await authRequest(app, user.sid)
        .post('/api/items/bulk')
        .send({ ids: [item1.id, item2.id], action: 'delete' })
        .expect(200);

      // Items should still exist in DB with deleted_at
      const rows = db.prepare('SELECT id, deleted_at FROM items WHERE id IN (?, ?)').all(item1.id, item2.id);
      assert.equal(rows.length, 2);
      rows.forEach(r => assert.ok(r.deleted_at, 'Bulk deleted items should have deleted_at'));
    });

    it('Copy item copies tags', async () => {
      const cat = await createCategory();
      const tag = await createTag('CopyTag');
      const item = await createItem(cat.id, 'WithTags', { tags: [tag.id] });

      const res = await authRequest(app, user.sid)
        .post('/api/items/' + item.id + '/copy')
        .expect(201);

      const copy = await authRequest(app, user.sid).get('/api/items/' + res.body.id).expect(200);
      const copyTags = (copy.body.tags || []).map(t => t.id || t.tag_id);
      assert.ok(copyTags.includes(tag.id), 'Copied item should have the same tag');
    });
  });
});
