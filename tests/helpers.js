'use strict';

const { tmpdir } = require('os');
const { mkdtempSync, rmSync } = require('fs');
const path = require('path');
const request = require('supertest');
const crypto = require('crypto');

let _app, _db, _dir;

function setup() {
  if (!_app) {
    process.env.NODE_ENV = 'test';
    _dir = mkdtempSync(path.join(tmpdir(), 'dataflow-test-'));
    process.env.DB_DIR = _dir;

    // Clear module cache to get a fresh server instance per test run
    delete require.cache[require.resolve('../src/server')];
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/db/index')];
    delete require.cache[require.resolve('../src/db/seed')];

    const server = require('../src/server');
    _app = server.app;
    _db = server.db;
  }
  return { app: _app, db: _db, dir: _dir };
}

function cleanDb() {
  const { db } = setup();
  db.exec('DELETE FROM item_tags');
  db.exec('DELETE FROM item_fields');
  db.exec('DELETE FROM item_attachments');
  db.exec('DELETE FROM item_shares');
  db.exec('DELETE FROM category_shares');
  db.exec('DELETE FROM items');
  db.exec('DELETE FROM tags');
  db.exec('DELETE FROM categories');
  db.exec('DELETE FROM emergency_access');
  db.exec('DELETE FROM audit_log');
  db.exec('DELETE FROM settings');
  db.exec('DELETE FROM login_attempts');
  db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM users');
}

function teardown() {
  if (_db) { try { _db.close(); } catch { /* ignore */ } }
  if (_dir) { try { rmSync(_dir, { recursive: true, force: true }); } catch { /* ignore */ } }
}

/**
 * Create a user via the API and return { id, email, sid, role }.
 */
async function makeUser(app, overrides = {}) {
  const email = overrides.email || `user-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const password = overrides.password || 'TestPass123!';
  const master_password = overrides.master_password || 'MasterPass123!';
  const display_name = overrides.display_name || 'Test User';

  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password, display_name, master_password })
    .expect(201);

  const cookies = res.headers['set-cookie'];
  let sid = null;
  if (cookies) {
    const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
    const match = cookieStr.match(/df_sid=([a-f0-9]{64})/);
    if (match) sid = match[1];
  }

  return {
    id: res.body.id,
    email,
    password,
    master_password,
    display_name,
    role: res.body.role,
    sid,
  };
}

/**
 * Get the vault key for a session by logging in.
 */
async function loginUser(app, { email, password, master_password }) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password, master_password })
    .expect(200);

  const cookies = res.headers['set-cookie'];
  let sid = null;
  if (cookies) {
    const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
    const match = cookieStr.match(/df_sid=([a-f0-9]{64})/);
    if (match) sid = match[1];
  }

  return { ...res.body, sid };
}

/**
 * Get vault key from session vault for testing.
 */
function getVaultKey(sid) {
  const sessionVault = require('../src/services/session-vault');
  return sessionVault.getVaultKey(sid);
}

/**
 * Make an authenticated request helper.
 */
function authRequest(app, sid) {
  return {
    get: (url) => request(app).get(url).set('Cookie', `df_sid=${sid}`),
    post: (url) => request(app).post(url).set('Cookie', `df_sid=${sid}`),
    put: (url) => request(app).put(url).set('Cookie', `df_sid=${sid}`),
    delete: (url) => request(app).delete(url).set('Cookie', `df_sid=${sid}`),
  };
}

/**
 * Invite a user via admin endpoint and login to get session.
 */
async function makeInvitedUser(app, adminSid, overrides = {}) {
  const email = overrides.email || `member-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const password = overrides.password || 'TestPass123!';
  const master_password = overrides.master_password || 'MasterPass123!!';
  const display_name = overrides.display_name || 'Test Member';
  const role = overrides.role || 'adult';

  await request(app)
    .post('/api/members/invite')
    .set('Cookie', `df_sid=${adminSid}`)
    .send({ email, password, display_name, role, master_password })
    .expect(201);

  const login = await loginUser(app, { email, password, master_password });
  return {
    id: login.id,
    email,
    password,
    master_password,
    display_name,
    role,
    sid: login.sid,
  };
}

module.exports = { setup, cleanDb, teardown, makeUser, loginUser, getVaultKey, authRequest, makeInvitedUser };
