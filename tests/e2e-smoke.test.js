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

describe('E2E Smoke Test — Full Workflow', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());
  beforeEach(() => cleanDb());

  it('register admin user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'admin@e2e.com',
        password: 'AdminPass123!',
        display_name: 'Admin',
        master_password: 'MasterPass123!',
      })
      .expect(201);

    assert.equal(res.body.role, 'admin');
    assert.equal(res.body.email, 'admin@e2e.com');
  });

  it('login as admin user', async () => {
    await makeUser(app, { email: 'admin2@e2e.com' });
    const user = await makeUser(app, { email: 'login-test@e2e.com' });

    // Logout
    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `df_sid=${user.sid}`);

    // Login again
    const login = await loginUser(app, user);
    assert.ok(login.sid, 'Should receive a session');
    assert.equal(login.email, user.email);
  });

  it('create category → item with fields → read back decrypted', async () => {
    const user = await makeLoggedInUser(app);
    const api = authRequest(app, user.sid);

    // Create category
    const cat = await api.post('/api/categories').send({ name: 'Passwords' }).expect(201);
    assert.equal(cat.body.name, 'Passwords');

    // Get record types
    const types = await api.get('/api/record-types').expect(200);
    assert.ok(types.body.length > 0, 'Should have record types');
    const rtId = types.body[0].id;

    // Create item
    const item = await api.post('/api/items').send({
      title: 'My Bank Login',
      category_id: cat.body.id,
      record_type_id: rtId,
    }).expect(201);
    assert.ok(item.body.id);
    assert.equal(item.body.title, 'My Bank Login');

    // Read item back — should be decrypted
    const retrieved = await api.get(`/api/items/${item.body.id}`).expect(200);
    assert.equal(retrieved.body.title, 'My Bank Login');
  });

  it('update item', async () => {
    const user = await makeLoggedInUser(app);
    const api = authRequest(app, user.sid);
    const cat = await api.post('/api/categories').send({ name: 'Update Test' }).expect(201);
    const types = await api.get('/api/record-types').expect(200);

    const item = await api.post('/api/items').send({
      title: 'Original Title',
      category_id: cat.body.id,
      record_type_id: types.body[0].id,
    }).expect(201);

    const updated = await api.put(`/api/items/${item.body.id}`).send({
      title: 'Updated Title',
    }).expect(200);

    assert.equal(updated.body.title, 'Updated Title');
  });

  it('share item with another user', async () => {
    const userA = await makeLoggedInUser(app, { email: 'sharer@e2e.com' });
    const userB = await makeLoggedInUser(app, { email: 'sharee@e2e.com' });
    const apiA = authRequest(app, userA.sid);

    const cat = await apiA.post('/api/categories').send({ name: 'Shared' }).expect(201);
    const types = await apiA.get('/api/record-types').expect(200);

    const item = await apiA.post('/api/items').send({
      title: 'Shared Item',
      category_id: cat.body.id,
      record_type_id: types.body[0].id,
    }).expect(201);

    const share = await apiA.post(`/api/items/${item.body.id}/share`).send({
      user_id: userB.id,
      permission: 'read',
    }).expect(201);

    assert.ok(share.body.id || share.body.ok, 'Share should succeed');
  });

  it('list and filter items', async () => {
    const user = await makeLoggedInUser(app);
    const api = authRequest(app, user.sid);
    const cat = await api.post('/api/categories').send({ name: 'Filter Test' }).expect(201);
    const types = await api.get('/api/record-types').expect(200);
    const rtId = types.body[0].id;

    await api.post('/api/items').send({ title: 'Item A', category_id: cat.body.id, record_type_id: rtId }).expect(201);
    await api.post('/api/items').send({ title: 'Item B', category_id: cat.body.id, record_type_id: rtId }).expect(201);

    const list = await api.get(`/api/items?category_id=${cat.body.id}`).expect(200);
    assert.ok(list.body.length >= 2, 'Should list filtered items');
  });

  it('export vault', async () => {
    const user = await makeLoggedInUser(app);
    const api = authRequest(app, user.sid);
    const cat = await api.post('/api/categories').send({ name: 'Export' }).expect(201);
    const types = await api.get('/api/record-types').expect(200);

    await api.post('/api/items').send({
      title: 'Export Item',
      category_id: cat.body.id,
      record_type_id: types.body[0].id,
    }).expect(201);

    const exp = await api.get('/api/data/export').expect(200);
    assert.ok(exp.body.items, 'Export should contain items');
    assert.ok(exp.body.exported_at, 'Export should have timestamp');
  });

  it('delete item', async () => {
    const user = await makeLoggedInUser(app);
    const api = authRequest(app, user.sid);
    const cat = await api.post('/api/categories').send({ name: 'Del' }).expect(201);
    const types = await api.get('/api/record-types').expect(200);

    const item = await api.post('/api/items').send({
      title: 'To Delete',
      category_id: cat.body.id,
      record_type_id: types.body[0].id,
    }).expect(201);

    await api.delete(`/api/items/${item.body.id}`).expect(204);
    await api.get(`/api/items/${item.body.id}`).expect(404);
  });

  it('logout', async () => {
    const user = await makeUser(app);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `df_sid=${user.sid}`)
      .expect(200);

    assert.ok(res.body.ok);

    // Verify session is invalidated
    const check = await authRequest(app, user.sid).get('/api/categories');
    assert.equal(check.status, 401);
  });

  it('full workflow end-to-end in one flow', async () => {
    // Register
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'full@e2e.com', password: 'Pass123!', display_name: 'Full', master_password: 'Master123!' })
      .expect(201);

    // Login to get vault key into session vault
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'full@e2e.com', password: 'Pass123!', master_password: 'Master123!' })
      .expect(200);
    const cookies = loginRes.headers['set-cookie'];
    const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
    const sidMatch = cookieStr.match(/df_sid=([a-f0-9]{64})/);
    const sid = sidMatch[1];
    const api = authRequest(app, sid);

    // Create category
    const cat = await api.post('/api/categories').send({ name: 'E2E Category' }).expect(201);

    // Get record types
    const types = await api.get('/api/record-types').expect(200);

    // Create item
    const item = await api.post('/api/items').send({
      title: 'E2E Item',
      category_id: cat.body.id,
      record_type_id: types.body[0].id,
    }).expect(201);

    // Read back
    const read = await api.get(`/api/items/${item.body.id}`).expect(200);
    assert.equal(read.body.title, 'E2E Item');

    // Update
    await api.put(`/api/items/${item.body.id}`).send({ title: 'E2E Updated' }).expect(200);

    // Export
    const exp = await api.get('/api/data/export').expect(200);
    assert.ok(exp.body.items.length >= 1);

    // Delete
    await api.delete(`/api/items/${item.body.id}`).expect(204);

    // Logout
    await request(app).post('/api/auth/logout').set('Cookie', `df_sid=${sid}`).expect(200);

    // Verify logged out
    const check = await authRequest(app, sid).get('/api/categories');
    assert.equal(check.status, 401);
  });
});
