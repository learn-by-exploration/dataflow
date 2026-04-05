'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Record Types Routes', () => {
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

  function getBuiltinRT() {
    return db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();
  }

  // ── List ──

  describe('GET /api/record-types', () => {
    it('returns built-in record types', async () => {
      const res = await api.get('/api/record-types').expect(200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length > 0);
      const builtin = res.body.find(r => r.is_builtin === 1);
      assert.ok(builtin);
    });
  });

  // ── Create ──

  describe('POST /api/record-types', () => {
    it('creates a custom record type', async () => {
      const res = await api.post('/api/record-types')
        .send({ name: 'Custom Type' })
        .expect(201);
      assert.equal(res.body.name, 'Custom Type');
      assert.equal(res.body.is_builtin, 0);
    });

    it('rejects empty name (400)', async () => {
      await api.post('/api/record-types').send({ name: '' }).expect(400);
    });
  });

  // ── Get one ──

  describe('GET /api/record-types/:id', () => {
    it('returns record type with fields', async () => {
      const builtin = getBuiltinRT();
      const res = await api.get(`/api/record-types/${builtin.id}`).expect(200);
      assert.equal(res.body.id, builtin.id);
      assert.ok(Array.isArray(res.body.fields));
    });

    it('returns 404 for non-existent', async () => {
      await api.get('/api/record-types/99999').expect(404);
    });
  });

  // ── Update ──

  describe('PUT /api/record-types/:id', () => {
    it('updates a custom record type', async () => {
      const created = await api.post('/api/record-types')
        .send({ name: 'Old Name' }).expect(201);
      const res = await api.put(`/api/record-types/${created.body.id}`)
        .send({ name: 'New Name' }).expect(200);
      assert.equal(res.body.name, 'New Name');
    });

    it('rejects update on built-in (403)', async () => {
      const builtin = getBuiltinRT();
      await api.put(`/api/record-types/${builtin.id}`)
        .send({ name: 'Hacked' }).expect(403);
    });
  });

  // ── Delete ──

  describe('DELETE /api/record-types/:id', () => {
    it('deletes a custom record type', async () => {
      const created = await api.post('/api/record-types')
        .send({ name: 'ToDelete' }).expect(201);
      await api.delete(`/api/record-types/${created.body.id}`).expect(204);
      await api.get(`/api/record-types/${created.body.id}`).expect(404);
    });

    it('rejects delete on built-in (403)', async () => {
      const builtin = getBuiltinRT();
      await api.delete(`/api/record-types/${builtin.id}`).expect(403);
    });
  });

  // ── Fields ──

  describe('Field management', () => {
    it('adds a field to a record type', async () => {
      const rt = await api.post('/api/record-types')
        .send({ name: 'Typed' }).expect(201);
      const res = await api.post(`/api/record-types/${rt.body.id}/fields`)
        .send({ name: 'Username', field_type: 'text' })
        .expect(201);
      assert.equal(res.body.name, 'Username');
      assert.equal(res.body.field_type, 'text');
    });

    it('updates a field', async () => {
      const rt = await api.post('/api/record-types')
        .send({ name: 'Typed2' }).expect(201);
      const field = await api.post(`/api/record-types/${rt.body.id}/fields`)
        .send({ name: 'Old', field_type: 'text' }).expect(201);
      const res = await api.put(`/api/record-types/${rt.body.id}/fields/${field.body.id}`)
        .send({ name: 'New' }).expect(200);
      assert.equal(res.body.name, 'New');
    });

    it('deletes a field', async () => {
      const rt = await api.post('/api/record-types')
        .send({ name: 'Typed3' }).expect(201);
      const field = await api.post(`/api/record-types/${rt.body.id}/fields`)
        .send({ name: 'Gone', field_type: 'text' }).expect(201);
      await api.delete(`/api/record-types/${rt.body.id}/fields/${field.body.id}`).expect(204);
    });

    it('reorders fields', async () => {
      const rt = await api.post('/api/record-types')
        .send({ name: 'Reorder' }).expect(201);
      const f1 = await api.post(`/api/record-types/${rt.body.id}/fields`)
        .send({ name: 'F1', field_type: 'text' }).expect(201);
      const f2 = await api.post(`/api/record-types/${rt.body.id}/fields`)
        .send({ name: 'F2', field_type: 'text' }).expect(201);

      await api.put(`/api/record-types/${rt.body.id}/fields/reorder`)
        .send({ ids: [f2.body.id, f1.body.id] })
        .expect(200);

      const fetched = await api.get(`/api/record-types/${rt.body.id}`).expect(200);
      assert.equal(fetched.body.fields[0].name, 'F2');
      assert.equal(fetched.body.fields[1].name, 'F1');
    });

    it('rejects invalid field type (400)', async () => {
      const rt = await api.post('/api/record-types')
        .send({ name: 'Bad' }).expect(201);
      await api.post(`/api/record-types/${rt.body.id}/fields`)
        .send({ name: 'X', field_type: 'invalid' }).expect(400);
    });
  });

  // ── Auth ──

  describe('Auth required', () => {
    it('returns 401 without session', async () => {
      const request = require('supertest');
      await request(app).get('/api/record-types').expect(401);
    });
  });
});
