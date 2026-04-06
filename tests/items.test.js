'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setup, cleanDb, teardown, makeUser } = require('./helpers');

describe('Items', () => {
  let app, db, vaultKey;
  let user, catRepo, itemRepo, tagRepo, fieldRepo, itemService;

  before(async () => {
    ({ app, db } = setup());
    const createCategoryRepo = require('../src/repositories/category.repository');
    const createItemRepo = require('../src/repositories/item.repository');
    const createTagRepo = require('../src/repositories/tag.repository');
    const createItemFieldRepo = require('../src/repositories/item-field.repository');
    const createItemService = require('../src/services/item.service');
    const createAuditLogger = require('../src/services/audit');
    catRepo = createCategoryRepo(db);
    itemRepo = createItemRepo(db);
    tagRepo = createTagRepo(db);
    fieldRepo = createItemFieldRepo(db);
    const audit = createAuditLogger(db);
    itemService = createItemService(db, audit);
  });

  beforeEach(async () => {
    cleanDb();
    user = await makeUser(app);
    vaultKey = crypto.randomBytes(32);
  });

  after(() => teardown());

  function createCategory(userId, name) {
    return catRepo.create(userId, { name: name || 'Default' });
  }

  function getRecordType() {
    return db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();
  }

  function getRecordTypeFields(rtId) {
    return db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rtId);
  }

  // ── Encryption ──

  describe('Encryption', () => {
    it('should encrypt title on create — ciphertext is NOT plaintext', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, {
        title: 'My Secret Login',
        category_id: cat.id,
        record_type_id: rt.id,
      });

      // Read raw from DB
      const raw = db.prepare('SELECT title_encrypted FROM items WHERE id = ?').get(item.id);
      assert.ok(raw.title_encrypted);
      assert.notEqual(raw.title_encrypted, 'My Secret Login', 'Title must be encrypted in DB');
    });

    it('should encrypt notes on create', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, {
        title: 'Test',
        notes: 'This is secret notes',
        category_id: cat.id,
        record_type_id: rt.id,
      });

      const raw = db.prepare('SELECT notes_encrypted FROM items WHERE id = ?').get(item.id);
      assert.ok(raw.notes_encrypted);
      assert.notEqual(raw.notes_encrypted, 'This is secret notes');
    });

    it('should decrypt title and notes on read', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, {
        title: 'Readable Title',
        notes: 'Readable Notes',
        category_id: cat.id,
        record_type_id: rt.id,
      });

      const found = itemService.findById(item.id, user.id, vaultKey);
      assert.equal(found.title, 'Readable Title');
      assert.equal(found.notes, 'Readable Notes');
    });

    it('should encrypt field values', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const fields = getRecordTypeFields(rt.id);
      const item = itemService.create(user.id, vaultKey, {
        title: 'WithFields',
        category_id: cat.id,
        record_type_id: rt.id,
        fields: [{ field_def_id: fields[0].id, value: 'secret_value_123' }],
      });

      // Check raw field in DB
      const rawField = db.prepare('SELECT value_encrypted FROM item_fields WHERE item_id = ?').get(item.id);
      assert.ok(rawField.value_encrypted);
      assert.notEqual(rawField.value_encrypted, 'secret_value_123');

      // But decrypted via service
      const found = itemService.findById(item.id, user.id, vaultKey);
      assert.equal(found.fields[0].value, 'secret_value_123');
    });

    it('should re-encrypt when updating title', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, {
        title: 'Original',
        category_id: cat.id,
        record_type_id: rt.id,
      });

      const rawBefore = db.prepare('SELECT title_encrypted FROM items WHERE id = ?').get(item.id);

      itemService.update(item.id, user.id, vaultKey, { title: 'Updated' });

      const rawAfter = db.prepare('SELECT title_encrypted FROM items WHERE id = ?').get(item.id);
      assert.notEqual(rawAfter.title_encrypted, rawBefore.title_encrypted);

      const found = itemService.findById(item.id, user.id, vaultKey);
      assert.equal(found.title, 'Updated');
    });
  });

  // ── CRUD ──

  describe('CRUD', () => {
    it('should create an item with tags', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const tag = tagRepo.create(user.id, 'important');
      const item = itemService.create(user.id, vaultKey, {
        title: 'Tagged Item',
        category_id: cat.id,
        record_type_id: rt.id,
        tags: [tag.id],
      });

      assert.equal(item.tags.length, 1);
      assert.equal(item.tags[0].name, 'important');
    });

    it('should create item with favorite flag', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, {
        title: 'Fav',
        category_id: cat.id,
        record_type_id: rt.id,
        favorite: true,
      });

      const found = itemService.findById(item.id, user.id, vaultKey);
      assert.equal(found.favorite, 1);
    });

    it('should update tags', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const t1 = tagRepo.create(user.id, 'old_tag');
      const t2 = tagRepo.create(user.id, 'new_tag');

      const item = itemService.create(user.id, vaultKey, {
        title: 'Test',
        category_id: cat.id,
        record_type_id: rt.id,
        tags: [t1.id],
      });

      const updated = itemService.update(item.id, user.id, vaultKey, { tags: [t2.id] });
      assert.equal(updated.tags.length, 1);
      assert.equal(updated.tags[0].name, 'new_tag');
    });

    it('should update fields', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const fields = getRecordTypeFields(rt.id);

      const item = itemService.create(user.id, vaultKey, {
        title: 'FieldUpdate',
        category_id: cat.id,
        record_type_id: rt.id,
        fields: [{ field_def_id: fields[0].id, value: 'old_value' }],
      });

      const updated = itemService.update(item.id, user.id, vaultKey, {
        fields: [{ field_def_id: fields[0].id, value: 'new_value' }],
      });

      assert.equal(updated.fields[0].value, 'new_value');
    });

    it('should delete an item', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, {
        title: 'ToDelete',
        category_id: cat.id,
        record_type_id: rt.id,
      });

      itemService.delete(item.id, user.id);
      assert.throws(() => itemRepo.findById(item.id, user.id), /not found/i);
    });

    it('should cascade delete item fields when item is deleted', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const rtFields = getRecordTypeFields(rt.id);

      const item = itemService.create(user.id, vaultKey, {
        title: 'CascadeFields',
        category_id: cat.id,
        record_type_id: rt.id,
        fields: [{ field_def_id: rtFields[0].id, value: 'val' }],
      });

      // Soft delete preserves fields (for restore)
      itemService.delete(item.id, user.id);
      const afterSoft = fieldRepo.findByItem(item.id);
      assert.ok(afterSoft.length > 0, 'Fields should survive soft delete');

      // Permanent delete cascades
      itemRepo.permanentlyDelete(item.id);
      const remaining = fieldRepo.findByItem(item.id);
      assert.equal(remaining.length, 0);
    });

    it('should cascade delete item tags when item is deleted', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const tag = tagRepo.create(user.id, 'cascade');

      const item = itemService.create(user.id, vaultKey, {
        title: 'CascadeTags',
        category_id: cat.id,
        record_type_id: rt.id,
        tags: [tag.id],
      });

      // Soft delete preserves tags (for restore)
      itemService.delete(item.id, user.id);
      const afterSoft = tagRepo.findByItem(item.id);
      assert.ok(afterSoft.length > 0, 'Tags should survive soft delete');

      // Permanent delete cascades
      itemRepo.permanentlyDelete(item.id);
      const tags = tagRepo.findByItem(item.id);
      assert.equal(tags.length, 0);
    });

    it('should handle item with null notes', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, {
        title: 'NoNotes',
        category_id: cat.id,
        record_type_id: rt.id,
      });
      const found = itemService.findById(item.id, user.id, vaultKey);
      assert.equal(found.notes, null);
    });

    it('should clear notes on update', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, {
        title: 'HasNotes',
        notes: 'Some notes',
        category_id: cat.id,
        record_type_id: rt.id,
      });

      const updated = itemService.update(item.id, user.id, vaultKey, { notes: '' });
      assert.equal(updated.notes, null);
    });
  });

  // ── Filtering ──

  describe('Filtering', () => {
    let cat1, cat2, rt;

    beforeEach(() => {
      cat1 = createCategory(user.id, 'Cat1');
      cat2 = createCategory(user.id, 'Cat2');
      rt = getRecordType();
    });

    it('should filter by category_id', () => {
      itemService.create(user.id, vaultKey, { title: 'A', category_id: cat1.id, record_type_id: rt.id });
      itemService.create(user.id, vaultKey, { title: 'B', category_id: cat2.id, record_type_id: rt.id });

      const filtered = itemService.findAll(user.id, vaultKey, { category_id: cat1.id });
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].title, 'A');
    });

    it('should filter by record_type_id', () => {
      const types = db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 2').all();
      itemService.create(user.id, vaultKey, { title: 'Type1', category_id: cat1.id, record_type_id: types[0].id });
      itemService.create(user.id, vaultKey, { title: 'Type2', category_id: cat1.id, record_type_id: types[1].id });

      const filtered = itemService.findAll(user.id, vaultKey, { record_type_id: types[0].id });
      assert.equal(filtered.length, 1);
    });

    it('should filter by tag_id', () => {
      const tag = tagRepo.create(user.id, 'filter_tag');
      const item1 = itemService.create(user.id, vaultKey, { title: 'Has Tag', category_id: cat1.id, record_type_id: rt.id, tags: [tag.id] });
      itemService.create(user.id, vaultKey, { title: 'No Tag', category_id: cat1.id, record_type_id: rt.id });

      const filtered = itemService.findAll(user.id, vaultKey, { tag_id: tag.id });
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, item1.id);
    });

    it('should filter by favorite', () => {
      itemService.create(user.id, vaultKey, { title: 'Fav', category_id: cat1.id, record_type_id: rt.id, favorite: true });
      itemService.create(user.id, vaultKey, { title: 'Not', category_id: cat1.id, record_type_id: rt.id });

      const filtered = itemService.findAll(user.id, vaultKey, { favorite: true });
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].title, 'Fav');
    });
  });

  // ── Pagination ──

  describe('Pagination', () => {
    it('should paginate results', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      for (let i = 0; i < 5; i++) {
        itemService.create(user.id, vaultKey, { title: `Item ${i}`, category_id: cat.id, record_type_id: rt.id });
      }

      const page1 = itemService.findAll(user.id, vaultKey, { page: 1, limit: 2 });
      assert.equal(page1.length, 2);

      const page2 = itemService.findAll(user.id, vaultKey, { page: 2, limit: 2 });
      assert.equal(page2.length, 2);

      const page3 = itemService.findAll(user.id, vaultKey, { page: 3, limit: 2 });
      assert.equal(page3.length, 1);
    });
  });

  // ── Sorting ──

  describe('Sorting', () => {
    it('should sort by created descending', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      itemService.create(user.id, vaultKey, { title: 'First', category_id: cat.id, record_type_id: rt.id });
      itemService.create(user.id, vaultKey, { title: 'Second', category_id: cat.id, record_type_id: rt.id });

      const sorted = itemService.findAll(user.id, vaultKey, { sort: 'created' });
      assert.equal(sorted[0].title, 'Second');
      assert.equal(sorted[1].title, 'First');
    });

    it('should sort by updated descending', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item1 = itemService.create(user.id, vaultKey, { title: 'First', category_id: cat.id, record_type_id: rt.id });
      const item2 = itemService.create(user.id, vaultKey, { title: 'Second', category_id: cat.id, record_type_id: rt.id });

      // Force a different updated_at by direct DB update
      db.prepare("UPDATE items SET updated_at = datetime('now', '+1 second') WHERE id = ?").run(item1.id);

      const sorted = itemService.findAll(user.id, vaultKey, { sort: 'updated' });
      assert.equal(sorted[0].id, item1.id);
    });
  });

  // ── Bulk operations ──

  describe('Bulk operations', () => {
    it('should bulk delete items', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const i1 = itemService.create(user.id, vaultKey, { title: 'D1', category_id: cat.id, record_type_id: rt.id });
      const i2 = itemService.create(user.id, vaultKey, { title: 'D2', category_id: cat.id, record_type_id: rt.id });
      itemService.create(user.id, vaultKey, { title: 'Keep', category_id: cat.id, record_type_id: rt.id });

      itemService.bulkDelete(user.id, [i1.id, i2.id]);
      const remaining = itemService.findAll(user.id, vaultKey);
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].title, 'Keep');
    });

    it('should bulk move items to another category', () => {
      const cat1 = createCategory(user.id, 'Source');
      const cat2 = createCategory(user.id, 'Dest');
      const rt = getRecordType();

      const i1 = itemService.create(user.id, vaultKey, { title: 'M1', category_id: cat1.id, record_type_id: rt.id });
      const i2 = itemService.create(user.id, vaultKey, { title: 'M2', category_id: cat1.id, record_type_id: rt.id });

      itemService.bulkMove(user.id, [i1.id, i2.id], cat2.id);

      const moved = itemService.findAll(user.id, vaultKey, { category_id: cat2.id });
      assert.equal(moved.length, 2);
    });
  });

  // ── Favorite toggle ──

  describe('Favorite', () => {
    it('should toggle favorite on', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, { title: 'Fav', category_id: cat.id, record_type_id: rt.id });
      const updated = itemService.update(item.id, user.id, vaultKey, { favorite: true });
      assert.equal(updated.favorite, 1);
    });

    it('should toggle favorite off', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, { title: 'Fav', category_id: cat.id, record_type_id: rt.id, favorite: true });
      const updated = itemService.update(item.id, user.id, vaultKey, { favorite: false });
      assert.equal(updated.favorite, 0);
    });
  });

  // ── Count ──

  describe('Count', () => {
    it('should count items by user', () => {
      const cat = createCategory(user.id);
      const rt = getRecordType();
      itemService.create(user.id, vaultKey, { title: 'A', category_id: cat.id, record_type_id: rt.id });
      itemService.create(user.id, vaultKey, { title: 'B', category_id: cat.id, record_type_id: rt.id });
      assert.equal(itemService.countByUser(user.id), 2);
    });

    it('should return 0 for user with no items', () => {
      assert.equal(itemService.countByUser(user.id), 0);
    });
  });

  // ── User isolation (IDOR) ──

  describe('User isolation', () => {
    it('should not find items of another user', async () => {
      const user2 = await makeUser(app, { email: 'idor1@test.com' });
      const cat = createCategory(user.id);
      const rt = getRecordType();
      itemService.create(user.id, vaultKey, { title: 'Secret', category_id: cat.id, record_type_id: rt.id });

      const others = itemService.findAll(user2.id, vaultKey);
      assert.equal(others.length, 0);
    });

    it('should not access item by id from another user', async () => {
      const user2 = await makeUser(app, { email: 'idor2@test.com' });
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, { title: 'Private', category_id: cat.id, record_type_id: rt.id });

      assert.throws(() => itemService.findById(item.id, user2.id, vaultKey), /not found/i);
    });

    it('should not update item of another user', async () => {
      const user2 = await makeUser(app, { email: 'idor3@test.com' });
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, { title: 'Protected', category_id: cat.id, record_type_id: rt.id });

      assert.throws(() => itemService.update(item.id, user2.id, vaultKey, { title: 'Hacked' }), /not found/i);
    });

    it('should not delete item of another user', async () => {
      const user2 = await makeUser(app, { email: 'idor4@test.com' });
      const cat = createCategory(user.id);
      const rt = getRecordType();
      const item = itemService.create(user.id, vaultKey, { title: 'Safe', category_id: cat.id, record_type_id: rt.id });

      assert.throws(() => itemService.delete(item.id, user2.id), /not found/i);
    });

    it('should not count items of another user', async () => {
      const user2 = await makeUser(app, { email: 'idor5@test.com' });
      const cat = createCategory(user.id);
      const rt = getRecordType();
      itemService.create(user.id, vaultKey, { title: 'Mine', category_id: cat.id, record_type_id: rt.id });
      assert.equal(itemService.countByUser(user2.id), 0);
    });
  });

  // ── Item field repository ──

  describe('Item field repository', () => {
    it('should create and find fields by item', () => {
      const cat = createCategory(user.id);
      const { encrypt } = require('../src/services/encryption');
      const titleEnc = encrypt('Test', vaultKey);
      const item = itemRepo.create(user.id, {
        category_id: cat.id,
        title_encrypted: titleEnc.ciphertext,
        title_iv: titleEnc.iv,
        title_tag: titleEnc.tag,
      });

      const valEnc = encrypt('secret', vaultKey);
      fieldRepo.create(item.id, {
        field_def_id: 1,
        value_encrypted: valEnc.ciphertext,
        value_iv: valEnc.iv,
        value_tag: valEnc.tag,
      });

      const fields = fieldRepo.findByItem(item.id);
      assert.equal(fields.length, 1);
    });

    it('should bulk create fields', () => {
      const cat = createCategory(user.id);
      const { encrypt } = require('../src/services/encryption');
      const titleEnc = encrypt('Bulk', vaultKey);
      const item = itemRepo.create(user.id, {
        category_id: cat.id,
        title_encrypted: titleEnc.ciphertext,
        title_iv: titleEnc.iv,
        title_tag: titleEnc.tag,
      });

      const e1 = encrypt('v1', vaultKey);
      const e2 = encrypt('v2', vaultKey);
      const created = fieldRepo.bulkCreate(item.id, [
        { field_def_id: 1, value_encrypted: e1.ciphertext, value_iv: e1.iv, value_tag: e1.tag },
        { field_def_id: 2, value_encrypted: e2.ciphertext, value_iv: e2.iv, value_tag: e2.tag },
      ]);

      assert.equal(created.length, 2);
    });

    it('should delete all fields by item', () => {
      const cat = createCategory(user.id);
      const { encrypt } = require('../src/services/encryption');
      const titleEnc = encrypt('Del', vaultKey);
      const item = itemRepo.create(user.id, {
        category_id: cat.id,
        title_encrypted: titleEnc.ciphertext,
        title_iv: titleEnc.iv,
        title_tag: titleEnc.tag,
      });

      const valEnc = encrypt('x', vaultKey);
      fieldRepo.create(item.id, { field_def_id: 1, value_encrypted: valEnc.ciphertext, value_iv: valEnc.iv, value_tag: valEnc.tag });
      fieldRepo.deleteByItem(item.id);
      assert.equal(fieldRepo.findByItem(item.id).length, 0);
    });
  });

  // ── Item reorder ──

  describe('Reorder', () => {
    it('should reorder items within a category', () => {
      const cat = createCategory(user.id);
      const { encrypt } = require('../src/services/encryption');
      const e1 = encrypt('A', vaultKey);
      const e2 = encrypt('B', vaultKey);
      const e3 = encrypt('C', vaultKey);

      const i1 = itemRepo.create(user.id, { category_id: cat.id, title_encrypted: e1.ciphertext, title_iv: e1.iv, title_tag: e1.tag });
      const i2 = itemRepo.create(user.id, { category_id: cat.id, title_encrypted: e2.ciphertext, title_iv: e2.iv, title_tag: e2.tag });
      const i3 = itemRepo.create(user.id, { category_id: cat.id, title_encrypted: e3.ciphertext, title_iv: e3.iv, title_tag: e3.tag });

      itemRepo.reorder(user.id, cat.id, [i3.id, i1.id, i2.id]);

      const items = itemRepo.findAll(user.id, { category_id: cat.id });
      assert.equal(items[0].id, i3.id);
      assert.equal(items[1].id, i1.id);
      assert.equal(items[2].id, i2.id);
    });
  });

  // ── Schema validation ──

  describe('Schema', () => {
    it('should validate create item schema', () => {
      const { createItemSchema } = require('../src/schemas/item.schema');
      const r = createItemSchema.safeParse({
        category_id: 1, record_type_id: 1, title: 'Test',
      });
      assert.ok(r.success);
    });

    it('should reject empty title', () => {
      const { createItemSchema } = require('../src/schemas/item.schema');
      const r = createItemSchema.safeParse({
        category_id: 1, record_type_id: 1, title: '',
      });
      assert.ok(!r.success);
    });

    it('should reject title longer than 500 chars', () => {
      const { createItemSchema } = require('../src/schemas/item.schema');
      const r = createItemSchema.safeParse({
        category_id: 1, record_type_id: 1, title: 'x'.repeat(501),
      });
      assert.ok(!r.success);
    });

    it('should validate bulk schema', () => {
      const { bulkItemSchema } = require('../src/schemas/item.schema');
      const r = bulkItemSchema.safeParse({ ids: [1, 2], action: 'delete' });
      assert.ok(r.success);
    });

    it('should require category_id for move action', () => {
      const { bulkItemSchema } = require('../src/schemas/item.schema');
      const r = bulkItemSchema.safeParse({ ids: [1], action: 'move' });
      assert.ok(!r.success);
    });

    it('should accept move with category_id', () => {
      const { bulkItemSchema } = require('../src/schemas/item.schema');
      const r = bulkItemSchema.safeParse({ ids: [1], action: 'move', category_id: 5 });
      assert.ok(r.success);
    });

    it('should validate update schema with partial data', () => {
      const { updateItemSchema } = require('../src/schemas/item.schema');
      const r = updateItemSchema.safeParse({ title: 'New Title' });
      assert.ok(r.success);
    });

    it('should validate fields in create schema', () => {
      const { createItemSchema } = require('../src/schemas/item.schema');
      const r = createItemSchema.safeParse({
        category_id: 1, record_type_id: 1, title: 'T',
        fields: [{ field_def_id: 1, value: 'v' }],
      });
      assert.ok(r.success);
    });
  });

  // ── Reorder schema ──

  describe('Reorder schema', () => {
    it('should validate reorder schema', () => {
      const { reorderSchema } = require('../src/schemas/common.schema');
      const r = reorderSchema.safeParse({ ids: [3, 1, 2] });
      assert.ok(r.success);
    });

    it('should reject empty ids in reorder schema', () => {
      const { reorderSchema } = require('../src/schemas/common.schema');
      const r = reorderSchema.safeParse({ ids: [] });
      assert.ok(!r.success);
    });
  });
});
