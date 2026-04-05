'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Items Routes', () => {
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

  async function createCategoryAndRT() {
    const catRes = await api.post('/api/categories').send({ name: 'Test Cat' }).expect(201);
    const rt = getBuiltinRT();
    return { category_id: catRes.body.id, record_type_id: rt.id };
  }

  async function createItem(overrides = {}) {
    const { category_id, record_type_id } = await createCategoryAndRT();
    return api.post('/api/items').send({
      title: 'Test Item',
      category_id,
      record_type_id,
      ...overrides,
    }).expect(201);
  }

  // ── CRUD ──

  describe('POST /api/items', () => {
    it('creates an item with encrypted fields', async () => {
      const res = await createItem({ title: 'My Secret Login' });
      assert.equal(res.body.title, 'My Secret Login');
      assert.ok(res.body.id);

      // Verify DB has encrypted value (not plaintext)
      const raw = db.prepare('SELECT title_encrypted FROM items WHERE id = ?').get(res.body.id);
      assert.ok(raw.title_encrypted);
      assert.notEqual(raw.title_encrypted, 'My Secret Login');
    });

    it('creates item with notes', async () => {
      const res = await createItem({ title: 'With Notes', notes: 'Secret note' });
      assert.equal(res.body.notes, 'Secret note');

      const raw = db.prepare('SELECT notes_encrypted FROM items WHERE id = ?').get(res.body.id);
      assert.ok(raw.notes_encrypted);
      assert.notEqual(raw.notes_encrypted, 'Secret note');
    });

    it('rejects missing title (400)', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      await api.post('/api/items').send({ category_id, record_type_id }).expect(400);
    });

    it('rejects missing category_id (400)', async () => {
      const rt = getBuiltinRT();
      await api.post('/api/items').send({ title: 'X', record_type_id: rt.id }).expect(400);
    });
  });

  describe('GET /api/items', () => {
    it('returns empty list initially', async () => {
      const res = await api.get('/api/items').expect(200);
      assert.deepEqual(res.body, []);
    });

    it('returns decrypted items', async () => {
      await createItem({ title: 'Item 1' });
      await createItem({ title: 'Item 2' });
      const res = await api.get('/api/items').expect(200);
      assert.equal(res.body.length, 2);
      assert.ok(res.body.some(i => i.title === 'Item 1'));
      assert.ok(res.body.some(i => i.title === 'Item 2'));
    });

    it('filters by category_id', async () => {
      const cat1 = await api.post('/api/categories').send({ name: 'Cat1' }).expect(201);
      const cat2 = await api.post('/api/categories').send({ name: 'Cat2' }).expect(201);
      const rt = getBuiltinRT();
      await api.post('/api/items').send({ title: 'A', category_id: cat1.body.id, record_type_id: rt.id }).expect(201);
      await api.post('/api/items').send({ title: 'B', category_id: cat2.body.id, record_type_id: rt.id }).expect(201);

      const res = await api.get(`/api/items?category_id=${cat1.body.id}`).expect(200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].title, 'A');
    });

    it('filters by favorite', async () => {
      await createItem({ title: 'Fav', favorite: true });
      await createItem({ title: 'NotFav' });

      const res = await api.get('/api/items?favorite=true').expect(200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].title, 'Fav');
    });

    it('paginates results', async () => {
      for (let i = 0; i < 5; i++) {
        await createItem({ title: `Item ${i}` });
      }
      const res = await api.get('/api/items?page=1&limit=2').expect(200);
      assert.equal(res.body.length, 2);
    });
  });

  describe('GET /api/items/:id', () => {
    it('returns a single decrypted item', async () => {
      const created = await createItem({ title: 'Single' });
      const res = await api.get(`/api/items/${created.body.id}`).expect(200);
      assert.equal(res.body.title, 'Single');
    });

    it('returns 404 for non-existent', async () => {
      await api.get('/api/items/99999').expect(404);
    });
  });

  describe('PUT /api/items/:id', () => {
    it('updates and re-encrypts', async () => {
      const created = await createItem({ title: 'Old Title' });
      const res = await api.put(`/api/items/${created.body.id}`)
        .send({ title: 'New Title' }).expect(200);
      assert.equal(res.body.title, 'New Title');

      // Verify DB has new encrypted value
      const raw = db.prepare('SELECT title_encrypted FROM items WHERE id = ?').get(created.body.id);
      assert.notEqual(raw.title_encrypted, 'New Title');
    });

    it('returns 404 for non-existent', async () => {
      await api.put('/api/items/99999').send({ title: 'X' }).expect(404);
    });
  });

  describe('DELETE /api/items/:id', () => {
    it('deletes an item', async () => {
      const created = await createItem({ title: 'ToDelete' });
      await api.delete(`/api/items/${created.body.id}`).expect(204);
      await api.get(`/api/items/${created.body.id}`).expect(404);
    });
  });

  // ── Bulk ──

  describe('POST /api/items/bulk', () => {
    it('bulk deletes items', async () => {
      const i1 = await createItem({ title: 'D1' });
      const i2 = await createItem({ title: 'D2' });
      await api.post('/api/items/bulk')
        .send({ ids: [i1.body.id, i2.body.id], action: 'delete' })
        .expect(200);
      const res = await api.get('/api/items').expect(200);
      assert.equal(res.body.length, 0);
    });

    it('bulk moves items', async () => {
      const cat2 = await api.post('/api/categories').send({ name: 'Target' }).expect(201);
      const i1 = await createItem({ title: 'M1' });
      await api.post('/api/items/bulk')
        .send({ ids: [i1.body.id], action: 'move', category_id: cat2.body.id })
        .expect(200);
      const res = await api.get(`/api/items/${i1.body.id}`).expect(200);
      assert.equal(res.body.category_id, cat2.body.id);
    });

    it('rejects move without category_id (400)', async () => {
      const i1 = await createItem({ title: 'Bad' });
      await api.post('/api/items/bulk')
        .send({ ids: [i1.body.id], action: 'move' })
        .expect(400);
    });
  });

  // ── Count + Recent ──

  describe('GET /api/items/count', () => {
    it('returns item count', async () => {
      await createItem({ title: 'A' });
      await createItem({ title: 'B' });
      const res = await api.get('/api/items/count').expect(200);
      assert.equal(res.body.count, 2);
    });
  });

  describe('GET /api/items/recent', () => {
    it('returns recently modified items', async () => {
      await createItem({ title: 'Recent' });
      const res = await api.get('/api/items/recent').expect(200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length > 0);
    });
  });

  // ── Favorite ──

  describe('PUT /api/items/:id/favorite', () => {
    it('toggles favorite on', async () => {
      const created = await createItem({ title: 'Star' });
      assert.equal(created.body.favorite, 0);
      const res = await api.put(`/api/items/${created.body.id}/favorite`).expect(200);
      assert.equal(res.body.favorite, 1);
    });

    it('toggles favorite off', async () => {
      const created = await createItem({ title: 'Unstar', favorite: true });
      const res = await api.put(`/api/items/${created.body.id}/favorite`).expect(200);
      assert.equal(res.body.favorite, 0);
    });
  });

  // ── Reorder ──

  describe('PUT /api/items/reorder', () => {
    it('reorders items within a category', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      const i1 = await api.post('/api/items').send({ title: 'I1', category_id, record_type_id }).expect(201);
      const i2 = await api.post('/api/items').send({ title: 'I2', category_id, record_type_id }).expect(201);

      await api.put('/api/items/reorder')
        .send({ ids: [i2.body.id, i1.body.id], category_id })
        .expect(200);
    });
  });

  // ── Auth ──

  describe('Auth required', () => {
    it('returns 401 without session', async () => {
      const request = require('supertest');
      await request(app).get('/api/items').expect(401);
    });
  });
});
