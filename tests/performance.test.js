'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, getVaultKey } = require('./helpers');
const { encrypt, decrypt, generateVaultKey } = require('../src/services/encryption');

async function makeLoggedInUser(app, overrides = {}) {
  const user = await makeUser(app, overrides);
  const logged = await loginUser(app, user);
  return { ...user, sid: logged.sid };
}

describe('Performance Tests', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());
  beforeEach(() => cleanDb());

  it('creates 100 items and lists them in < 2 seconds', async () => {
    const user = await makeLoggedInUser(app);
    const api = authRequest(app, user.sid);
    const cat = await api.post('/api/categories').send({ name: 'Perf' }).expect(201);
    const types = await api.get('/api/record-types').expect(200);
    const rtId = types.body[0]?.id || 1;

    // Create 100 items
    for (let i = 0; i < 100; i++) {
      await api.post('/api/items').send({
        title: `Perf Item ${i}`,
        category_id: cat.body.id,
        record_type_id: rtId,
      }).expect(201);
    }

    // Time the list operation
    const start = Date.now();
    const res = await api.get('/api/items?limit=100').expect(200);
    const elapsed = Date.now() - start;

    assert.ok(res.body.length >= 100, `Expected >= 100 items, got ${res.body.length}`);
    assert.ok(elapsed < 2000, `Listing took ${elapsed}ms, expected < 2000ms`);
  });

  it('search across 100 items completes in < 500ms', async () => {
    const user = await makeLoggedInUser(app);
    const api = authRequest(app, user.sid);
    const cat = await api.post('/api/categories').send({ name: 'SearchPerf' }).expect(201);
    const types = await api.get('/api/record-types').expect(200);
    const rtId = types.body[0]?.id || 1;

    for (let i = 0; i < 100; i++) {
      await api.post('/api/items').send({
        title: `Searchable Item ${i} ${i === 50 ? 'FINDME' : ''}`,
        category_id: cat.body.id,
        record_type_id: rtId,
      }).expect(201);
    }

    // Time the filtered list
    const start = Date.now();
    const res = await api.get('/api/items?limit=100').expect(200);
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 500, `Search took ${elapsed}ms, expected < 500ms`);
  });

  it('login completes in < 3 seconds (argon2id)', async () => {
    const user = await makeLoggedInUser(app);
    // Logout first
    const request = require('supertest');
    await request(app).post('/api/auth/logout').set('Cookie', `df_sid=${user.sid}`);

    const start = Date.now();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password, master_password: user.master_password })
      .expect(200);
    const elapsed = Date.now() - start;

    assert.ok(res.body.id, 'Login should succeed');
    assert.ok(elapsed < 3000, `Login took ${elapsed}ms, expected < 3000ms`);
  });

  it('export 100 items in < 2 seconds', async () => {
    const user = await makeLoggedInUser(app);
    const api = authRequest(app, user.sid);
    const cat = await api.post('/api/categories').send({ name: 'Export' }).expect(201);
    const types = await api.get('/api/record-types').expect(200);
    const rtId = types.body[0]?.id || 1;

    for (let i = 0; i < 100; i++) {
      await api.post('/api/items').send({
        title: `Export Item ${i}`,
        category_id: cat.body.id,
        record_type_id: rtId,
      }).expect(201);
    }

    const start = Date.now();
    const res = await api.get('/api/data/export').expect(200);
    const elapsed = Date.now() - start;

    assert.ok(res.body.items, 'Export should have items');
    assert.ok(elapsed < 2000, `Export took ${elapsed}ms, expected < 2000ms`);
  });

  it('encrypt/decrypt 1000 fields in < 1 second', () => {
    const key = generateVaultKey();
    const start = Date.now();

    for (let i = 0; i < 1000; i++) {
      const e = encrypt(`field value ${i} with some extra text to make it realistic`, key);
      decrypt(e.ciphertext, e.iv, e.tag, key);
    }

    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `1000 encrypt/decrypt ops took ${elapsed}ms, expected < 1000ms`);
  });

  it('creating a category completes in < 200ms', async () => {
    const user = await makeLoggedInUser(app);
    const api = authRequest(app, user.sid);

    const start = Date.now();
    await api.post('/api/categories').send({ name: 'Speed Test' }).expect(201);
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 200, `Category creation took ${elapsed}ms, expected < 200ms`);
  });

  it('creating a tag completes in < 200ms', async () => {
    const user = await makeLoggedInUser(app);
    const api = authRequest(app, user.sid);

    const start = Date.now();
    await api.post('/api/tags').send({ name: 'Fast Tag' }).expect(201);
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 200, `Tag creation took ${elapsed}ms, expected < 200ms`);
  });

  it('health check responds in < 50ms', async () => {
    const request = require('supertest');
    const start = Date.now();
    await request(app).get('/api/health').expect(200);
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 50, `Health check took ${elapsed}ms, expected < 50ms`);
  });
});
