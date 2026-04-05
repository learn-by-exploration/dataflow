'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, makeInvitedUser } = require('./helpers');

describe('RBAC Middleware', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());

  describe('requireRole unit', () => {
    const { requireRole } = require('../src/middleware/rbac');

    it('calls next() when role matches', () => {
      const middleware = requireRole('admin');
      let called = false;
      const req = { userRole: 'admin' };
      const res = {};
      middleware(req, res, () => { called = true; });
      assert.ok(called);
    });

    it('returns 403 when role does not match', () => {
      const middleware = requireRole('admin');
      let statusCode, body;
      const req = { userRole: 'adult' };
      const res = {
        status(code) { statusCode = code; return this; },
        json(data) { body = data; },
      };
      middleware(req, res, () => {});
      assert.equal(statusCode, 403);
      assert.equal(body.error.code, 'FORBIDDEN');
    });

    it('allows any of multiple specified roles', () => {
      const middleware = requireRole('admin', 'adult');
      let called = false;
      const req = { userRole: 'adult' };
      middleware(req, {}, () => { called = true; });
      assert.ok(called);
    });

    it('rejects when role not in list', () => {
      const middleware = requireRole('admin', 'adult');
      let statusCode;
      const req = { userRole: 'child' };
      const res = {
        status(code) { statusCode = code; return this; },
        json() {},
      };
      middleware(req, res, () => {});
      assert.equal(statusCode, 403);
    });
  });

  describe('RBAC Integration', () => {
    let admin, adminApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);
    });

    it('admin can invite members', async () => {
      await adminApi.post('/api/members/invite')
        .send({ email: 'a@t.com', display_name: 'A', role: 'adult', password: 'TestPass123!', master_password: 'MasterPass123!!' })
        .expect(201);
    });

    it('adult cannot invite members', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const api = authRequest(app, adult.sid);
      await api.post('/api/members/invite')
        .send({ email: 'x@t.com', display_name: 'X', role: 'guest', password: 'TestPass123!', master_password: 'MasterPass123!!' })
        .expect(403);
    });

    it('child cannot invite members', async () => {
      const child = await makeInvitedUser(app, admin.sid, { role: 'child' });
      const api = authRequest(app, child.sid);
      await api.post('/api/members/invite')
        .send({ email: 'x@t.com', display_name: 'X', role: 'guest', password: 'TestPass123!', master_password: 'MasterPass123!!' })
        .expect(403);
    });

    it('guest cannot invite members', async () => {
      const guest = await makeInvitedUser(app, admin.sid, { role: 'guest' });
      const api = authRequest(app, guest.sid);
      await api.post('/api/members/invite')
        .send({ email: 'x@t.com', display_name: 'X', role: 'guest', password: 'TestPass123!', master_password: 'MasterPass123!!' })
        .expect(403);
    });

    it('admin can deactivate member', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      await adminApi.put(`/api/members/${member.id}/deactivate`).expect(200);
    });

    it('adult cannot deactivate member', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const adultApi = authRequest(app, adult.sid);
      const other = await makeInvitedUser(app, admin.sid, { role: 'guest' });
      await adultApi.put(`/api/members/${other.id}/deactivate`).expect(403);
    });

    it('admin can delete member', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      await adminApi.delete(`/api/members/${member.id}`).expect(204);
    });

    it('adult cannot delete member', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const adultApi = authRequest(app, adult.sid);
      const other = await makeInvitedUser(app, admin.sid, { role: 'guest' });
      await adultApi.delete(`/api/members/${other.id}`).expect(403);
    });

    it('admin can access audit export', async () => {
      await adminApi.get('/api/audit/export').expect(200);
    });

    it('adult cannot access audit export', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const api = authRequest(app, adult.sid);
      await api.get('/api/audit/export').expect(403);
    });

    it('child cannot access audit export', async () => {
      const child = await makeInvitedUser(app, admin.sid, { role: 'child' });
      const api = authRequest(app, child.sid);
      await api.get('/api/audit/export').expect(403);
    });

    it('admin can list all members', async () => {
      await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const res = await adminApi.get('/api/members').expect(200);
      assert.ok(res.body.length >= 2);
      assert.ok(res.body[0].email); // admin/adult see full details
    });

    it('guest sees only basic member info', async () => {
      const guest = await makeInvitedUser(app, admin.sid, { role: 'guest' });
      const api = authRequest(app, guest.sid);
      const res = await api.get('/api/members').expect(200);
      assert.ok(res.body.length >= 2);
      assert.ok(!res.body[0].email); // guest sees basic info only
      assert.ok(res.body[0].display_name);
    });

    it('admin can change role of a member', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const res = await adminApi.put(`/api/members/${member.id}`)
        .send({ role: 'child' })
        .expect(200);
      assert.equal(res.body.role, 'child');
    });

    it('adult cannot change role', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const adultApi = authRequest(app, adult.sid);
      await adultApi.put(`/api/members/${adult.id}`)
        .send({ role: 'admin' })
        .expect(403);
    });

    it('adult can CRUD own items', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const api = authRequest(app, adult.sid);

      // Create category
      const cat = await api.post('/api/categories').send({ name: 'Test' }).expect(201);

      // Create item
      const item = await api.post('/api/items').send({
        category_id: cat.body.id,
        record_type_id: 1,
        title: 'Test Item',
      }).expect(201);

      // Read item
      await api.get(`/api/items/${item.body.id}`).expect(200);

      // Delete item
      await api.delete(`/api/items/${item.body.id}`).expect(204);
    });

    it('child can CRUD own items', async () => {
      const child = await makeInvitedUser(app, admin.sid, { role: 'child' });
      const api = authRequest(app, child.sid);

      const cat = await api.post('/api/categories').send({ name: 'Test' }).expect(201);
      const item = await api.post('/api/items').send({
        category_id: cat.body.id,
        record_type_id: 1,
        title: 'Child Item',
      }).expect(201);
      await api.get(`/api/items/${item.body.id}`).expect(200);
      await api.delete(`/api/items/${item.body.id}`).expect(204);
    });
  });
});
