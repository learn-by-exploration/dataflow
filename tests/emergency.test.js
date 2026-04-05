'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, makeInvitedUser } = require('./helpers');

describe('Emergency Access', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());

  describe('POST /api/emergency/request', () => {
    let admin, adminApi, member, memberApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);

      member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      memberApi = authRequest(app, member.sid);
    });

    it('can request access to another user vault', async () => {
      const res = await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);
      assert.equal(res.body.grantor_id, admin.id);
      assert.equal(res.body.grantee_id, member.id);
      assert.equal(res.body.status, 'pending');
      assert.equal(res.body.wait_days, 3);
    });

    it('cannot request own vault', async () => {
      await memberApi.post('/api/emergency/request')
        .send({ grantor_id: member.id })
        .expect(403);
    });

    it('returns 404 for non-existent user', async () => {
      await memberApi.post('/api/emergency/request')
        .send({ grantor_id: 99999 })
        .expect(404);
    });

    it('returns 400 without grantor_id', async () => {
      await memberApi.post('/api/emergency/request')
        .send({})
        .expect(400);
    });

    it('uses custom wait_days from settings', async () => {
      // Set custom wait_days for admin
      await adminApi.put('/api/settings/emergency_wait_days')
        .send({ value: '5' })
        .expect(200);

      const res = await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);
      assert.equal(res.body.wait_days, 5);
    });
  });

  describe('GET /api/emergency/requests', () => {
    let admin, adminApi, member, memberApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);

      member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      memberApi = authRequest(app, member.sid);
    });

    it('grantor sees request in list', async () => {
      await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);

      const res = await adminApi.get('/api/emergency/requests').expect(200);
      assert.ok(res.body.length >= 1);
      assert.equal(res.body[0].grantor_id, admin.id);
    });

    it('grantee sees request in list', async () => {
      await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);

      const res = await memberApi.get('/api/emergency/requests').expect(200);
      assert.ok(res.body.length >= 1);
      assert.equal(res.body[0].grantee_id, member.id);
    });

    it('unrelated user does not see request', async () => {
      await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);

      const other = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const otherApi = authRequest(app, other.sid);
      const res = await otherApi.get('/api/emergency/requests').expect(200);
      assert.equal(res.body.length, 0);
    });
  });

  describe('PUT /api/emergency/:id/approve', () => {
    let admin, adminApi, member, memberApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);

      member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      memberApi = authRequest(app, member.sid);
    });

    it('cannot approve before wait period', async () => {
      // Use member as grantor (non-admin) so admin override doesn't apply
      const other = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const otherApi = authRequest(app, other.sid);

      const req = await otherApi.post('/api/emergency/request')
        .send({ grantor_id: member.id })
        .expect(201);

      // Member (grantor, non-admin) tries to approve immediately (wait_days = 3)
      await memberApi.put(`/api/emergency/${req.body.id}/approve`).expect(400);
    });

    it('grantor can approve after wait period', async () => {
      const req = await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);

      // Fake requested_at to be 10 days ago
      db.prepare("UPDATE emergency_access SET requested_at = datetime('now', '-10 days') WHERE id = ?")
        .run(req.body.id);

      const res = await adminApi.put(`/api/emergency/${req.body.id}/approve`).expect(200);
      assert.equal(res.body.status, 'approved');
      assert.ok(res.body.approved_at);
      assert.ok(res.body.expires_at);
    });

    it('admin can approve bypassing wait period', async () => {
      // member requests access to admin's vault;
      // admin IS the grantor AND admin role → can override
      const req = await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);

      // Admin can approve immediately (admin override)
      const res = await adminApi.put(`/api/emergency/${req.body.id}/approve`).expect(200);
      assert.equal(res.body.status, 'approved');
    });

    it('non-grantor cannot approve', async () => {
      const other = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const otherApi = authRequest(app, other.sid);

      const req = await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);

      await otherApi.put(`/api/emergency/${req.body.id}/approve`).expect(403);
    });

    it('cannot approve already processed request', async () => {
      const req = await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);

      // Admin approves (admin override)
      await adminApi.put(`/api/emergency/${req.body.id}/approve`).expect(200);

      // Try to approve again
      await adminApi.put(`/api/emergency/${req.body.id}/approve`).expect(400);
    });

    it('returns 404 for non-existent request', async () => {
      await adminApi.put('/api/emergency/99999/approve').expect(404);
    });
  });

  describe('PUT /api/emergency/:id/reject', () => {
    let admin, adminApi, member, memberApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);

      member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      memberApi = authRequest(app, member.sid);
    });

    it('grantor can reject', async () => {
      const req = await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);

      const res = await adminApi.put(`/api/emergency/${req.body.id}/reject`).expect(200);
      assert.equal(res.body.status, 'rejected');
    });

    it('non-grantor cannot reject', async () => {
      const other = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const otherApi = authRequest(app, other.sid);

      const req = await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);

      await otherApi.put(`/api/emergency/${req.body.id}/reject`).expect(403);
    });
  });

  describe('DELETE /api/emergency/:id', () => {
    let admin, adminApi, member, memberApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);

      member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      memberApi = authRequest(app, member.sid);
    });

    it('grantee can cancel own request', async () => {
      const req = await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);

      await memberApi.delete(`/api/emergency/${req.body.id}`).expect(204);

      // Verify deleted
      const requests = await memberApi.get('/api/emergency/requests').expect(200);
      assert.equal(requests.body.length, 0);
    });

    it('non-grantee cannot cancel', async () => {
      const other = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const otherApi = authRequest(app, other.sid);

      const req = await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);

      await otherApi.delete(`/api/emergency/${req.body.id}`).expect(403);
    });

    it('admin can cancel any request', async () => {
      const req = await memberApi.post('/api/emergency/request')
        .send({ grantor_id: admin.id })
        .expect(201);

      await adminApi.delete(`/api/emergency/${req.body.id}`).expect(204);
    });
  });
});
