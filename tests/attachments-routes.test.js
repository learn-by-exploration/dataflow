'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Attachments Routes', () => {
  let app, db, user, api;
  let testFilePath;

  before(() => {
    ({ app, db } = setup());
    // Create a test file to upload
    testFilePath = path.join(process.env.DB_DIR, 'test-upload.txt');
    fs.writeFileSync(testFilePath, 'Hello, this is a test file.');
  });

  after(() => {
    try { fs.unlinkSync(testFilePath); } catch { /* ignore */ }
    teardown();
  });

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

  async function createItem() {
    const cat = await api.post('/api/categories').send({ name: 'Files' }).expect(201);
    const rt = getBuiltinRT();
    const item = await api.post('/api/items')
      .send({ title: 'File Item', category_id: cat.body.id, record_type_id: rt.id })
      .expect(201);
    return item.body;
  }

  // ── Upload ──

  describe('POST /api/items/:itemId/attachments', () => {
    it('uploads a file', async () => {
      const item = await createItem();
      const request = require('supertest');
      const res = await request(app)
        .post(`/api/items/${item.id}/attachments`)
        .set('Cookie', `df_sid=${user.sid}`)
        .attach('file', testFilePath)
        .expect(201);
      assert.ok(res.body.id);
      assert.equal(res.body.original_name, 'test-upload.txt');
      assert.equal(res.body.mime_type, 'text/plain');
    });

    it('rejects upload without file (400)', async () => {
      const item = await createItem();
      await api.post(`/api/items/${item.id}/attachments`).expect(400);
    });

    it('rejects for non-existent item (404)', async () => {
      const request = require('supertest');
      await request(app)
        .post('/api/items/99999/attachments')
        .set('Cookie', `df_sid=${user.sid}`)
        .attach('file', testFilePath)
        .expect(404);
    });
  });

  // ── List ──

  describe('GET /api/items/:itemId/attachments', () => {
    it('lists attachments for an item', async () => {
      const item = await createItem();
      const request = require('supertest');
      await request(app)
        .post(`/api/items/${item.id}/attachments`)
        .set('Cookie', `df_sid=${user.sid}`)
        .attach('file', testFilePath)
        .expect(201);

      const res = await api.get(`/api/items/${item.id}/attachments`).expect(200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 1);
    });

    it('returns empty for item with no attachments', async () => {
      const item = await createItem();
      const res = await api.get(`/api/items/${item.id}/attachments`).expect(200);
      assert.deepEqual(res.body, []);
    });
  });

  // ── Download ──

  describe('GET /api/attachments/:id', () => {
    it('downloads an attachment', async () => {
      const item = await createItem();
      const request = require('supertest');
      const uploaded = await request(app)
        .post(`/api/items/${item.id}/attachments`)
        .set('Cookie', `df_sid=${user.sid}`)
        .attach('file', testFilePath)
        .expect(201);

      const res = await api.get(`/api/attachments/${uploaded.body.id}`)
        .expect(200);
      assert.ok(res.headers['content-disposition'].includes('test-upload.txt'));
      assert.equal(res.headers['content-type'], 'text/plain');
    });

    it('returns 404 for non-existent attachment', async () => {
      await api.get('/api/attachments/99999').expect(404);
    });
  });

  // ── Delete ──

  describe('DELETE /api/attachments/:id', () => {
    it('deletes an attachment', async () => {
      const item = await createItem();
      const request = require('supertest');
      const uploaded = await request(app)
        .post(`/api/items/${item.id}/attachments`)
        .set('Cookie', `df_sid=${user.sid}`)
        .attach('file', testFilePath)
        .expect(201);

      await api.delete(`/api/attachments/${uploaded.body.id}`).expect(204);
      await api.get(`/api/attachments/${uploaded.body.id}`).expect(404);
    });
  });

  // ── Auth ──

  describe('Auth required', () => {
    it('returns 401 without session', async () => {
      const request = require('supertest');
      await request(app).get('/api/items/1/attachments').expect(401);
    });
  });
});
