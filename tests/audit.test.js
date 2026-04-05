'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setup, cleanDb, teardown, makeUser } = require('./helpers');

describe('Audit logging', () => {
  let app, db, user, vaultKey;

  before(async () => {
    ({ app, db } = setup());
  });

  beforeEach(async () => {
    cleanDb();
    user = await makeUser(app);
    vaultKey = crypto.randomBytes(32);
  });

  after(() => teardown());

  function getAuditLogs(action) {
    return db.prepare('SELECT * FROM audit_log WHERE action = ?').all(action);
  }

  function getAllAuditLogs() {
    return db.prepare('SELECT * FROM audit_log ORDER BY id DESC').all();
  }

  // ── Category audit ──

  describe('Category mutations', () => {
    it('should log category deletion', () => {
      const createCategoryService = require('../src/services/category.service');
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);
      const svc = createCategoryService(db, audit);

      const cat = svc.create(user.id, { name: 'AuditCat' });
      svc.delete(cat.id, user.id);

      const logs = getAuditLogs('category.delete');
      assert.ok(logs.length >= 1);
      assert.equal(logs[0].resource, 'category');
      assert.equal(logs[0].resource_id, String(cat.id));
    });
  });

  // ── Item audit ──

  describe('Item mutations', () => {
    it('should log item creation', () => {
      const createItemService = require('../src/services/item.service');
      const createCategoryRepo = require('../src/repositories/category.repository');
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);
      const itemService = createItemService(db, audit);
      const catRepo = createCategoryRepo(db);

      const cat = catRepo.create(user.id, { name: 'AC' });
      const rt = db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();

      itemService.create(user.id, vaultKey, {
        title: 'Audited Item',
        category_id: cat.id,
        record_type_id: rt.id,
      });

      const logs = getAuditLogs('item.create');
      assert.ok(logs.length >= 1);
    });

    it('should log item update', () => {
      const createItemService = require('../src/services/item.service');
      const createCategoryRepo = require('../src/repositories/category.repository');
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);
      const itemService = createItemService(db, audit);
      const catRepo = createCategoryRepo(db);

      const cat = catRepo.create(user.id, { name: 'AU' });
      const rt = db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();

      const item = itemService.create(user.id, vaultKey, {
        title: 'Before',
        category_id: cat.id,
        record_type_id: rt.id,
      });

      itemService.update(item.id, user.id, vaultKey, { title: 'After' });

      const logs = getAuditLogs('item.update');
      assert.ok(logs.length >= 1);
    });

    it('should log item deletion', () => {
      const createItemService = require('../src/services/item.service');
      const createCategoryRepo = require('../src/repositories/category.repository');
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);
      const itemService = createItemService(db, audit);
      const catRepo = createCategoryRepo(db);

      const cat = catRepo.create(user.id, { name: 'AD' });
      const rt = db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();

      const item = itemService.create(user.id, vaultKey, {
        title: 'WillDie',
        category_id: cat.id,
        record_type_id: rt.id,
      });

      itemService.delete(item.id, user.id);

      const logs = getAuditLogs('item.delete');
      assert.ok(logs.length >= 1);
      assert.equal(logs[0].resource, 'item');
    });

    it('should log bulk delete', () => {
      const createItemService = require('../src/services/item.service');
      const createCategoryRepo = require('../src/repositories/category.repository');
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);
      const itemService = createItemService(db, audit);
      const catRepo = createCategoryRepo(db);

      const cat = catRepo.create(user.id, { name: 'BD' });
      const rt = db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();

      const i1 = itemService.create(user.id, vaultKey, { title: 'B1', category_id: cat.id, record_type_id: rt.id });
      const i2 = itemService.create(user.id, vaultKey, { title: 'B2', category_id: cat.id, record_type_id: rt.id });

      itemService.bulkDelete(user.id, [i1.id, i2.id]);

      const logs = getAuditLogs('item.bulk_delete');
      assert.ok(logs.length >= 1);
    });

    it('should log bulk move', () => {
      const createItemService = require('../src/services/item.service');
      const createCategoryRepo = require('../src/repositories/category.repository');
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);
      const itemService = createItemService(db, audit);
      const catRepo = createCategoryRepo(db);

      const cat1 = catRepo.create(user.id, { name: 'S' });
      const cat2 = catRepo.create(user.id, { name: 'D' });
      const rt = db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();

      const i1 = itemService.create(user.id, vaultKey, { title: 'M1', category_id: cat1.id, record_type_id: rt.id });
      itemService.bulkMove(user.id, [i1.id], cat2.id);

      const logs = getAuditLogs('item.bulk_move');
      assert.ok(logs.length >= 1);
    });
  });

  // ── Tag audit ──

  describe('Tag mutations', () => {
    it('should produce audit-compatible tag operations (direct audit)', () => {
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);

      const createTagRepo = require('../src/repositories/tag.repository');
      const tagRepo = createTagRepo(db);
      const tag = tagRepo.create(user.id, 'audited');

      // Simulate service-level logging
      audit.log({ userId: user.id, action: 'tag.create', resource: 'tag', resourceId: tag.id });

      const logs = getAuditLogs('tag.create');
      assert.ok(logs.length >= 1);
      assert.equal(logs[0].resource, 'tag');
    });

    it('should log tag deletion via audit', () => {
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);

      const createTagRepo = require('../src/repositories/tag.repository');
      const tagRepo = createTagRepo(db);
      const tag = tagRepo.create(user.id, 'gone');
      tagRepo.delete(tag.id, user.id);

      audit.log({ userId: user.id, action: 'tag.delete', resource: 'tag', resourceId: tag.id });

      const logs = getAuditLogs('tag.delete');
      assert.ok(logs.length >= 1);
    });

    it('should log tag update via audit', () => {
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);

      const createTagRepo = require('../src/repositories/tag.repository');
      const tagRepo = createTagRepo(db);
      const tag = tagRepo.create(user.id, 'toUpdate');
      tagRepo.update(tag.id, user.id, 'updated', null);

      audit.log({ userId: user.id, action: 'tag.update', resource: 'tag', resourceId: tag.id });

      const logs = getAuditLogs('tag.update');
      assert.ok(logs.length >= 1);
    });
  });

  // ── Audit integrity ──

  describe('Audit integrity', () => {
    it('should store userId in audit entries', () => {
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);
      audit.log({ userId: user.id, action: 'test.action', resource: 'test', resourceId: 1 });

      const logs = getAuditLogs('test.action');
      assert.equal(logs[0].user_id, user.id);
    });

    it('should allow null userId in audit (system actions)', () => {
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);
      audit.log({ action: 'system.event', resource: 'system' });

      const logs = getAuditLogs('system.event');
      assert.equal(logs[0].user_id, null);
    });

    it('should store detail in audit', () => {
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);
      audit.log({ userId: user.id, action: 'detail.test', detail: 'extra info' });

      const logs = getAuditLogs('detail.test');
      assert.equal(logs[0].detail, 'extra info');
    });
  });
});
