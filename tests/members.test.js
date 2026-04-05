'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, makeInvitedUser } = require('./helpers');

describe('Members Routes', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());

  describe('POST /api/members/invite', () => {
    let admin, adminApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);
    });

    it('admin can invite member with valid data', async () => {
      const res = await adminApi.post('/api/members/invite')
        .send({ email: 'new@test.com', display_name: 'New Member', role: 'adult', password: 'TestPass123!', master_password: 'MasterPass123!!' })
        .expect(201);
      assert.equal(res.body.email, 'new@test.com');
      assert.equal(res.body.role, 'adult');
      assert.equal(res.body.active, 1);
      assert.ok(res.body.id);
    });

    it('sets correct role on invited member', async () => {
      const res = await adminApi.post('/api/members/invite')
        .send({ email: 'child@test.com', display_name: 'Child', role: 'child', password: 'TestPass123!', master_password: 'MasterPass123!!' })
        .expect(201);
      assert.equal(res.body.role, 'child');
    });

    it('invited member can login', async () => {
      await adminApi.post('/api/members/invite')
        .send({ email: 'login@test.com', display_name: 'Login Test', role: 'adult', password: 'TestPass123!', master_password: 'MasterPass123!!' })
        .expect(201);

      const login = await loginUser(app, { email: 'login@test.com', password: 'TestPass123!', master_password: 'MasterPass123!!' });
      assert.ok(login.sid);
    });

    it('returns 409 for duplicate email', async () => {
      await adminApi.post('/api/members/invite')
        .send({ email: 'dup@test.com', display_name: 'D', role: 'adult', password: 'TestPass123!', master_password: 'MasterPass123!!' })
        .expect(201);
      await adminApi.post('/api/members/invite')
        .send({ email: 'dup@test.com', display_name: 'D2', role: 'adult', password: 'TestPass123!', master_password: 'MasterPass123!!' })
        .expect(409);
    });

    it('returns 400 for invalid data', async () => {
      await adminApi.post('/api/members/invite')
        .send({ email: 'bad', display_name: '', role: 'invalid' })
        .expect(400);
    });

    it('returns 400 for short master_password', async () => {
      await adminApi.post('/api/members/invite')
        .send({ email: 'a@b.com', display_name: 'A', role: 'adult', password: 'TestPass123!', master_password: 'short' })
        .expect(400);
    });

    it('adult cannot invite (403)', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const api = authRequest(app, adult.sid);
      await api.post('/api/members/invite')
        .send({ email: 'x@t.com', display_name: 'X', role: 'guest', password: 'TestPass123!', master_password: 'MasterPass123!!' })
        .expect(403);
    });

    it('child cannot invite (403)', async () => {
      const child = await makeInvitedUser(app, admin.sid, { role: 'child' });
      const api = authRequest(app, child.sid);
      await api.post('/api/members/invite')
        .send({ email: 'x@t.com', display_name: 'X', role: 'guest', password: 'TestPass123!', master_password: 'MasterPass123!!' })
        .expect(403);
    });

    it('guest cannot invite (403)', async () => {
      const guest = await makeInvitedUser(app, admin.sid, { role: 'guest' });
      const api = authRequest(app, guest.sid);
      await api.post('/api/members/invite')
        .send({ email: 'x@t.com', display_name: 'X', role: 'guest', password: 'TestPass123!', master_password: 'MasterPass123!!' })
        .expect(403);
    });
  });

  describe('First user is admin', () => {
    beforeEach(() => cleanDb());

    it('first registered user gets admin role', async () => {
      const user = await makeUser(app);
      assert.equal(user.role, 'admin');
    });

    it('second registered user gets adult role', async () => {
      await makeUser(app);
      const user2 = await makeUser(app, { email: 'second@test.com' });
      assert.equal(user2.role, 'adult');
    });
  });

  describe('GET /api/members', () => {
    let admin, adminApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);
    });

    it('admin sees all member details', async () => {
      await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const res = await adminApi.get('/api/members').expect(200);
      assert.ok(res.body.length >= 2);
      assert.ok(res.body[0].email);
      assert.ok(res.body[0].created_at);
      assert.ok('active' in res.body[0]);
    });

    it('adult sees all member details', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const api = authRequest(app, adult.sid);
      const res = await api.get('/api/members').expect(200);
      assert.ok(res.body[0].email);
    });

    it('child sees basic info only', async () => {
      const child = await makeInvitedUser(app, admin.sid, { role: 'child' });
      const api = authRequest(app, child.sid);
      const res = await api.get('/api/members').expect(200);
      assert.ok(res.body.length >= 2);
      assert.ok(res.body[0].display_name);
      assert.ok(!res.body[0].email);
      assert.ok(!res.body[0].created_at);
    });

    it('guest sees basic info only', async () => {
      const guest = await makeInvitedUser(app, admin.sid, { role: 'guest' });
      const api = authRequest(app, guest.sid);
      const res = await api.get('/api/members').expect(200);
      assert.ok(!res.body[0].email);
    });
  });

  describe('GET /api/members/:id', () => {
    let admin, adminApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);
    });

    it('returns member profile', async () => {
      const res = await adminApi.get(`/api/members/${admin.id}`).expect(200);
      assert.equal(res.body.id, admin.id);
      assert.ok(res.body.email);
    });

    it('returns 404 for non-existent member', async () => {
      await adminApi.get('/api/members/99999').expect(404);
    });
  });

  describe('PUT /api/members/:id', () => {
    let admin, adminApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);
    });

    it('user can update own display_name', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const api = authRequest(app, member.sid);
      const res = await api.put(`/api/members/${member.id}`)
        .send({ display_name: 'Updated Name' })
        .expect(200);
      assert.equal(res.body.display_name, 'Updated Name');
    });

    it('admin can update any member display_name', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const res = await adminApi.put(`/api/members/${member.id}`)
        .send({ display_name: 'Admin Updated' })
        .expect(200);
      assert.equal(res.body.display_name, 'Admin Updated');
    });

    it('admin can change role', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const res = await adminApi.put(`/api/members/${member.id}`)
        .send({ role: 'child' })
        .expect(200);
      assert.equal(res.body.role, 'child');
    });

    it('non-admin cannot change role (403)', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const api = authRequest(app, adult.sid);
      await api.put(`/api/members/${adult.id}`)
        .send({ role: 'admin' })
        .expect(403);
    });

    it('non-admin cannot update another member profile (403)', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const other = await makeInvitedUser(app, admin.sid, { role: 'guest' });
      const api = authRequest(app, adult.sid);
      await api.put(`/api/members/${other.id}`)
        .send({ display_name: 'Hacked' })
        .expect(403);
    });

    it('returns 404 for non-existent member', async () => {
      await adminApi.put('/api/members/99999')
        .send({ display_name: 'X' })
        .expect(404);
    });
  });

  describe('PUT /api/members/:id/deactivate', () => {
    let admin, adminApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);
    });

    it('admin can deactivate a member', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const res = await adminApi.put(`/api/members/${member.id}/deactivate`).expect(200);
      assert.equal(res.body.active, 0);
    });

    it('deactivated user session is invalidated', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const memberApi = authRequest(app, member.sid);

      // Verify member can access first
      await memberApi.get('/api/members').expect(200);

      // Deactivate
      await adminApi.put(`/api/members/${member.id}/deactivate`).expect(200);

      // Verify member session no longer works
      await memberApi.get('/api/members').expect(401);
    });

    it('cannot deactivate self', async () => {
      await adminApi.put(`/api/members/${admin.id}/deactivate`).expect(403);
    });

    it('non-admin cannot deactivate (403)', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const other = await makeInvitedUser(app, admin.sid, { role: 'guest' });
      const api = authRequest(app, adult.sid);
      await api.put(`/api/members/${other.id}/deactivate`).expect(403);
    });
  });

  describe('PUT /api/members/:id/activate', () => {
    let admin, adminApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);
    });

    it('admin can reactivate a deactivated member', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      await adminApi.put(`/api/members/${member.id}/deactivate`).expect(200);

      const res = await adminApi.put(`/api/members/${member.id}/activate`).expect(200);
      assert.equal(res.body.active, 1);
    });

    it('reactivated user can login again', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      await adminApi.put(`/api/members/${member.id}/deactivate`).expect(200);
      await adminApi.put(`/api/members/${member.id}/activate`).expect(200);

      // Login again
      const login = await loginUser(app, { email: member.email, password: member.password, master_password: member.master_password });
      assert.ok(login.sid);
      const api = authRequest(app, login.sid);
      await api.get('/api/members').expect(200);
    });

    it('non-admin cannot activate (403)', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const other = await makeInvitedUser(app, admin.sid, { role: 'guest' });
      await adminApi.put(`/api/members/${other.id}/deactivate`).expect(200);

      const api = authRequest(app, adult.sid);
      await api.put(`/api/members/${other.id}/activate`).expect(403);
    });
  });

  describe('DELETE /api/members/:id', () => {
    let admin, adminApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);
    });

    it('admin can delete a member', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      await adminApi.delete(`/api/members/${member.id}`).expect(204);

      // Verify member is gone
      await adminApi.get(`/api/members/${member.id}`).expect(404);
    });

    it('cannot delete self', async () => {
      await adminApi.delete(`/api/members/${admin.id}`).expect(403);
    });

    it('non-admin cannot delete (403)', async () => {
      const adult = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const other = await makeInvitedUser(app, admin.sid, { role: 'guest' });
      const api = authRequest(app, adult.sid);
      await api.delete(`/api/members/${other.id}`).expect(403);
    });

    it('deleting member cascades (items, sessions, etc.)', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const memberApi = authRequest(app, member.sid);

      // Create a category and item as member
      await memberApi.post('/api/categories').send({ name: 'Temp' }).expect(201);

      // Delete member
      await adminApi.delete(`/api/members/${member.id}`).expect(204);

      // Verify cascaded
      const cats = db.prepare('SELECT * FROM categories WHERE user_id = ?').all(member.id);
      assert.equal(cats.length, 0);
    });
  });
});
