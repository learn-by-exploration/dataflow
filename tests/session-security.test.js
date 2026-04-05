'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const crypto = require('crypto');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Session Security', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());
  beforeEach(() => cleanDb());

  describe('Session fixation prevention', () => {
    it('session ID changes after login', async () => {
      const user = await makeUser(app);
      const registerSid = user.sid;

      // Logout first
      await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `df_sid=${registerSid}`)
        .expect(200);

      // Login again
      const login = await loginUser(app, user);
      assert.ok(login.sid, 'Should get a new session');
      assert.notEqual(login.sid, registerSid, 'Session ID should change after re-login');
    });
  });

  describe('Expired session handling', () => {
    it('expired session returns 401', async () => {
      const user = await makeUser(app);

      // Manually expire the session
      db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE sid = ?").run(user.sid);

      const res = await authRequest(app, user.sid).get('/api/categories');
      assert.equal(res.status, 401);
    });
  });

  describe('Invalid session handling', () => {
    it('invalid session ID returns 401', async () => {
      const fakeSid = crypto.randomBytes(32).toString('hex');
      const res = await authRequest(app, fakeSid).get('/api/categories');
      assert.equal(res.status, 401);
    });

    it('empty session cookie returns 401', async () => {
      const res = await request(app)
        .get('/api/categories')
        .set('Cookie', 'df_sid=');
      assert.equal(res.status, 401);
    });
  });

  describe('Logout session invalidation', () => {
    it('logout invalidates session', async () => {
      const user = await makeUser(app);

      // Verify session works
      await authRequest(app, user.sid).get('/api/categories').expect(200);

      // Logout
      await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `df_sid=${user.sid}`)
        .expect(200);

      // Verify session no longer works
      const res = await authRequest(app, user.sid).get('/api/categories');
      assert.equal(res.status, 401);
    });

    it('cannot reuse session after logout', async () => {
      const user = await makeUser(app);
      const sid = user.sid;

      await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `df_sid=${sid}`)
        .expect(200);

      // Multiple attempts to reuse
      for (let i = 0; i < 3; i++) {
        const res = await authRequest(app, sid).get('/api/categories');
        assert.equal(res.status, 401, `Attempt ${i + 1}: session should be invalid`);
      }
    });
  });

  describe('Cookie security flags', () => {
    it('session cookie has HttpOnly flag in registration response', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'flags@test.com', password: 'Pass123!', display_name: 'Test', master_password: 'Master123!' })
        .expect(201);

      const cookies = res.headers['set-cookie'];
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      assert.ok(cookieStr.includes('HttpOnly'), 'Cookie must have HttpOnly flag');
    });

    it('session cookie has HttpOnly flag in login response', async () => {
      const user = await makeUser(app);
      await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `df_sid=${user.sid}`);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password, master_password: user.master_password })
        .expect(200);

      const cookies = res.headers['set-cookie'];
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      assert.ok(cookieStr.includes('HttpOnly'), 'Login cookie must have HttpOnly flag');
    });
  });
});
