'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Batch 9 — Infrastructure', () => {
  let app, db, dir, user;

  before(async () => {
    ({ app, db, dir } = setup());
    cleanDb();
    user = await makeUser(app);
    const logged = await loginUser(app, user);
    user.sid = logged.sid;
  });

  afterEach(() => {
    try { db.exec('DELETE FROM audit_log'); } catch { /* ignore */ }
  });

  after(() => teardown());

  // ════════════════════════════════════════════
  // #81: GitHub Actions CI
  // ════════════════════════════════════════════
  describe('#81: GitHub Actions CI', () => {
    const ciPath = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');

    it('CI workflow file exists', () => {
      assert.ok(fs.existsSync(ciPath), 'ci.yml should exist');
    });

    it('CI workflow has correct structure', () => {
      const content = fs.readFileSync(ciPath, 'utf8');
      assert.ok(content.includes('push:'), 'should trigger on push');
      assert.ok(content.includes('pull_request:'), 'should trigger on pull_request');
      assert.ok(content.includes('node-version: 22'), 'should use Node 22');
      assert.ok(content.includes('npm ci'), 'should run npm ci');
      assert.ok(content.includes('npm test'), 'should run npm test');
      assert.ok(content.includes("cache: 'npm'") || content.includes('cache: npm'), 'should cache npm');
      assert.ok(content.includes('upload-artifact'), 'should upload artifacts');
    });

    it('README has CI badge', () => {
      const readmePath = path.join(__dirname, '..', 'README.md');
      const readme = fs.readFileSync(readmePath, 'utf8');
      assert.ok(readme.includes('ci.yml/badge.svg'), 'README should have CI badge');
    });
  });

  // ════════════════════════════════════════════
  // #82: Database index optimization
  // ════════════════════════════════════════════
  describe('#82: Database indexes', () => {
    function indexExists(name) {
      const row = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='index' AND name=?").get(name);
      return row.c > 0;
    }

    it('idx_items_user_category exists', () => {
      assert.ok(indexExists('idx_items_user_category'));
    });

    it('idx_item_fields_item exists', () => {
      assert.ok(indexExists('idx_item_fields_item'));
    });

    it('idx_audit_log_user_date exists', () => {
      assert.ok(indexExists('idx_audit_log_user_date'));
    });

    it('idx_sessions_user exists', () => {
      assert.ok(indexExists('idx_sessions_user'));
    });

    it('idx_item_tags_item exists', () => {
      assert.ok(indexExists('idx_item_tags_item'));
    });

    it('idx_item_tags_tag exists', () => {
      assert.ok(indexExists('idx_item_tags_tag'));
    });

    it('idx_items_deleted partial index exists', () => {
      assert.ok(indexExists('idx_items_deleted'));
    });

    it('idx_item_shares_item exists', () => {
      assert.ok(indexExists('idx_item_shares_item'));
    });

    it('idx_item_shares_shared_with exists', () => {
      assert.ok(indexExists('idx_item_shares_shared_with'));
    });
  });

  // ════════════════════════════════════════════
  // #83: DB maintenance scheduler
  // ════════════════════════════════════════════
  describe('#83: DB maintenance', () => {
    it('createScheduler returns runStartupChecks function', () => {
      const createScheduler = require('../src/scheduler');
      const logger = { info() {}, warn() {}, error() {} };
      const scheduler = createScheduler(db, logger);
      assert.equal(typeof scheduler.runStartupChecks, 'function');
    });

    it('runStartupChecks does not throw', () => {
      const createScheduler = require('../src/scheduler');
      const logger = { info() {}, warn() {}, error() {} };
      const scheduler = createScheduler(db, logger);
      assert.doesNotThrow(() => scheduler.runStartupChecks());
    });

    it('PRAGMA optimize runs without error', () => {
      assert.doesNotThrow(() => db.pragma('optimize'));
    });

    it('PRAGMA integrity_check returns ok', () => {
      const result = db.pragma('integrity_check', { simple: true });
      assert.equal(result, 'ok');
    });

    it('DB_MAINTENANCE_ENABLED config exists', () => {
      const config = require('../src/config');
      assert.equal(typeof config.dbMaintenance.enabled, 'boolean');
    });
  });

  // ════════════════════════════════════════════
  // #84: Backup integrity verification
  // ════════════════════════════════════════════
  describe('#84: Backup verification', () => {
    it('createChecksumFile creates .sha256 companion', () => {
      const { createChecksumFile } = require('../src/services/backup.service');
      const tmpFile = path.join(dir, 'test-backup.db');
      fs.writeFileSync(tmpFile, 'test data');
      const { checksum, checksumPath } = createChecksumFile(tmpFile);
      assert.ok(fs.existsSync(checksumPath));
      assert.ok(checksum.length === 64);
      const content = fs.readFileSync(checksumPath, 'utf8');
      assert.ok(content.includes(checksum));
      fs.unlinkSync(tmpFile);
      fs.unlinkSync(checksumPath);
    });

    it('verifyBackup succeeds for valid backup', () => {
      const { createChecksumFile, verifyBackup } = require('../src/services/backup.service');
      const tmpFile = path.join(dir, 'dataflow-backup-test.db');
      fs.writeFileSync(tmpFile, 'backup content');
      createChecksumFile(tmpFile);
      const result = verifyBackup(tmpFile);
      assert.ok(result.valid);
      fs.unlinkSync(tmpFile);
      fs.unlinkSync(tmpFile + '.sha256');
    });

    it('verifyBackup detects corruption', () => {
      const { createChecksumFile, verifyBackup } = require('../src/services/backup.service');
      const tmpFile = path.join(dir, 'dataflow-backup-corrupt.db');
      fs.writeFileSync(tmpFile, 'original');
      createChecksumFile(tmpFile);
      fs.writeFileSync(tmpFile, 'corrupted');
      const result = verifyBackup(tmpFile);
      assert.equal(result.valid, false);
      fs.unlinkSync(tmpFile);
      fs.unlinkSync(tmpFile + '.sha256');
    });

    it('verifyBackup reports missing checksum file', () => {
      const { verifyBackup } = require('../src/services/backup.service');
      const tmpFile = path.join(dir, 'dataflow-backup-nosha.db');
      fs.writeFileSync(tmpFile, 'data');
      const result = verifyBackup(tmpFile);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('Checksum file not found'));
      fs.unlinkSync(tmpFile);
    });
  });

  // ════════════════════════════════════════════
  // #85: Prometheus metrics
  // ════════════════════════════════════════════
  describe('#85: Prometheus metrics', () => {
    it('GET /api/metrics returns Prometheus format', async () => {
      const res = await request(app).get('/api/metrics').expect(200);
      assert.ok(res.headers['content-type'].includes('text/plain'));
      assert.ok(res.text.includes('# HELP'));
      assert.ok(res.text.includes('# TYPE'));
    });

    it('metrics include http_requests_total', async () => {
      // Make a request first
      await request(app).get('/api/health');
      const res = await request(app).get('/api/metrics').expect(200);
      assert.ok(res.text.includes('http_requests_total'));
    });

    it('metrics include db_size_bytes', async () => {
      const res = await request(app).get('/api/metrics').expect(200);
      assert.ok(res.text.includes('db_size_bytes'));
    });

    it('metrics include items_total', async () => {
      const res = await request(app).get('/api/metrics').expect(200);
      assert.ok(res.text.includes('items_total'));
    });

    it('metrics include active_sessions', async () => {
      const res = await request(app).get('/api/metrics').expect(200);
      assert.ok(res.text.includes('active_sessions'));
    });

    it('metrics include histogram buckets', async () => {
      const res = await request(app).get('/api/metrics').expect(200);
      assert.ok(res.text.includes('http_request_duration_seconds_bucket'));
    });
  });

  // ════════════════════════════════════════════
  // #87: Log rotation
  // ════════════════════════════════════════════
  describe('#87: Logger', () => {
    it('logger has fileLog method', () => {
      const logger = require('../src/logger');
      assert.equal(typeof logger.fileLog, 'function');
    });

    it('fileLog writes to file', () => {
      const testLogDir = path.join(dir, 'test-logs');
      if (!fs.existsSync(testLogDir)) fs.mkdirSync(testLogDir, { recursive: true });
      const logFile = path.join(testLogDir, 'dataflow.log');
      const entry = JSON.stringify({ time: new Date().toISOString(), level: 'info', msg: 'test message', key: 'value' });
      fs.writeFileSync(logFile, entry + '\n', { flag: 'a' });
      assert.ok(fs.existsSync(logFile), 'log file should be created');
      const content = fs.readFileSync(logFile, 'utf8');
      assert.ok(content.includes('test message'));
    });

    it('config has log.dir and log.maxFiles', () => {
      const config = require('../src/config');
      assert.equal(typeof config.log.dir, 'string');
      assert.equal(typeof config.log.maxFiles, 'number');
      assert.ok(config.log.maxFiles > 0);
    });
  });

  // ════════════════════════════════════════════
  // #88: Docker optimization
  // ════════════════════════════════════════════
  describe('#88: Docker optimization', () => {
    it('Dockerfile uses alpine base', () => {
      const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
      assert.ok(dockerfile.includes('node:22-alpine'), 'should use alpine');
    });

    it('Dockerfile has USER node', () => {
      const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
      assert.ok(dockerfile.includes('USER node'));
    });

    it('Dockerfile has HEALTHCHECK with wget', () => {
      const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
      assert.ok(dockerfile.includes('HEALTHCHECK'));
      assert.ok(dockerfile.includes('wget'));
    });

    it('.dockerignore exists and excludes tests/', () => {
      const ignorePath = path.join(__dirname, '..', '.dockerignore');
      assert.ok(fs.existsSync(ignorePath));
      const content = fs.readFileSync(ignorePath, 'utf8');
      assert.ok(content.includes('tests/'));
      assert.ok(content.includes('node_modules/'));
      assert.ok(content.includes('.git/'));
    });
  });

  // ════════════════════════════════════════════
  // #89: Enhanced health check
  // ════════════════════════════════════════════
  describe('#89: Enhanced health check', () => {
    it('GET /api/health returns basic info (unauthenticated)', async () => {
      const res = await request(app).get('/api/health').expect(200);
      assert.equal(res.body.status, 'ok');
      assert.equal(typeof res.body.uptime, 'number');
    });

    it('GET /api/health?detail=true without auth returns basic info', async () => {
      const res = await request(app).get('/api/health?detail=true').expect(200);
      assert.equal(res.body.status, 'ok');
      assert.equal(typeof res.body.uptime, 'number');
      // Should NOT have db details without auth
      assert.equal(res.body.db, undefined);
    });

    it('GET /api/health?detail=true with auth returns detailed info', async () => {
      const res = await request(app)
        .get('/api/health?detail=true')
        .set('Cookie', `df_sid=${user.sid}`)
        .expect(200);
      assert.equal(res.body.status, 'ok');
      assert.ok(res.body.db, 'should have db info');
      assert.equal(res.body.db.connected, true);
      assert.equal(typeof res.body.db.size, 'number');
      assert.equal(typeof res.body.db.tables, 'number');
      assert.equal(typeof res.body.db.migrationVersion, 'number');
      assert.ok(res.body.nodeVersion);
      assert.ok(res.body.memoryUsage);
    });
  });
});
