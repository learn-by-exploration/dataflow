'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser } = require('./helpers');

describe('Categories', () => {
  let app, db, user, categoryRepo;

  before(async () => {
    ({ app, db } = setup());
    const createCategoryRepo = require('../src/repositories/category.repository');
    categoryRepo = createCategoryRepo(db);
  });

  beforeEach(async () => {
    cleanDb();
    user = await makeUser(app);
  });

  after(() => teardown());

  // ── CRUD lifecycle ──

  describe('CRUD', () => {
    it('should create a category with defaults', () => {
      const cat = categoryRepo.create(user.id, { name: 'Passwords' });
      assert.equal(cat.name, 'Passwords');
      assert.equal(cat.icon, '📁');
      assert.equal(cat.color, '#2563EB');
      assert.equal(cat.user_id, user.id);
    });

    it('should create a category with custom fields', () => {
      const cat = categoryRepo.create(user.id, { name: 'Finance', icon: '💰', color: '#FF0000' });
      assert.equal(cat.name, 'Finance');
      assert.equal(cat.icon, '💰');
      assert.equal(cat.color, '#FF0000');
    });

    it('should find all categories for a user', () => {
      categoryRepo.create(user.id, { name: 'Cat A' });
      categoryRepo.create(user.id, { name: 'Cat B' });
      const all = categoryRepo.findAll(user.id);
      assert.equal(all.length, 2);
    });

    it('should find category by id', () => {
      const created = categoryRepo.create(user.id, { name: 'Test' });
      const found = categoryRepo.findById(created.id, user.id);
      assert.equal(found.name, 'Test');
    });

    it('should update a category', () => {
      const cat = categoryRepo.create(user.id, { name: 'Old' });
      const updated = categoryRepo.update(cat.id, user.id, { name: 'New', icon: '🔑' });
      assert.equal(updated.name, 'New');
      assert.equal(updated.icon, '🔑');
    });

    it('should delete a category', () => {
      const cat = categoryRepo.create(user.id, { name: 'ToDelete' });
      categoryRepo.delete(cat.id, user.id);
      assert.throws(() => categoryRepo.findById(cat.id, user.id), /not found/i);
    });

    it('should return category unchanged when updating with no fields', () => {
      const cat = categoryRepo.create(user.id, { name: 'Same' });
      const same = categoryRepo.update(cat.id, user.id, {});
      assert.equal(same.name, 'Same');
    });
  });

  // ── Reorder ──

  describe('Reorder', () => {
    it('should reorder categories', () => {
      const a = categoryRepo.create(user.id, { name: 'A' });
      const b = categoryRepo.create(user.id, { name: 'B' });
      const c = categoryRepo.create(user.id, { name: 'C' });
      categoryRepo.reorder(user.id, [c.id, a.id, b.id]);
      const all = categoryRepo.findAll(user.id);
      assert.equal(all[0].id, c.id);
      assert.equal(all[1].id, a.id);
      assert.equal(all[2].id, b.id);
    });

    it('should auto-assign position on create', () => {
      const a = categoryRepo.create(user.id, { name: 'A' });
      const b = categoryRepo.create(user.id, { name: 'B' });
      assert.equal(a.position, 0);
      assert.equal(b.position, 1);
    });
  });

  // ── Validation ──

  describe('Validation', () => {
    it('should reject empty name via service', () => {
      const createCategoryService = require('../src/services/category.service');
      const svc = createCategoryService(db);
      assert.throws(() => svc.create(user.id, { name: '' }), /required|empty/i);
    });

    it('should reject whitespace-only name via service', () => {
      const createCategoryService = require('../src/services/category.service');
      const svc = createCategoryService(db);
      assert.throws(() => svc.create(user.id, { name: '   ' }), /required|empty/i);
    });

    it('should reject empty name on update via service', () => {
      const createCategoryService = require('../src/services/category.service');
      const svc = createCategoryService(db);
      const cat = svc.create(user.id, { name: 'Valid' });
      assert.throws(() => svc.update(cat.id, user.id, { name: '' }), /empty/i);
    });
  });

  // ── Not found ──

  describe('Not found', () => {
    it('should throw NotFoundError for non-existent category', () => {
      assert.throws(() => categoryRepo.findById(99999, user.id), /not found/i);
    });

    it('should throw NotFoundError when updating non-existent category', () => {
      assert.throws(() => categoryRepo.update(99999, user.id, { name: 'X' }), /not found/i);
    });

    it('should throw NotFoundError when deleting non-existent category', () => {
      assert.throws(() => categoryRepo.delete(99999, user.id), /not found/i);
    });
  });

  // ── Cascade ──

  describe('Cascade', () => {
    it('should cascade-delete items when category is deleted', () => {
      const createItemRepo = require('../src/repositories/item.repository');
      const itemRepo = createItemRepo(db);
      const { encrypt } = require('../src/services/encryption');
      const vaultKey = require('crypto').randomBytes(32);

      const cat = categoryRepo.create(user.id, { name: 'CascadeTest' });
      const titleEnc = encrypt('Test Item', vaultKey);
      itemRepo.create(user.id, {
        category_id: cat.id,
        title_encrypted: titleEnc.ciphertext,
        title_iv: titleEnc.iv,
        title_tag: titleEnc.tag,
      });

      const countBefore = itemRepo.countByUser(user.id);
      assert.equal(countBefore, 1);

      categoryRepo.delete(cat.id, user.id);
      const countAfter = itemRepo.countByUser(user.id);
      assert.equal(countAfter, 0);
    });
  });

  // ── User isolation ──

  describe('User isolation', () => {
    it('should not find categories of another user', async () => {
      const user2 = await makeUser(app, { email: 'other@test.com' });
      categoryRepo.create(user.id, { name: 'Private' });
      const others = categoryRepo.findAll(user2.id);
      assert.equal(others.length, 0);
    });

    it('should not find another user category by id', async () => {
      const user2 = await makeUser(app, { email: 'user2@test.com' });
      const cat = categoryRepo.create(user.id, { name: 'Mine' });
      assert.throws(() => categoryRepo.findById(cat.id, user2.id), /not found/i);
    });

    it('should not update another user category', async () => {
      const user2 = await makeUser(app, { email: 'user3@test.com' });
      const cat = categoryRepo.create(user.id, { name: 'Mine' });
      assert.throws(() => categoryRepo.update(cat.id, user2.id, { name: 'Hacked' }), /not found/i);
    });

    it('should not delete another user category', async () => {
      const user2 = await makeUser(app, { email: 'user4@test.com' });
      const cat = categoryRepo.create(user.id, { name: 'Mine' });
      assert.throws(() => categoryRepo.delete(cat.id, user2.id), /not found/i);
    });
  });

  // ── Category schema validation ──

  describe('Schema', () => {
    it('should validate create schema', () => {
      const { createCategorySchema } = require('../src/schemas/category.schema');
      const good = createCategorySchema.safeParse({ name: 'Test' });
      assert.ok(good.success);
    });

    it('should reject invalid hex color in create', () => {
      const { createCategorySchema } = require('../src/schemas/category.schema');
      const bad = createCategorySchema.safeParse({ name: 'X', color: 'notacolor' });
      assert.ok(!bad.success);
    });

    it('should reject empty name in schema', () => {
      const { createCategorySchema } = require('../src/schemas/category.schema');
      const bad = createCategorySchema.safeParse({ name: '' });
      assert.ok(!bad.success);
    });

    it('should accept valid hex color', () => {
      const { createCategorySchema } = require('../src/schemas/category.schema');
      const good = createCategorySchema.safeParse({ name: 'Test', color: '#AABBCC' });
      assert.ok(good.success);
    });
  });

  // ── Service with audit ──

  describe('Service audit', () => {
    it('should log audit on delete', () => {
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);
      const createCategoryService = require('../src/services/category.service');
      const svc = createCategoryService(db, audit);
      const cat = svc.create(user.id, { name: 'AuditTest' });
      svc.delete(cat.id, user.id);
      const log = db.prepare('SELECT * FROM audit_log WHERE action = ? AND resource_id = ?').get('category.delete', String(cat.id));
      assert.ok(log, 'Audit log entry should exist');
      assert.equal(log.user_id, user.id);
    });
  });
});
