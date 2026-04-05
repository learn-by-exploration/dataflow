'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Settings Routes', () => {
  let app, db, user, api;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());

  beforeEach(async () => {
    cleanDb();
    user = await makeUser(app);
    const logged = await loginUser(app, user);
    user.sid = logged.sid;
    api = authRequest(app, user.sid);
  });

  describe('GET /api/settings', () => {
    it('returns empty object initially', async () => {
      const res = await api.get('/api/settings').expect(200);
      assert.deepEqual(res.body, {});
    });

    it('returns stored settings', async () => {
      await api.put('/api/settings/theme').send({ value: 'dark' }).expect(200);
      await api.put('/api/settings/language').send({ value: 'en' }).expect(200);
      const res = await api.get('/api/settings').expect(200);
      assert.equal(res.body.theme, 'dark');
      assert.equal(res.body.language, 'en');
    });
  });

  describe('PUT /api/settings/:key', () => {
    it('creates a setting', async () => {
      const res = await api.put('/api/settings/theme').send({ value: 'dark' }).expect(200);
      assert.equal(res.body.key, 'theme');
      assert.equal(res.body.value, 'dark');
    });

    it('updates an existing setting', async () => {
      await api.put('/api/settings/theme').send({ value: 'dark' }).expect(200);
      const res = await api.put('/api/settings/theme').send({ value: 'light' }).expect(200);
      assert.equal(res.body.value, 'light');

      const all = await api.get('/api/settings').expect(200);
      assert.equal(all.body.theme, 'light');
    });

    it('rejects missing value (400)', async () => {
      await api.put('/api/settings/theme').send({}).expect(400);
    });
  });

  describe('DELETE /api/settings/:key', () => {
    it('deletes a setting', async () => {
      await api.put('/api/settings/theme').send({ value: 'dark' }).expect(200);
      await api.delete('/api/settings/theme').expect(204);
      const res = await api.get('/api/settings').expect(200);
      assert.equal(res.body.theme, undefined);
    });

    it('succeeds even if key does not exist', async () => {
      await api.delete('/api/settings/nonexistent').expect(204);
    });
  });

  describe('Auth required', () => {
    it('returns 401 without session', async () => {
      await request(app).get('/api/settings').expect(401);
    });
  });
});

describe('Health Route', () => {
  let app;

  before(() => {
    ({ app } = setup());
  });

  after(() => teardown());

  it('returns health status without auth', async () => {
    const res = await request(app).get('/api/health').expect(200);
    assert.equal(res.body.status, 'ok');
    assert.ok(typeof res.body.uptime === 'number');
    assert.ok(res.body.version);
  });
});
