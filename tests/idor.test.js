'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('IDOR Protection', () => {
  let app, db;
  let userA, userB, apiA, apiB;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());

  beforeEach(async () => {
    cleanDb();
    // Create two users
    userA = await makeUser(app, { email: 'alice@test.com' });
    const loggedA = await loginUser(app, userA);
    userA.sid = loggedA.sid;
    apiA = authRequest(app, userA.sid);

    userB = await makeUser(app, { email: 'bob@test.com' });
    const loggedB = await loginUser(app, userB);
    userB.sid = loggedB.sid;
    apiB = authRequest(app, userB.sid);
  });

  function getBuiltinRT() {
    return db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();
  }

  // ── Categories ──

  describe('Categories isolation', () => {
    it('user B cannot GET user A category', async () => {
      const cat = await apiA.post('/api/categories').send({ name: 'Private' }).expect(201);
      await apiB.get(`/api/categories/${cat.body.id}`).expect(404);
    });

    it('user B cannot PUT user A category', async () => {
      const cat = await apiA.post('/api/categories').send({ name: 'Private' }).expect(201);
      await apiB.put(`/api/categories/${cat.body.id}`).send({ name: 'Hacked' }).expect(404);
    });

    it('user B cannot DELETE user A category', async () => {
      const cat = await apiA.post('/api/categories').send({ name: 'Private' }).expect(201);
      await apiB.delete(`/api/categories/${cat.body.id}`).expect(404);
    });

    it('user B list does not include user A categories', async () => {
      await apiA.post('/api/categories').send({ name: 'A-Only' }).expect(201);
      const res = await apiB.get('/api/categories').expect(200);
      assert.equal(res.body.length, 0);
    });
  });

  // ── Items ──

  describe('Items isolation', () => {
    it('user B cannot GET user A item', async () => {
      const cat = await apiA.post('/api/categories').send({ name: 'Cat' }).expect(201);
      const rt = getBuiltinRT();
      const item = await apiA.post('/api/items')
        .send({ title: 'Secret', category_id: cat.body.id, record_type_id: rt.id }).expect(201);
      await apiB.get(`/api/items/${item.body.id}`).expect(404);
    });

    it('user B cannot PUT user A item', async () => {
      const cat = await apiA.post('/api/categories').send({ name: 'Cat' }).expect(201);
      const rt = getBuiltinRT();
      const item = await apiA.post('/api/items')
        .send({ title: 'Secret', category_id: cat.body.id, record_type_id: rt.id }).expect(201);
      await apiB.put(`/api/items/${item.body.id}`).send({ title: 'Hacked' }).expect(404);
    });

    it('user B cannot DELETE user A item', async () => {
      const cat = await apiA.post('/api/categories').send({ name: 'Cat' }).expect(201);
      const rt = getBuiltinRT();
      const item = await apiA.post('/api/items')
        .send({ title: 'Secret', category_id: cat.body.id, record_type_id: rt.id }).expect(201);
      await apiB.delete(`/api/items/${item.body.id}`).expect(404);
    });

    it('user B list does not include user A items', async () => {
      const cat = await apiA.post('/api/categories').send({ name: 'Cat' }).expect(201);
      const rt = getBuiltinRT();
      await apiA.post('/api/items')
        .send({ title: 'Private', category_id: cat.body.id, record_type_id: rt.id }).expect(201);
      const res = await apiB.get('/api/items').expect(200);
      assert.equal(res.body.length, 0);
    });

    it('user B cannot toggle favorite on user A item', async () => {
      const cat = await apiA.post('/api/categories').send({ name: 'Cat' }).expect(201);
      const rt = getBuiltinRT();
      const item = await apiA.post('/api/items')
        .send({ title: 'Fav', category_id: cat.body.id, record_type_id: rt.id }).expect(201);
      await apiB.put(`/api/items/${item.body.id}/favorite`).expect(404);
    });
  });

  // ── Tags ──

  describe('Tags isolation', () => {
    it('user B cannot GET user A tag (via update)', async () => {
      const tag = await apiA.post('/api/tags').send({ name: 'private' }).expect(201);
      await apiB.put(`/api/tags/${tag.body.id}`).send({ name: 'hacked' }).expect(404);
    });

    it('user B cannot DELETE user A tag', async () => {
      const tag = await apiA.post('/api/tags').send({ name: 'private' }).expect(201);
      await apiB.delete(`/api/tags/${tag.body.id}`).expect(404);
    });

    it('user B list does not include user A tags', async () => {
      await apiA.post('/api/tags').send({ name: 'a-only' }).expect(201);
      const res = await apiB.get('/api/tags').expect(200);
      assert.equal(res.body.length, 0);
    });
  });

  // ── Settings ──

  describe('Settings isolation', () => {
    it('user B cannot see user A settings', async () => {
      await apiA.put('/api/settings/theme').send({ value: 'dark' }).expect(200);
      const res = await apiB.get('/api/settings').expect(200);
      assert.equal(res.body.theme, undefined);
    });
  });

  // ── Attachments ──

  describe('Attachments isolation', () => {
    it('user B cannot list user A item attachments', async () => {
      const cat = await apiA.post('/api/categories').send({ name: 'Files' }).expect(201);
      const rt = getBuiltinRT();
      const item = await apiA.post('/api/items')
        .send({ title: 'WithFile', category_id: cat.body.id, record_type_id: rt.id }).expect(201);
      // User B tries to list attachments for A's item
      await apiB.get(`/api/items/${item.body.id}/attachments`).expect(404);
    });
  });
});
