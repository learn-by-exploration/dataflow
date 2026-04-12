'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const runMigrations = require('./migrate');

const logger = (() => { try { return require('../logger'); } catch { return console; } })();

function initDatabase(dbDir) {
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'dataflow.db');
  const shmPath = dbPath + '-shm';
  const walPath = dbPath + '-wal';

  // Stale SHM recovery for Docker restarts
  if (fs.existsSync(shmPath) && fs.existsSync(walPath)) {
    try {
      fs.unlinkSync(shmPath);
      logger.info('Removed stale .db-shm file for clean WAL recovery');
    } catch (e) {
      logger.warn({ err: e }, 'Could not remove stale .db-shm file');
    }
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }

  // ─── Auth tables ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'adult' CHECK(role IN ('admin','adult','child','guest')),
      master_key_salt TEXT,
      master_key_params TEXT,
      vault_key_encrypted TEXT,
      encryption_mode TEXT NOT NULL DEFAULT 'server' CHECK(encryption_mode IN ('server','client')),
      public_key TEXT,
      encrypted_private_key TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      email TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      first_attempt_at TEXT,
      locked_until TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (user_id, key)
    );
  `);

  // ─── Vault structure tables ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '📁',
      color TEXT DEFAULT '#2563EB',
      position INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS record_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '📄',
      description TEXT DEFAULT '',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS record_type_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_type_id INTEGER NOT NULL REFERENCES record_types(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'text'
        CHECK(field_type IN ('text','password','date','number','phone','email','url','select','textarea','file','hidden','toggle')),
      options TEXT,
      position INTEGER DEFAULT 0,
      required INTEGER NOT NULL DEFAULT 0
    );
  `);

  // ─── Items tables ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
      record_type_id INTEGER REFERENCES record_types(id) ON DELETE SET NULL,
      title_encrypted TEXT,
      title_iv TEXT,
      title_tag TEXT,
      notes_encrypted TEXT,
      notes_iv TEXT,
      notes_tag TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      client_encrypted INTEGER NOT NULL DEFAULT 0,
      position INTEGER DEFAULT 0,
      title_sort_key TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS item_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      field_def_id INTEGER REFERENCES record_type_fields(id) ON DELETE SET NULL,
      value_encrypted TEXT,
      value_iv TEXT,
      value_tag TEXT,
      strength_score INTEGER,
      password_last_changed TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS item_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      encryption_iv TEXT,
      encryption_tag TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#64748B'
    );

    CREATE TABLE IF NOT EXISTS item_tags (
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, tag_id)
    );
  `);

  // ─── Sharing tables ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      shared_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shared_with INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL DEFAULT 'read' CHECK(permission IN ('read','write')),
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS category_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      shared_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shared_with INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL DEFAULT 'read' CHECK(permission IN ('read','write')),
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ─── Emergency & Audit tables ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS emergency_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grantor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      grantee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired')),
      wait_days INTEGER NOT NULL DEFAULT 7,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource TEXT,
      resource_id TEXT,
      ip TEXT,
      ua TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS item_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS share_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      passphrase_hash TEXT,
      expires_at TEXT,
      one_time INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS item_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      record_type_id INTEGER REFERENCES record_types(id) ON DELETE SET NULL,
      default_fields TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ─── FTS5 search index ───
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(item_id UNINDEXED, title, notes)`);

  // ─── Indexes ───
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
    CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
    CREATE INDEX IF NOT EXISTS idx_item_fields_item ON item_fields(item_id);
    CREATE INDEX IF NOT EXISTS idx_item_attachments_item ON item_attachments(item_id);
    CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
    CREATE INDEX IF NOT EXISTS idx_item_shares_item ON item_shares(item_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_item_shares_unique ON item_shares(item_id, shared_with);
    CREATE INDEX IF NOT EXISTS idx_item_shares_shared_with ON item_shares(shared_with);
    CREATE INDEX IF NOT EXISTS idx_category_shares_category ON category_shares(category_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_category_shares_unique ON category_shares(category_id, shared_with);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_date ON audit_log(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id);
    CREATE INDEX IF NOT EXISTS idx_item_history_item ON item_history(item_id);
    CREATE INDEX IF NOT EXISTS idx_item_history_changed_at ON item_history(changed_at);
    CREATE INDEX IF NOT EXISTS idx_items_user_category ON items(user_id, category_id);
    CREATE INDEX IF NOT EXISTS idx_item_tags_item ON item_tags(item_id);
    CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(deleted_at) WHERE deleted_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);
    CREATE INDEX IF NOT EXISTS idx_share_links_item ON share_links(item_id);
    CREATE INDEX IF NOT EXISTS idx_item_templates_user ON item_templates(user_id);
  `);

  // Run migrations (for existing databases that need schema updates)
  // For new databases, the schema already includes all changes, so we pre-record them.
  const isNew = db.prepare('SELECT COUNT(*) as c FROM users').get().c === 0
    && db.prepare("SELECT COUNT(*) as c FROM _migrations").get().c === 0;
  if (isNew) {
    // Pre-record all migrations since the schema is already up to date
    const migrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
      const stmt = db.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)');
      for (const file of files) stmt.run(file);
    }
  }
  runMigrations(db);

  return db;
}

module.exports = initDatabase;
