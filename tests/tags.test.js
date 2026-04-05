'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser } = require('./helpers');

describe('Tags', () => {
  let app, db, user, tagRepo;

  before(async () => {
    ({ app, db } = setup());
    const createTagRepo = require('../src/repositories/tag.repository');
    tagRepo = createTagRepo(db);
  });

  beforeEach(async () => {
    cleanDb();
    user = await makeUser(app);
  });

  after(() => teardown());

  // ── CRUD ──

  describe('CRUD', () => {
    it('should create a tag', () => {
      const tag = tagRepo.create(user.id, 'important', '#FF0000');
      assert.equal(tag.name, 'important');
      assert.equal(tag.color, '#FF0000');
      assert.equal(tag.user_id, user.id);
    });

    it('should create a tag with default color', () => {
      const tag = tagRepo.create(user.id, 'default');
      assert.equal(tag.color, '#64748B');
    });

    it('should find all tags for user', () => {
      tagRepo.create(user.id, 'tag1');
      tagRepo.create(user.id, 'tag2');
      const all = tagRepo.findAll(user.id);
      assert.equal(all.length, 2);
    });

    it('should find tag by id', () => {
      const tag = tagRepo.create(user.id, 'findme');
      const found = tagRepo.findById(tag.id, user.id);
      assert.equal(found.name, 'findme');
    });

    it('should update a tag name', () => {
      const tag = tagRepo.create(user.id, 'old');
      const updated = tagRepo.update(tag.id, user.id, 'new', null);
      assert.equal(updated.name, 'new');
    });

    it('should update a tag color', () => {
      const tag = tagRepo.create(user.id, 'colored');
      const updated = tagRepo.update(tag.id, user.id, null, '#AABB00');
      assert.equal(updated.color, '#AABB00');
    });

    it('should delete a tag', () => {
      const tag = tagRepo.create(user.id, 'gone');
      tagRepo.delete(tag.id, user.id);
      assert.throws(() => tagRepo.findById(tag.id, user.id), /not found/i);
    });

    it('should throw when finding non-existent tag', () => {
      assert.throws(() => tagRepo.findById(99999, user.id), /not found/i);
    });
  });

  // ── Unique name per user ──

  describe('Uniqueness', () => {
    it('should reject duplicate tag name for same user', () => {
      tagRepo.create(user.id, 'unique');
      assert.throws(() => tagRepo.create(user.id, 'unique'), /already exists/i);
    });

    it('should allow same tag name for different users', async () => {
      const user2 = await makeUser(app, { email: 'user2@test.com' });
      tagRepo.create(user.id, 'shared');
      const tag2 = tagRepo.create(user2.id, 'shared');
      assert.ok(tag2.id);
    });

    it('should reject duplicate name on update', () => {
      tagRepo.create(user.id, 'taken');
      const other = tagRepo.create(user.id, 'other');
      assert.throws(() => tagRepo.update(other.id, user.id, 'taken', null), /already exists/i);
    });
  });

  // ── Link/unlink items ──

  describe('Item linking', () => {
    let catRepo, itemRepo, vaultKey;

    before(() => {
      const createCategoryRepo = require('../src/repositories/category.repository');
      const createItemRepo = require('../src/repositories/item.repository');
      catRepo = createCategoryRepo(db);
      itemRepo = createItemRepo(db);
      vaultKey = require('crypto').randomBytes(32);
    });

    function createTestItem(userId) {
      const cat = catRepo.create(userId, { name: 'TestCat' });
      const { encrypt } = require('../src/services/encryption');
      const titleEnc = encrypt('Test', vaultKey);
      return itemRepo.create(userId, {
        category_id: cat.id,
        title_encrypted: titleEnc.ciphertext,
        title_iv: titleEnc.iv,
        title_tag: titleEnc.tag,
      });
    }

    it('should link a tag to an item', () => {
      const item = createTestItem(user.id);
      const tag = tagRepo.create(user.id, 'linked');
      tagRepo.linkItem(item.id, tag.id);
      const tags = tagRepo.findByItem(item.id);
      assert.equal(tags.length, 1);
      assert.equal(tags[0].name, 'linked');
    });

    it('should unlink a tag from an item', () => {
      const item = createTestItem(user.id);
      const tag = tagRepo.create(user.id, 'unlink');
      tagRepo.linkItem(item.id, tag.id);
      tagRepo.unlinkItem(item.id, tag.id);
      const tags = tagRepo.findByItem(item.id);
      assert.equal(tags.length, 0);
    });

    it('should unlink all tags from an item', () => {
      const item = createTestItem(user.id);
      const t1 = tagRepo.create(user.id, 'a');
      const t2 = tagRepo.create(user.id, 'b');
      tagRepo.linkItem(item.id, t1.id);
      tagRepo.linkItem(item.id, t2.id);
      tagRepo.unlinkAllFromItem(item.id);
      const tags = tagRepo.findByItem(item.id);
      assert.equal(tags.length, 0);
    });

    it('should handle duplicate tag link gracefully', () => {
      const item = createTestItem(user.id);
      const tag = tagRepo.create(user.id, 'dup');
      tagRepo.linkItem(item.id, tag.id);
      tagRepo.linkItem(item.id, tag.id); // should not throw
      const tags = tagRepo.findByItem(item.id);
      assert.equal(tags.length, 1);
    });
  });

  // ── Usage counts ──

  describe('Usage counts', () => {
    it('should return usage counts', () => {
      const { encrypt } = require('../src/services/encryption');
      const createCategoryRepo = require('../src/repositories/category.repository');
      const createItemRepo = require('../src/repositories/item.repository');
      const catRepo = createCategoryRepo(db);
      const itemRepo = createItemRepo(db);
      const vaultKey = require('crypto').randomBytes(32);

      const cat = catRepo.create(user.id, { name: 'Counts' });
      const titleEnc = encrypt('Item', vaultKey);
      const item = itemRepo.create(user.id, {
        category_id: cat.id,
        title_encrypted: titleEnc.ciphertext,
        title_iv: titleEnc.iv,
        title_tag: titleEnc.tag,
      });

      const tag = tagRepo.create(user.id, 'counted');
      tagRepo.linkItem(item.id, tag.id);

      const unusedTag = tagRepo.create(user.id, 'unused');

      const counts = tagRepo.usageCounts(user.id);
      assert.equal(counts.length, 2);
      const used = counts.find(c => c.id === tag.id);
      const unused = counts.find(c => c.id === unusedTag.id);
      assert.equal(used.count, 1);
      assert.equal(unused.count, 0);
    });
  });

  // ── User isolation ──

  describe('User isolation', () => {
    it('should not show tags of another user', async () => {
      const user2 = await makeUser(app, { email: 'iso1@test.com' });
      tagRepo.create(user.id, 'private');
      const tags = tagRepo.findAll(user2.id);
      assert.equal(tags.length, 0);
    });

    it('should not find another user tag by id', async () => {
      const user2 = await makeUser(app, { email: 'iso2@test.com' });
      const tag = tagRepo.create(user.id, 'mine');
      assert.throws(() => tagRepo.findById(tag.id, user2.id), /not found/i);
    });

    it('should not delete another user tag', async () => {
      const user2 = await makeUser(app, { email: 'iso3@test.com' });
      const tag = tagRepo.create(user.id, 'protected');
      assert.throws(() => tagRepo.delete(tag.id, user2.id), /not found/i);
    });
  });

  // ── Schema ──

  describe('Schema', () => {
    it('should validate create tag schema', () => {
      const { createTagSchema } = require('../src/schemas/tag.schema');
      const r = createTagSchema.safeParse({ name: 'test' });
      assert.ok(r.success);
    });

    it('should reject too-long tag name', () => {
      const { createTagSchema } = require('../src/schemas/tag.schema');
      const r = createTagSchema.safeParse({ name: 'a'.repeat(51) });
      assert.ok(!r.success);
    });

    it('should reject invalid hex color', () => {
      const { createTagSchema } = require('../src/schemas/tag.schema');
      const r = createTagSchema.safeParse({ name: 'test', color: 'red' });
      assert.ok(!r.success);
    });
  });
});
