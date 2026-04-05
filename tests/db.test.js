'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown } = require('./helpers');

describe('Database Schema', () => {
  let db;

  before(() => {
    ({ db } = setup());
  });

  after(() => teardown());

  beforeEach(() => cleanDb());

  // ─── Table existence ───
  const expectedTables = [
    'users', 'sessions', 'login_attempts', 'settings',
    'categories', 'record_types', 'record_type_fields',
    'items', 'item_fields', 'item_attachments', 'tags', 'item_tags',
    'item_shares', 'category_shares',
    'emergency_access', 'audit_log', '_migrations',
  ];

  for (const table of expectedTables) {
    it(`table "${table}" exists`, () => {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table);
      assert.ok(row, `Table ${table} should exist`);
    });
  }

  // ─── WAL mode ───
  it('uses WAL journal mode', () => {
    const mode = db.pragma('journal_mode', { simple: true });
    assert.equal(mode, 'wal');
  });

  // ─── Foreign keys enabled ───
  it('has foreign keys enabled', () => {
    const fk = db.pragma('foreign_keys', { simple: true });
    assert.equal(fk, 1);
  });

  // ─── Users table columns ───
  it('users table has expected columns', () => {
    const cols = db.prepare("PRAGMA table_info('users')").all().map(c => c.name);
    const expected = ['id', 'email', 'password_hash', 'display_name', 'role',
      'master_key_salt', 'master_key_params', 'vault_key_encrypted',
      'created_at', 'updated_at'];
    for (const col of expected) {
      assert.ok(cols.includes(col), `users should have column ${col}`);
    }
  });

  // ─── Users role check constraint ───
  it('users role rejects invalid values', () => {
    assert.throws(() => {
      db.prepare(
        "INSERT INTO users (email, password_hash, role) VALUES ('x@x.com', 'hash', 'invalid')"
      ).run();
    });
  });

  it('users role accepts valid values', () => {
    for (const role of ['admin', 'adult', 'child', 'guest']) {
      db.prepare(
        `INSERT INTO users (email, password_hash, role) VALUES ('${role}@test.com', 'hash', ?)`
      ).run(role);
    }
    const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    assert.equal(count, 4);
  });

  // ─── Sessions table ───
  it('sessions references users with CASCADE', () => {
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('a@a.com', 'h')").run();
    const userId = db.prepare('SELECT id FROM users').get().id;
    db.prepare("INSERT INTO sessions (sid, user_id, expires_at) VALUES ('s1', ?, datetime('now', '+1 day'))").run(userId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM sessions').get().c, 1);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM sessions').get().c, 0);
  });

  // ─── Items table encrypted columns ───
  it('items table has encrypted columns', () => {
    const cols = db.prepare("PRAGMA table_info('items')").all().map(c => c.name);
    const encrypted = ['title_encrypted', 'title_iv', 'title_tag', 'notes_encrypted', 'notes_iv', 'notes_tag'];
    for (const col of encrypted) {
      assert.ok(cols.includes(col), `items should have column ${col}`);
    }
  });

  // ─── Item fields encrypted columns ───
  it('item_fields table has encrypted columns', () => {
    const cols = db.prepare("PRAGMA table_info('item_fields')").all().map(c => c.name);
    for (const col of ['value_encrypted', 'value_iv', 'value_tag']) {
      assert.ok(cols.includes(col), `item_fields should have column ${col}`);
    }
  });

  // ─── Categories cascade ───
  it('categories cascade delete to items', () => {
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('u@u.com', 'h')").run();
    const uid = db.prepare('SELECT id FROM users').get().id;
    db.prepare("INSERT INTO categories (user_id, name) VALUES (?, 'Cat')").run(uid);
    const catId = db.prepare('SELECT id FROM categories').get().id;
    db.prepare("INSERT INTO items (user_id, category_id) VALUES (?, ?)").run(uid, catId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM items').get().c, 1);
    db.prepare('DELETE FROM categories WHERE id = ?').run(catId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM items').get().c, 0);
  });

  // ─── Items cascade to item_fields ───
  it('items cascade delete to item_fields', () => {
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('u@u.com', 'h')").run();
    const uid = db.prepare('SELECT id FROM users').get().id;
    db.prepare("INSERT INTO items (user_id) VALUES (?)").run(uid);
    const itemId = db.prepare('SELECT id FROM items').get().id;
    db.prepare("INSERT INTO item_fields (item_id) VALUES (?)").run(itemId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM item_fields').get().c, 1);
    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM item_fields').get().c, 0);
  });

  // ─── Items cascade to item_tags ───
  it('items cascade delete to item_tags', () => {
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('u@u.com', 'h')").run();
    const uid = db.prepare('SELECT id FROM users').get().id;
    db.prepare("INSERT INTO items (user_id) VALUES (?)").run(uid);
    const itemId = db.prepare('SELECT id FROM items').get().id;
    db.prepare("INSERT INTO tags (user_id, name) VALUES (?, 'tag1')").run(uid);
    const tagId = db.prepare('SELECT id FROM tags').get().id;
    db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(itemId, tagId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM item_tags').get().c, 1);
    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM item_tags').get().c, 0);
  });

  // ─── Tags cascade to item_tags ───
  it('tags cascade delete to item_tags', () => {
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('u@u.com', 'h')").run();
    const uid = db.prepare('SELECT id FROM users').get().id;
    db.prepare("INSERT INTO items (user_id) VALUES (?)").run(uid);
    const itemId = db.prepare('SELECT id FROM items').get().id;
    db.prepare("INSERT INTO tags (user_id, name) VALUES (?, 'tag1')").run(uid);
    const tagId = db.prepare('SELECT id FROM tags').get().id;
    db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(itemId, tagId);
    db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM item_tags').get().c, 0);
  });

  // ─── Item shares cascade ───
  it('item_shares cascade on item delete', () => {
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('a@a.com', 'h')").run();
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('b@b.com', 'h')").run();
    const users = db.prepare('SELECT id FROM users').all();
    db.prepare("INSERT INTO items (user_id) VALUES (?)").run(users[0].id);
    const itemId = db.prepare('SELECT id FROM items').get().id;
    db.prepare('INSERT INTO item_shares (item_id, shared_by, shared_with) VALUES (?, ?, ?)').run(itemId, users[0].id, users[1].id);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM item_shares').get().c, 1);
    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM item_shares').get().c, 0);
  });

  // ─── Category shares cascade ───
  it('category_shares cascade on category delete', () => {
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('a@a.com', 'h')").run();
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('b@b.com', 'h')").run();
    const users = db.prepare('SELECT id FROM users').all();
    db.prepare("INSERT INTO categories (user_id, name) VALUES (?, 'C')").run(users[0].id);
    const catId = db.prepare('SELECT id FROM categories').get().id;
    db.prepare('INSERT INTO category_shares (category_id, shared_by, shared_with) VALUES (?, ?, ?)').run(catId, users[0].id, users[1].id);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM category_shares').get().c, 1);
    db.prepare('DELETE FROM categories WHERE id = ?').run(catId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM category_shares').get().c, 0);
  });

  // ─── Audit log user SET NULL ───
  it('audit_log user_id SET NULL on user delete', () => {
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('u@u.com', 'h')").run();
    const uid = db.prepare('SELECT id FROM users').get().id;
    db.prepare("INSERT INTO audit_log (user_id, action) VALUES (?, 'test')").run(uid);
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    const log = db.prepare('SELECT * FROM audit_log').get();
    assert.ok(log, 'Audit log should not be deleted');
    assert.equal(log.user_id, null, 'user_id should be SET NULL');
  });

  // ─── Emergency access cascade ───
  it('emergency_access cascades on user delete', () => {
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('a@a.com', 'h')").run();
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('b@b.com', 'h')").run();
    const users = db.prepare('SELECT id FROM users').all();
    db.prepare('INSERT INTO emergency_access (grantor_id, grantee_id) VALUES (?, ?)').run(users[0].id, users[1].id);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM emergency_access').get().c, 1);
    db.prepare('DELETE FROM users WHERE id = ?').run(users[0].id);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM emergency_access').get().c, 0);
  });

  // ─── Record type fields cascade ───
  it('record_type_fields cascade on record_type delete', () => {
    db.prepare("INSERT INTO record_types (name, is_builtin) VALUES ('RT', 0)").run();
    const rtId = db.prepare('SELECT id FROM record_types WHERE name = ?').get('RT').id;
    db.prepare("INSERT INTO record_type_fields (record_type_id, name) VALUES (?, 'F1')").run(rtId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM record_type_fields WHERE record_type_id = ?').get(rtId).c, 1);
    db.prepare('DELETE FROM record_types WHERE id = ?').run(rtId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM record_type_fields WHERE record_type_id = ?').get(rtId).c, 0);
  });

  // ─── Indexes ───
  it('has expected indexes', () => {
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
    const expected = [
      'idx_sessions_user', 'idx_sessions_expires',
      'idx_categories_user', 'idx_items_user', 'idx_items_category',
      'idx_item_fields_item', 'idx_item_attachments_item',
      'idx_tags_user', 'idx_item_shares_item', 'idx_category_shares_category',
      'idx_audit_log_user', 'idx_audit_log_created',
    ];
    for (const idx of expected) {
      assert.ok(indexes.includes(idx), `Index ${idx} should exist`);
    }
  });

  // ─── Item attachments cascade ───
  it('item_attachments cascade on item delete', () => {
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('u@u.com', 'h')").run();
    const uid = db.prepare('SELECT id FROM users').get().id;
    db.prepare("INSERT INTO items (user_id) VALUES (?)").run(uid);
    const itemId = db.prepare('SELECT id FROM items').get().id;
    db.prepare("INSERT INTO item_attachments (item_id, user_id, filename, original_name) VALUES (?, ?, 'f.enc', 'f.txt')").run(itemId, uid);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM item_attachments').get().c, 1);
    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    assert.equal(db.prepare('SELECT COUNT(*) as c FROM item_attachments').get().c, 0);
  });

  // ─── record_type_fields field_type check constraint ───
  it('record_type_fields rejects invalid field_type', () => {
    db.prepare("INSERT INTO record_types (name, is_builtin) VALUES ('TestRT', 0)").run();
    const rtId = db.prepare("SELECT id FROM record_types WHERE name = 'TestRT'").get().id;
    assert.throws(() => {
      db.prepare("INSERT INTO record_type_fields (record_type_id, name, field_type) VALUES (?, 'f', 'invalid_type')").run(rtId);
    });
  });

  // ─── Settings composite PK ───
  it('settings uses composite primary key (user_id, key)', () => {
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('u@u.com', 'h')").run();
    const uid = db.prepare('SELECT id FROM users').get().id;
    db.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'theme', 'dark')").run(uid);
    db.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'lang', 'en')").run(uid);
    assert.throws(() => {
      db.prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'theme', 'light')").run(uid);
    });
  });

  // ─── Unique email constraint ───
  it('users email must be unique', () => {
    db.prepare("INSERT INTO users (email, password_hash) VALUES ('dup@dup.com', 'h')").run();
    assert.throws(() => {
      db.prepare("INSERT INTO users (email, password_hash) VALUES ('dup@dup.com', 'h2')").run();
    });
  });

  // ─── Login attempts PK is email ───
  it('login_attempts primary key is email', () => {
    db.prepare("INSERT INTO login_attempts (email, attempts, first_attempt_at) VALUES ('x@x.com', 1, datetime('now'))").run();
    assert.throws(() => {
      db.prepare("INSERT INTO login_attempts (email, attempts, first_attempt_at) VALUES ('x@x.com', 2, datetime('now'))").run();
    });
  });
});
