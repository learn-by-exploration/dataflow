'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser } = require('./helpers');

describe('Record Types', () => {
  let app, db, user, rtRepo;

  before(async () => {
    ({ app, db } = setup());
    const createRecordTypeRepo = require('../src/repositories/record-type.repository');
    rtRepo = createRecordTypeRepo(db);
  });

  beforeEach(async () => {
    cleanDb();
    user = await makeUser(app);
  });

  after(() => teardown());

  // ── List ──

  describe('List', () => {
    it('should list built-in record types', () => {
      const all = rtRepo.findAll(user.id);
      const builtins = all.filter(r => r.is_builtin === 1);
      assert.ok(builtins.length >= 14, `Expected at least 14 built-in types, got ${builtins.length}`);
    });

    it('should include custom types in findAll', () => {
      rtRepo.create(user.id, { name: 'Custom Type' });
      const all = rtRepo.findAll(user.id);
      const custom = all.find(r => r.name === 'Custom Type');
      assert.ok(custom);
      assert.equal(custom.is_builtin, 0);
    });
  });

  // ── CRUD custom ──

  describe('Custom type CRUD', () => {
    it('should create a custom record type', () => {
      const rt = rtRepo.create(user.id, { name: 'API Keys', icon: '🔐', description: 'API tokens' });
      assert.equal(rt.name, 'API Keys');
      assert.equal(rt.icon, '🔐');
      assert.equal(rt.user_id, user.id);
      assert.equal(rt.is_builtin, 0);
    });

    it('should find by id', () => {
      const rt = rtRepo.create(user.id, { name: 'FindMe' });
      const found = rtRepo.findById(rt.id);
      assert.equal(found.name, 'FindMe');
    });

    it('should update a custom record type', () => {
      const rt = rtRepo.create(user.id, { name: 'Old Name' });
      const updated = rtRepo.update(rt.id, user.id, { name: 'New Name' });
      assert.equal(updated.name, 'New Name');
    });

    it('should delete a custom record type', () => {
      const rt = rtRepo.create(user.id, { name: 'ToDelete' });
      rtRepo.delete(rt.id, user.id);
      assert.throws(() => rtRepo.findById(rt.id), /not found/i);
    });

    it('should throw NotFoundError for missing record type', () => {
      assert.throws(() => rtRepo.findById(999999), /not found/i);
    });
  });

  // ── Built-in protection ──

  describe('Built-in protection', () => {
    it('should NOT allow modifying built-in record type', () => {
      const builtins = rtRepo.findAll(user.id).filter(r => r.is_builtin === 1);
      assert.ok(builtins.length > 0);
      assert.throws(
        () => rtRepo.update(builtins[0].id, user.id, { name: 'Hacked' }),
        /built-in|forbidden/i
      );
    });

    it('should NOT allow deleting built-in record type', () => {
      const builtins = rtRepo.findAll(user.id).filter(r => r.is_builtin === 1);
      assert.throws(
        () => rtRepo.delete(builtins[0].id, user.id),
        /built-in|forbidden/i
      );
    });

    it('should NOT allow deleting built-in via service', () => {
      const createRecordTypeService = require('../src/services/record-type.service');
      const svc = createRecordTypeService(db);
      const builtins = rtRepo.findAll(user.id).filter(r => r.is_builtin === 1);
      assert.throws(() => svc.delete(builtins[0].id, user.id), /built-in|forbidden/i);
    });

    it('should NOT allow modifying built-in via service', () => {
      const createRecordTypeService = require('../src/services/record-type.service');
      const svc = createRecordTypeService(db);
      const builtins = rtRepo.findAll(user.id).filter(r => r.is_builtin === 1);
      assert.throws(() => svc.update(builtins[0].id, user.id, { name: 'X' }), /built-in|forbidden/i);
    });
  });

  // ── Field CRUD ──

  describe('Field CRUD', () => {
    it('should add a field to a record type', () => {
      const rt = rtRepo.create(user.id, { name: 'WithField' });
      const field = rtRepo.addField(rt.id, { name: 'Username', field_type: 'text', required: true });
      assert.equal(field.name, 'Username');
      assert.equal(field.field_type, 'text');
      assert.equal(field.required, 1);
    });

    it('should find fields for a record type', () => {
      const rt = rtRepo.create(user.id, { name: 'MultiField' });
      rtRepo.addField(rt.id, { name: 'F1', field_type: 'text' });
      rtRepo.addField(rt.id, { name: 'F2', field_type: 'password' });
      const fields = rtRepo.findFields(rt.id);
      assert.equal(fields.length, 2);
    });

    it('should update a field', () => {
      const rt = rtRepo.create(user.id, { name: 'UpdateField' });
      const field = rtRepo.addField(rt.id, { name: 'Old', field_type: 'text' });
      const updated = rtRepo.updateField(field.id, { name: 'New', field_type: 'password' });
      assert.equal(updated.name, 'New');
      assert.equal(updated.field_type, 'password');
    });

    it('should delete a field', () => {
      const rt = rtRepo.create(user.id, { name: 'DelField' });
      const field = rtRepo.addField(rt.id, { name: 'Gone', field_type: 'text' });
      rtRepo.deleteField(field.id);
      const fields = rtRepo.findFields(rt.id);
      assert.equal(fields.length, 0);
    });

    it('should throw when updating non-existent field', () => {
      assert.throws(() => rtRepo.updateField(999999, { name: 'X' }), /not found/i);
    });

    it('should throw when deleting non-existent field', () => {
      assert.throws(() => rtRepo.deleteField(999999), /not found/i);
    });

    it('should auto-assign field position', () => {
      const rt = rtRepo.create(user.id, { name: 'AutoPos' });
      const f1 = rtRepo.addField(rt.id, { name: 'First', field_type: 'text' });
      const f2 = rtRepo.addField(rt.id, { name: 'Second', field_type: 'text' });
      assert.equal(f1.position, 0);
      assert.equal(f2.position, 1);
    });

    it('should store field options as JSON', () => {
      const rt = rtRepo.create(user.id, { name: 'WithOptions' });
      const field = rtRepo.addField(rt.id, {
        name: 'Choice', field_type: 'select', options: ['A', 'B', 'C'],
      });
      assert.equal(field.options, JSON.stringify(['A', 'B', 'C']));
    });
  });

  // ── Field reorder ──

  describe('Field reorder', () => {
    it('should reorder fields', () => {
      const rt = rtRepo.create(user.id, { name: 'Reorder' });
      const f1 = rtRepo.addField(rt.id, { name: 'A', field_type: 'text' });
      const f2 = rtRepo.addField(rt.id, { name: 'B', field_type: 'text' });
      const f3 = rtRepo.addField(rt.id, { name: 'C', field_type: 'text' });
      rtRepo.reorderFields(rt.id, [f3.id, f1.id, f2.id]);
      const fields = rtRepo.findFields(rt.id);
      assert.equal(fields[0].id, f3.id);
      assert.equal(fields[1].id, f1.id);
      assert.equal(fields[2].id, f2.id);
    });
  });

  // ── Field type validation (service) ──

  describe('Field type validation', () => {
    it('should reject invalid field_type via service', () => {
      const createRecordTypeService = require('../src/services/record-type.service');
      const svc = createRecordTypeService(db);
      const rt = rtRepo.create(user.id, { name: 'ValidateField' });
      assert.throws(
        () => svc.addField(rt.id, { name: 'Bad', field_type: 'invalid_type' }),
        /invalid field type/i
      );
    });

    it('should accept valid field_type via service', () => {
      const createRecordTypeService = require('../src/services/record-type.service');
      const svc = createRecordTypeService(db);
      const rt = rtRepo.create(user.id, { name: 'GoodField' });
      const field = svc.addField(rt.id, { name: 'Good', field_type: 'toggle' });
      assert.equal(field.field_type, 'toggle');
    });

    it('should reject invalid field_type on update via service', () => {
      const createRecordTypeService = require('../src/services/record-type.service');
      const svc = createRecordTypeService(db);
      const rt = rtRepo.create(user.id, { name: 'UpdField' });
      const field = svc.addField(rt.id, { name: 'F', field_type: 'text' });
      assert.throws(
        () => svc.updateField(field.id, { field_type: 'notreal' }),
        /invalid field type/i
      );
    });
  });

  // ── User isolation ──

  describe('User isolation', () => {
    it('should not let user update another user custom type', async () => {
      const user2 = await makeUser(app, { email: 'other@test.com' });
      const rt = rtRepo.create(user.id, { name: 'Private' });
      assert.throws(() => rtRepo.update(rt.id, user2.id, { name: 'X' }), /not found/i);
    });

    it('should not let user delete another user custom type', async () => {
      const user2 = await makeUser(app, { email: 'other2@test.com' });
      const rt = rtRepo.create(user.id, { name: 'Private2' });
      assert.throws(() => rtRepo.delete(rt.id, user2.id), /not found/i);
    });
  });

  // ── Service validation ──

  describe('Service validation', () => {
    it('should reject empty name on create', () => {
      const createRecordTypeService = require('../src/services/record-type.service');
      const svc = createRecordTypeService(db);
      assert.throws(() => svc.create(user.id, { name: '' }), /required|empty/i);
    });

    it('should reject empty name on update', () => {
      const createRecordTypeService = require('../src/services/record-type.service');
      const svc = createRecordTypeService(db);
      const rt = svc.create(user.id, { name: 'Valid' });
      assert.throws(() => svc.update(rt.id, user.id, { name: '' }), /empty/i);
    });
  });

  // ── Schema ──

  describe('Schema', () => {
    it('should validate create record type schema', () => {
      const { createRecordTypeSchema } = require('../src/schemas/record-type.schema');
      const r = createRecordTypeSchema.safeParse({ name: 'Test' });
      assert.ok(r.success);
    });

    it('should reject empty name in schema', () => {
      const { createRecordTypeSchema } = require('../src/schemas/record-type.schema');
      const r = createRecordTypeSchema.safeParse({ name: '' });
      assert.ok(!r.success);
    });

    it('should validate addField schema', () => {
      const { addFieldSchema } = require('../src/schemas/record-type.schema');
      const r = addFieldSchema.safeParse({ name: 'Test', field_type: 'text' });
      assert.ok(r.success);
    });

    it('should reject invalid field_type in schema', () => {
      const { addFieldSchema } = require('../src/schemas/record-type.schema');
      const r = addFieldSchema.safeParse({ name: 'Test', field_type: 'xyz' });
      assert.ok(!r.success);
    });
  });
});
