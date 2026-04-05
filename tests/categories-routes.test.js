'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Categories Routes', () => {
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

  describe('GET /api/categories', () => {
    it('returns empty list initially', async () => {
      const res = await api.get('/api/categories').expect(200);
      assert.deepEqual(res.body, []);
    });

    it('returns created categories', async () => {
      await api.post('/api/categories').send({ name: 'Cat A' }).expect(201);
      await api.post('/api/categories').send({ name: 'Cat B' }).expect(201);
      const res = await api.get('/api/categories').expect(200);
      assert.equal(res.body.length, 2);
    });
  });

  describe('POST /api/categories', () => {
    it('creates a category', async () => {
      const res = await api.post('/api/categories').send({ name: 'Passwords' }).expect(201);
      assert.equal(res.body.name, 'Passwords');
      assert.ok(res.body.id);
    });

    it('creates with custom icon and color', async () => {
      const res = await api.post('/api/categories')
        .send({ name: 'Finance', icon: '💰', color: '#FF0000' })
        .expect(201);
      assert.equal(res.body.icon, '💰');
      assert.equal(res.body.color, '#FF0000');
    });

    it('rejects empty name (400)', async () => {
      await api.post('/api/categories').send({ name: '' }).expect(400);
    });

    it('rejects missing name (400)', async () => {
      await api.post('/api/categories').send({}).expect(400);
    });
  });

  describe('GET /api/categories/:id', () => {
    it('returns a single category', async () => {
      const created = await api.post('/api/categories').send({ name: 'Test' }).expect(201);
      const res = await api.get(`/api/categories/${created.body.id}`).expect(200);
      assert.equal(res.body.name, 'Test');
    });

    it('returns 404 for non-existent', async () => {
      await api.get('/api/categories/99999').expect(404);
    });
  });

  describe('PUT /api/categories/:id', () => {
    it('updates a category', async () => {
      const created = await api.post('/api/categories').send({ name: 'Old' }).expect(201);
      const res = await api.put(`/api/categories/${created.body.id}`)
        .send({ name: 'New' }).expect(200);
      assert.equal(res.body.name, 'New');
    });

    it('returns 404 for non-existent', async () => {
      await api.put('/api/categories/99999').send({ name: 'X' }).expect(404);
    });
  });

  describe('DELETE /api/categories/:id', () => {
    it('deletes a category', async () => {
      const created = await api.post('/api/categories').send({ name: 'Gone' }).expect(201);
      await api.delete(`/api/categories/${created.body.id}`).expect(204);
      await api.get(`/api/categories/${created.body.id}`).expect(404);
    });

    it('returns 404 for non-existent', async () => {
      await api.delete('/api/categories/99999').expect(404);
    });
  });

  describe('PUT /api/categories/reorder', () => {
    it('reorders categories', async () => {
      const a = await api.post('/api/categories').send({ name: 'A' }).expect(201);
      const b = await api.post('/api/categories').send({ name: 'B' }).expect(201);
      const c = await api.post('/api/categories').send({ name: 'C' }).expect(201);

      await api.put('/api/categories/reorder')
        .send({ ids: [c.body.id, a.body.id, b.body.id] })
        .expect(200);

      const res = await api.get('/api/categories').expect(200);
      assert.equal(res.body[0].name, 'C');
      assert.equal(res.body[1].name, 'A');
      assert.equal(res.body[2].name, 'B');
    });

    it('rejects empty ids (400)', async () => {
      await api.put('/api/categories/reorder').send({ ids: [] }).expect(400);
    });
  });

  // ── Auth ──

  describe('Auth required', () => {
    it('returns 401 without session', async () => {
      const request = require('supertest');
      await request(app).get('/api/categories').expect(401);
    });
  });
});
