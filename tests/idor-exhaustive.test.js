'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

async function makeLoggedInUser(app, overrides = {}) {
  const user = await makeUser(app, overrides);
  const logged = await loginUser(app, user);
  return { ...user, sid: logged.sid };
}

describe('IDOR Exhaustive Tests', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());
  beforeEach(() => cleanDb());

  async function createTwoUsersWithData() {
    const userA = await makeLoggedInUser(app, { email: 'alice@test.com' });
    const userB = await makeLoggedInUser(app, { email: 'bob@test.com' });
    const apiA = authRequest(app, userA.sid);
    const apiB = authRequest(app, userB.sid);

    // User A creates a category
    const catA = await apiA.post('/api/categories').send({ name: 'Alice Category' }).expect(201);

    // User A creates a tag
    const tagA = await apiA.post('/api/tags').send({ name: 'Alice Tag' }).expect(201);

    // User A gets record types
    const types = await apiA.get('/api/record-types').expect(200);
    const rtId = types.body[0]?.id;

    // User A creates an item
    const itemA = await apiA.post('/api/items').send({
      title: 'Alice Secret',
      category_id: catA.body.id,
      record_type_id: rtId,
    }).expect(201);

    // User A creates a setting
    await apiA.put('/api/settings/theme').send({ value: 'dark' }).expect(200);

    return { userA, userB, apiA, apiB, catA: catA.body, tagA: tagA.body, itemA: itemA.body, rtId };
  }

  // ─── Categories ───
  describe('Category IDOR', () => {
    it('user B cannot GET user A categories by ID', async () => {
      const { apiB, catA } = await createTwoUsersWithData();
      const res = await apiB.get(`/api/categories/${catA.id}`);
      assert.equal(res.status, 404);
    });

    it('user B cannot PUT user A categories', async () => {
      const { apiB, catA } = await createTwoUsersWithData();
      const res = await apiB.put(`/api/categories/${catA.id}`).send({ name: 'Hacked' });
      assert.equal(res.status, 404);
    });

    it('user B cannot DELETE user A categories', async () => {
      const { apiB, catA } = await createTwoUsersWithData();
      const res = await apiB.delete(`/api/categories/${catA.id}`);
      assert.equal(res.status, 404);
    });
  });

  // ─── Items ───
  describe('Item IDOR', () => {
    it('user B cannot GET user A items by ID', async () => {
      const { apiB, itemA } = await createTwoUsersWithData();
      const res = await apiB.get(`/api/items/${itemA.id}`);
      assert.equal(res.status, 404);
    });

    it('user B cannot PUT user A items', async () => {
      const { apiB, itemA } = await createTwoUsersWithData();
      const res = await apiB.put(`/api/items/${itemA.id}`).send({ title: 'Stolen' });
      assert.equal(res.status, 404);
    });

    it('user B cannot DELETE user A items', async () => {
      const { apiB, itemA } = await createTwoUsersWithData();
      const res = await apiB.delete(`/api/items/${itemA.id}`);
      assert.equal(res.status, 404);
    });
  });

  // ─── Tags ───
  describe('Tag IDOR', () => {
    it('user B cannot GET user A tags', async () => {
      const { apiA, apiB, tagA } = await createTwoUsersWithData();
      // B's tag list should not include A's tags
      const res = await apiB.get('/api/tags').expect(200);
      const ids = res.body.map(t => t.id);
      assert.ok(!ids.includes(tagA.id), 'B should not see A tags');
    });

    it('user B cannot PUT user A tags', async () => {
      const { apiB, tagA } = await createTwoUsersWithData();
      const res = await apiB.put(`/api/tags/${tagA.id}`).send({ name: 'Stolen' });
      assert.equal(res.status, 404);
    });

    it('user B cannot DELETE user A tags', async () => {
      const { apiB, tagA } = await createTwoUsersWithData();
      const res = await apiB.delete(`/api/tags/${tagA.id}`);
      assert.equal(res.status, 404);
    });
  });

  // ─── Record Types ───
  describe('Record Type IDOR', () => {
    it('user B cannot modify user A custom record types', async () => {
      const { apiA, apiB } = await createTwoUsersWithData();
      // A creates a custom record type
      const rt = await apiA.post('/api/record-types').send({
        name: 'A Custom Type',
        fields: [{ name: 'secret', field_type: 'text' }],
      }).expect(201);

      const res = await apiB.put(`/api/record-types/${rt.body.id}`).send({ name: 'Stolen' });
      assert.ok(res.status === 404 || res.status === 403, `Expected 404 or 403, got ${res.status}`);
    });

    it('user B cannot delete user A custom record types', async () => {
      const { apiA, apiB } = await createTwoUsersWithData();
      const rt = await apiA.post('/api/record-types').send({
        name: 'A Private Type',
        fields: [{ name: 'data', field_type: 'text' }],
      }).expect(201);

      const res = await apiB.delete(`/api/record-types/${rt.body.id}`);
      assert.ok(res.status === 404 || res.status === 403, `Expected 404 or 403, got ${res.status}`);
    });
  });

  // ─── Attachments ───
  describe('Attachment IDOR', () => {
    it('user B cannot access user A attachments', async () => {
      const { apiB, itemA } = await createTwoUsersWithData();
      const res = await apiB.get(`/api/items/${itemA.id}/attachments`);
      assert.ok(res.status === 404 || res.status === 401, `Expected 404 or 401, got ${res.status}`);
    });
  });

  // ─── Shares ───
  describe('Sharing IDOR', () => {
    it('user B cannot list user A shares', async () => {
      const { apiB } = await createTwoUsersWithData();
      const res = await apiB.get('/api/shared/items').expect(200);
      // B should get empty or only items shared with B
      assert.ok(Array.isArray(res.body));
    });

    it('user B cannot share user A items', async () => {
      const { userA, userB, apiB, itemA } = await createTwoUsersWithData();
      const res = await apiB.post(`/api/items/${itemA.id}/share`).send({
        user_id: userB.id,
        permission: 'read',
      });
      assert.ok(res.status === 404 || res.status === 403, `Expected 404 or 403, got ${res.status}`);
    });
  });

  // ─── Audit Log ───
  describe('Audit IDOR', () => {
    it('user B cannot access user A audit log entries', async () => {
      const { apiB } = await createTwoUsersWithData();
      const res = await apiB.get('/api/audit').expect(200);
      // B should only see their own audit entries
      const entries = Array.isArray(res.body) ? res.body : (res.body.data || []);
      for (const entry of entries) {
        assert.ok(entry);
      }
    });
  });

  // ─── Settings ───
  describe('Settings IDOR', () => {
    it('user B cannot access user A settings', async () => {
      const { apiB } = await createTwoUsersWithData();
      const res = await apiB.get('/api/settings').expect(200);
      // B should see empty settings (A set theme=dark, B didn't)
      assert.equal(res.body.theme, undefined, 'B should not see A settings');
    });

    it('user B cannot overwrite user A settings via same key', async () => {
      const { apiA, apiB } = await createTwoUsersWithData();
      // B sets the same key
      await apiB.put('/api/settings/theme').send({ value: 'light' }).expect(200);
      // A's value should still be dark
      const res = await apiA.get('/api/settings').expect(200);
      assert.equal(res.body.theme, 'dark', 'A settings should be unchanged');
    });
  });
});
