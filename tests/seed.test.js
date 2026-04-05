'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown } = require('./helpers');
const { BUILTIN_RECORD_TYPES } = require('../src/db/seed');

describe('Seed - Built-in Record Types', () => {
  let db;

  before(() => {
    ({ db } = setup());
  });

  after(() => teardown());

  beforeEach(() => {
    // Don't clean record_types since they're seeded on startup
  });

  it('seeds 14 built-in record types', () => {
    const count = db.prepare('SELECT COUNT(*) as cnt FROM record_types WHERE is_builtin = 1').get().cnt;
    assert.equal(count, 14);
  });

  it('all expected type names exist', () => {
    const types = db.prepare('SELECT name FROM record_types WHERE is_builtin = 1 ORDER BY name').all().map(r => r.name);
    const expected = [
      'Address', 'Bank Account', 'Credit Card', 'Document',
      'Emergency Contact', 'Identity', 'Key-Value', 'Login',
      'Medical', 'Secure Note', 'Software License', 'Subscription',
      'Vehicle', 'WiFi',
    ];
    assert.deepEqual(types, expected);
  });

  // ─── Individual type field checks ───
  it('Login type has 4 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Login' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 4);
    assert.equal(fields[0].name, 'Username');
    assert.equal(fields[1].name, 'Password');
    assert.equal(fields[1].field_type, 'password');
    assert.equal(fields[2].name, 'URL');
    assert.equal(fields[2].field_type, 'url');
    assert.equal(fields[3].name, 'TOTP Secret');
    assert.equal(fields[3].field_type, 'hidden');
  });

  it('Identity type has 6 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Identity' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 6);
    assert.equal(fields[0].name, 'Full Name');
    assert.equal(fields[2].name, 'ID Type');
    assert.equal(fields[2].field_type, 'select');
    assert.ok(fields[2].options, 'ID Type should have options');
  });

  it('Credit Card type has 6 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Credit Card' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 6);
    assert.equal(fields[1].name, 'Card Number');
    assert.equal(fields[1].field_type, 'password');
    assert.equal(fields[3].name, 'CVV');
    assert.equal(fields[3].field_type, 'password');
  });

  it('Bank Account type has 6 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Bank Account' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 6);
    assert.equal(fields[0].name, 'Bank Name');
    assert.equal(fields[1].name, 'Account Number');
    assert.equal(fields[1].field_type, 'password');
  });

  it('Address type has 5 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Address' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 5);
    assert.equal(fields[0].name, 'Street');
    assert.equal(fields[1].name, 'City');
  });

  it('Emergency Contact type has 5 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Emergency Contact' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 5);
    assert.equal(fields[2].name, 'Phone');
    assert.equal(fields[2].field_type, 'phone');
  });

  it('Medical type has 7 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Medical' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 7);
    assert.equal(fields[4].name, 'Blood Type');
    assert.equal(fields[4].field_type, 'select');
  });

  it('Vehicle type has 6 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Vehicle' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 6);
    assert.equal(fields[0].name, 'Make');
    assert.equal(fields[2].name, 'Year');
    assert.equal(fields[2].field_type, 'number');
  });

  it('WiFi type has 4 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'WiFi' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 4);
    assert.equal(fields[0].name, 'Network Name (SSID)');
    assert.equal(fields[1].name, 'Password');
    assert.equal(fields[3].name, 'Hidden Network');
    assert.equal(fields[3].field_type, 'toggle');
  });

  it('Software License type has 6 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Software License' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 6);
    assert.equal(fields[1].name, 'License Key');
    assert.equal(fields[1].field_type, 'password');
  });

  it('Secure Note type has 1 field', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Secure Note' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].name, 'Content');
    assert.equal(fields[0].field_type, 'textarea');
  });

  it('Key-Value type has 2 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Key-Value' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 2);
    assert.equal(fields[0].name, 'Key');
    assert.equal(fields[1].name, 'Value');
    assert.equal(fields[1].field_type, 'password');
  });

  it('Document type has 3 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Document' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 3);
    assert.equal(fields[0].name, 'Document Type');
  });

  it('Subscription type has 7 fields', () => {
    const rt = db.prepare("SELECT id FROM record_types WHERE name = 'Subscription' AND is_builtin = 1").get();
    const fields = db.prepare('SELECT * FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(rt.id);
    assert.equal(fields.length, 7);
    assert.equal(fields[0].name, 'Service Name');
    assert.equal(fields[5].name, 'Billing Cycle');
    assert.equal(fields[5].field_type, 'select');
  });

  // ─── Seed idempotency ───
  it('does not re-seed if already seeded', () => {
    const { seedRecordTypes } = require('../src/db/seed');
    const result = seedRecordTypes(db);
    assert.ok(result.skipped, 'Should skip re-seeding');
    assert.equal(result.count, 14);
  });

  // ─── All builtin types have is_builtin = 1 ───
  it('all seeded types have is_builtin = 1', () => {
    const types = db.prepare('SELECT * FROM record_types WHERE is_builtin = 1').all();
    assert.equal(types.length, 14);
    for (const type of types) {
      assert.equal(type.is_builtin, 1);
    }
  });

  // ─── All types have icons ───
  it('all seeded types have icons', () => {
    const types = db.prepare('SELECT * FROM record_types WHERE is_builtin = 1').all();
    for (const type of types) {
      assert.ok(type.icon, `${type.name} should have an icon`);
    }
  });

  // ─── All types have descriptions ───
  it('all seeded types have descriptions', () => {
    const types = db.prepare('SELECT * FROM record_types WHERE is_builtin = 1').all();
    for (const type of types) {
      assert.ok(type.description, `${type.name} should have a description`);
    }
  });

  // ─── Field positions are sequential ───
  it('field positions are sequential starting from 0', () => {
    const types = db.prepare('SELECT id, name FROM record_types WHERE is_builtin = 1').all();
    for (const type of types) {
      const fields = db.prepare('SELECT position FROM record_type_fields WHERE record_type_id = ? ORDER BY position').all(type.id);
      for (let i = 0; i < fields.length; i++) {
        assert.equal(fields[i].position, i, `${type.name} field ${i} should have position ${i}`);
      }
    }
  });

  // ─── Total field count matches BUILTIN_RECORD_TYPES definition ───
  it('total field count matches definition', () => {
    const expectedTotal = BUILTIN_RECORD_TYPES.reduce((sum, rt) => sum + rt.fields.length, 0);
    const actualTotal = db.prepare(
      'SELECT COUNT(*) as cnt FROM record_type_fields rtf JOIN record_types rt ON rtf.record_type_id = rt.id WHERE rt.is_builtin = 1'
    ).get().cnt;
    assert.equal(actualTotal, expectedTotal);
  });

  // ─── user_id is NULL for built-in types ───
  it('built-in types have NULL user_id', () => {
    const types = db.prepare('SELECT user_id FROM record_types WHERE is_builtin = 1').all();
    for (const type of types) {
      assert.equal(type.user_id, null);
    }
  });
});
