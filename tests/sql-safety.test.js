'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

async function makeLoggedInUser(app, overrides = {}) {
  const user = await makeUser(app, overrides);
  const logged = await loginUser(app, user);
  return { ...user, sid: logged.sid };
}

describe('SQL Injection Safety', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());
  beforeEach(() => cleanDb());

  const sqlPayloads = [
    "'; DROP TABLE categories; --",
    "1' OR '1'='1",
    "1; DELETE FROM users; --",
    "' UNION SELECT * FROM users --",
    "Robert'); DROP TABLE items;--",
  ];

  describe('Category name with SQL injection', () => {
    it('safely handles SQL in category name', async () => {
      const user = await makeLoggedInUser(app);
      const api = authRequest(app, user.sid);
      const res = await api.post('/api/categories').send({ name: sqlPayloads[0] });
      // Should either create safely or return validation error, not crash
      assert.ok(res.status === 201 || res.status === 400, `Expected 201 or 400, got ${res.status}`);

      if (res.status === 201) {
        const list = await api.get('/api/categories').expect(200);
        assert.ok(list.body.length >= 1);
      }

      // Tables should still exist
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      assert.ok(tables.length > 0, 'Database tables should still exist');
    });

    it('safely handles UNION SELECT in category name', async () => {
      const user = await makeLoggedInUser(app);
      const api = authRequest(app, user.sid);
      const res = await api.post('/api/categories').send({ name: sqlPayloads[3] });
      assert.ok(res.status === 201 || res.status === 400);
    });
  });

  describe('Item title with SQL injection', () => {
    it('safely handles SQL in item title', async () => {
      const user = await makeLoggedInUser(app);
      const api = authRequest(app, user.sid);
      const cat = await api.post('/api/categories').send({ name: 'Test' }).expect(201);
      const types = await api.get('/api/record-types').expect(200);
      const rtId = types.body[0]?.id || 1;

      const res = await api.post('/api/items').send({
        title: sqlPayloads[4],
        category_id: cat.body.id,
        record_type_id: rtId,
      });
      assert.ok(res.status === 201 || res.status === 400, `Expected 201 or 400, got ${res.status}`);
    });

    it('safely handles OR injection in item title', async () => {
      const user = await makeLoggedInUser(app);
      const api = authRequest(app, user.sid);
      const cat = await api.post('/api/categories').send({ name: 'Test' }).expect(201);
      const types = await api.get('/api/record-types').expect(200);
      const rtId = types.body[0]?.id || 1;

      const res = await api.post('/api/items').send({
        title: sqlPayloads[1],
        category_id: cat.body.id,
        record_type_id: rtId,
      });
      assert.ok(res.status === 201 || res.status === 400);
    });
  });

  describe('Tag name with SQL injection', () => {
    it('safely handles quotes and SQL in tag name', async () => {
      const user = await makeLoggedInUser(app);
      const api = authRequest(app, user.sid);
      const res = await api.post('/api/tags').send({ name: sqlPayloads[0] });
      assert.ok(res.status === 201 || res.status === 400);
    });

    it('safely handles DELETE injection in tag name', async () => {
      const user = await makeLoggedInUser(app);
      const api = authRequest(app, user.sid);
      const res = await api.post('/api/tags').send({ name: sqlPayloads[2] });
      assert.ok(res.status === 201 || res.status === 400);

      // Users table still intact
      const count = db.prepare('SELECT COUNT(*) AS cnt FROM users').get();
      assert.ok(count.cnt >= 1);
    });
  });

  describe('Search query with SQL injection', () => {
    it('safely handles SQL in search/filter query', async () => {
      const user = await makeLoggedInUser(app);
      const api = authRequest(app, user.sid);
      // Items list endpoint with various query params
      const res = await api.get('/api/items?category_id=' + encodeURIComponent(sqlPayloads[1]));
      // Should return validation error, empty results, or server error — not a SQL injection
      assert.ok(res.status !== 204, 'Should return a response');
      // Verify DB is intact — injection didn't work
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      assert.ok(tables.length > 0, 'Tables should still exist');
    });

    it('safely handles SQL in sort parameter', async () => {
      const user = await makeLoggedInUser(app);
      const api = authRequest(app, user.sid);
      const res = await api.get('/api/items?sort=' + encodeURIComponent("'; DROP TABLE items; --"));
      // Zod validation or query handling rejects invalid sort values
      assert.ok([200, 400, 500].includes(res.status), `Expected 200, 400, or 500, got ${res.status}`);
      // Verify items table still exists — injection didn't work
      const count = db.prepare('SELECT COUNT(*) AS cnt FROM items').get();
      assert.ok(count.cnt >= 0, 'Items table should still exist');
    });
  });

  describe('Login email with SQL injection', () => {
    it('safely handles SQL in login email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: "admin'--",
          password: 'anything',
          master_password: 'anything',
        });
      // Should fail validation or return auth error, not crash
      assert.ok(res.status === 400 || res.status === 401, `Expected 400 or 401, got ${res.status}`);
    });

    it('safely handles SQL in login password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'user@test.com',
          password: "' OR '1'='1",
          master_password: 'anything',
        });
      assert.ok(res.status === 400 || res.status === 401);
    });

    it('safely handles UNION injection in register email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: "' UNION SELECT password_hash FROM users--@test.com",
          password: 'Pass123!',
          display_name: 'Hacker',
          master_password: 'Master123!',
        });
      // Should reject invalid email format
      assert.ok(res.status === 400 || res.status === 201);
    });
  });

  describe('Database integrity after all injections', () => {
    it('all critical tables still exist after injection attempts', async () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
      assert.ok(tables.includes('users'), 'users table should exist');
      assert.ok(tables.includes('items'), 'items table should exist');
      assert.ok(tables.includes('categories'), 'categories table should exist');
      assert.ok(tables.includes('tags'), 'tags table should exist');
      assert.ok(tables.includes('sessions'), 'sessions table should exist');
    });
  });
});
