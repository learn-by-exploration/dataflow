'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Tags Routes', () => {
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

  // ── CRUD ──

  describe('GET /api/tags', () => {
    it('returns empty list initially', async () => {
      const res = await api.get('/api/tags').expect(200);
      assert.deepEqual(res.body, []);
    });

    it('returns created tags', async () => {
      await api.post('/api/tags').send({ name: 'important' }).expect(201);
      await api.post('/api/tags').send({ name: 'personal' }).expect(201);
      const res = await api.get('/api/tags').expect(200);
      assert.equal(res.body.length, 2);
    });
  });

  describe('POST /api/tags', () => {
    it('creates a tag', async () => {
      const res = await api.post('/api/tags').send({ name: 'work' }).expect(201);
      assert.equal(res.body.name, 'work');
      assert.ok(res.body.id);
    });

    it('creates with custom color', async () => {
      const res = await api.post('/api/tags')
        .send({ name: 'urgent', color: '#FF0000' }).expect(201);
      assert.equal(res.body.color, '#FF0000');
    });

    it('rejects empty name (400)', async () => {
      await api.post('/api/tags').send({ name: '' }).expect(400);
    });

    it('rejects duplicate name (409)', async () => {
      await api.post('/api/tags').send({ name: 'dup' }).expect(201);
      await api.post('/api/tags').send({ name: 'dup' }).expect(409);
    });
  });

  describe('PUT /api/tags/:id', () => {
    it('updates a tag name', async () => {
      const created = await api.post('/api/tags').send({ name: 'old' }).expect(201);
      const res = await api.put(`/api/tags/${created.body.id}`)
        .send({ name: 'new' }).expect(200);
      assert.equal(res.body.name, 'new');
    });

    it('updates a tag color', async () => {
      const created = await api.post('/api/tags').send({ name: 'colored' }).expect(201);
      const res = await api.put(`/api/tags/${created.body.id}`)
        .send({ color: '#00FF00' }).expect(200);
      assert.equal(res.body.color, '#00FF00');
    });

    it('returns 404 for non-existent', async () => {
      await api.put('/api/tags/99999').send({ name: 'x' }).expect(404);
    });

    it('rejects duplicate name on update (409)', async () => {
      await api.post('/api/tags').send({ name: 'exists' }).expect(201);
      const other = await api.post('/api/tags').send({ name: 'other' }).expect(201);
      await api.put(`/api/tags/${other.body.id}`)
        .send({ name: 'exists' }).expect(409);
    });
  });

  describe('DELETE /api/tags/:id', () => {
    it('deletes a tag', async () => {
      const created = await api.post('/api/tags').send({ name: 'gone' }).expect(201);
      await api.delete(`/api/tags/${created.body.id}`).expect(204);
    });

    it('returns 404 for non-existent', async () => {
      await api.delete('/api/tags/99999').expect(404);
    });
  });

  // ── Usage counts ──

  describe('GET /api/tags/usage', () => {
    it('returns usage counts', async () => {
      const tag = await api.post('/api/tags').send({ name: 'used' }).expect(201);

      // Create an item and tag it
      const cat = await api.post('/api/categories').send({ name: 'TC' }).expect(201);
      const rt = db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();
      await api.post('/api/items').send({
        title: 'Tagged Item',
        category_id: cat.body.id,
        record_type_id: rt.id,
        tags: [tag.body.id],
      }).expect(201);

      const res = await api.get('/api/tags/usage').expect(200);
      assert.ok(Array.isArray(res.body));
      const used = res.body.find(t => t.id === tag.body.id);
      assert.ok(used);
      assert.equal(used.count, 1);
    });

    it('returns zero count for unused tags', async () => {
      await api.post('/api/tags').send({ name: 'unused' }).expect(201);
      const res = await api.get('/api/tags/usage').expect(200);
      assert.equal(res.body[0].count, 0);
    });
  });

  // ── Auth ──

  describe('Auth required', () => {
    it('returns 401 without session', async () => {
      const request = require('supertest');
      await request(app).get('/api/tags').expect(401);
    });
  });
});
