'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, makeInvitedUser } = require('./helpers');

describe('Audit Routes', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());

  describe('GET /api/audit', () => {
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

    it('returns audit entries', async () => {
      const res = await adminApi.get('/api/audit').expect(200);
      assert.ok(res.body.entries);
      assert.ok(res.body.total >= 0);
      assert.ok(res.body.page);
      assert.ok(res.body.limit);
    });

    it('admin sees all entries', async () => {
      // Both admin and member have done actions (register, invite, login)
      const res = await adminApi.get('/api/audit').expect(200);
      // Admin sees entries from all users
      assert.ok(res.body.total >= 2); // at least register + invite
    });

    it('non-admin sees only own entries', async () => {
      const res = await memberApi.get('/api/audit').expect(200);
      // Member should only see their own entries
      for (const entry of res.body.entries) {
        // null user_id entries are system-level; member's entries have their user_id
        if (entry.user_id !== null) {
          assert.equal(entry.user_id, member.id);
        }
      }
    });

    it('supports pagination', async () => {
      const res = await adminApi.get('/api/audit?page=1&limit=2').expect(200);
      assert.ok(res.body.entries.length <= 2);
      assert.equal(res.body.page, 1);
      assert.equal(res.body.limit, 2);
    });

    it('supports action filter', async () => {
      const res = await adminApi.get('/api/audit?action=register').expect(200);
      for (const entry of res.body.entries) {
        assert.equal(entry.action, 'register');
      }
    });

    it('supports resource filter', async () => {
      const res = await adminApi.get('/api/audit?resource=user').expect(200);
      for (const entry of res.body.entries) {
        assert.equal(entry.resource, 'user');
      }
    });

    it('admin can filter by user_id', async () => {
      const res = await adminApi.get(`/api/audit?user_id=${member.id}`).expect(200);
      for (const entry of res.body.entries) {
        assert.equal(entry.user_id, member.id);
      }
    });

    it('non-admin user_id filter is ignored', async () => {
      // Member tries to filter by admin's user_id — should still only see own
      const res = await memberApi.get(`/api/audit?user_id=${admin.id}`).expect(200);
      for (const entry of res.body.entries) {
        if (entry.user_id !== null) {
          assert.equal(entry.user_id, member.id);
        }
      }
    });
  });

  describe('GET /api/audit/export', () => {
    let admin, adminApi;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);
    });

    it('admin can export CSV', async () => {
      const res = await adminApi.get('/api/audit/export').expect(200);
      assert.ok(res.headers['content-type'].includes('text/csv'));
      assert.ok(res.headers['content-disposition'].includes('audit-log.csv'));
      const lines = res.text.split('\n');
      assert.ok(lines.length >= 1); // at least header
      assert.ok(lines[0].includes('id,'));
      assert.ok(lines[0].includes('action'));
    });

    it('non-admin cannot export (403)', async () => {
      const member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      const api = authRequest(app, member.sid);
      await api.get('/api/audit/export').expect(403);
    });
  });
});
