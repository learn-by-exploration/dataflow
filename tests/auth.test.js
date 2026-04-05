'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, getVaultKey } = require('./helpers');

describe('Auth Routes', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());

  beforeEach(() => cleanDb());

  // ─── Registration ───
  describe('POST /api/auth/register', () => {
    it('registers a new user', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'new@test.com',
          password: 'Password123!',
          display_name: 'New User',
          master_password: 'MasterPass123!',
        })
        .expect(201);

      assert.equal(res.body.email, 'new@test.com');
      assert.equal(res.body.display_name, 'New User');
      assert.ok(res.body.id);
    });

    it('first user becomes admin', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'admin@test.com',
          password: 'Password123!',
          display_name: 'Admin',
          master_password: 'MasterPass123!',
        })
        .expect(201);

      assert.equal(res.body.role, 'admin');
    });

    it('second user gets adult role', async () => {
      await makeUser(app, { email: 'first@test.com' });
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'second@test.com',
          password: 'Password123!',
          display_name: 'Second',
          master_password: 'MasterPass123!',
        })
        .expect(201);

      assert.equal(res.body.role, 'adult');
    });

    it('sets session cookie on register', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'cookie@test.com',
          password: 'Password123!',
          display_name: 'Cookie',
          master_password: 'MasterPass123!',
        })
        .expect(201);

      const cookies = res.headers['set-cookie'];
      assert.ok(cookies, 'Should set cookies');
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      assert.match(cookieStr, /df_sid=[a-f0-9]{64}/);
      assert.match(cookieStr, /HttpOnly/);
      assert.match(cookieStr, /SameSite=Strict/);
    });

    it('rejects duplicate email', async () => {
      await makeUser(app, { email: 'dup@test.com' });
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'dup@test.com',
          password: 'Password123!',
          display_name: 'Dup',
          master_password: 'MasterPass123!',
        })
        .expect(409);

      assert.match(res.body.error, /already registered/i);
    });

    it('rejects missing fields', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({})
        .expect(400);
    });

    it('rejects weak password (too short)', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'weak@test.com',
          password: 'short',
          display_name: 'Weak',
          master_password: 'MasterPass123!',
        })
        .expect(400);
    });

    it('rejects weak master password', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'weak@test.com',
          password: 'Password123!',
          display_name: 'Weak',
          master_password: 'short',
        })
        .expect(400);
    });

    it('rejects invalid email', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: 'Password123!',
          display_name: 'Bad',
          master_password: 'MasterPass123!',
        })
        .expect(400);
    });

    it('stores vault key encrypted in DB', async () => {
      await makeUser(app, { email: 'vault@test.com' });
      const user = db.prepare("SELECT * FROM users WHERE email = 'vault@test.com'").get();
      assert.ok(user.master_key_salt, 'Should have master_key_salt');
      assert.ok(user.master_key_params, 'Should have master_key_params');
      assert.ok(user.vault_key_encrypted, 'Should have vault_key_encrypted');
      const wrapped = JSON.parse(user.vault_key_encrypted);
      assert.ok(wrapped.ciphertext);
      assert.ok(wrapped.iv);
      assert.ok(wrapped.tag);
    });
  });

  // ─── Login ───
  describe('POST /api/auth/login', () => {
    it('logs in with correct credentials', async () => {
      const user = await makeUser(app);
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: user.password,
          master_password: user.master_password,
        })
        .expect(200);

      assert.equal(res.body.email, user.email);
      const cookies = res.headers['set-cookie'];
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      assert.match(cookieStr, /df_sid=[a-f0-9]{64}/);
    });

    it('stores vault key in session vault on login', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);
      assert.ok(login.sid);
      const vaultKey = getVaultKey(login.sid);
      assert.ok(vaultKey, 'Vault key should be stored in session vault');
      assert.equal(vaultKey.length, 32);
    });

    it('rejects wrong password', async () => {
      const user = await makeUser(app);
      await request(app)
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: 'wrong',
          master_password: user.master_password,
        })
        .expect(401);
    });

    it('rejects wrong master password', async () => {
      const user = await makeUser(app);
      await request(app)
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: user.password,
          master_password: 'WrongMaster123!',
        })
        .expect(401);
    });

    it('rejects non-existent email', async () => {
      await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nobody@test.com',
          password: 'Password123!',
          master_password: 'MasterPass123!',
        })
        .expect(401);
    });

    it('locks account after 5 failed attempts', async () => {
      const user = await makeUser(app);

      // 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({
            email: user.email,
            password: 'wrong',
            master_password: user.master_password,
          })
          .expect(401);
      }

      // 6th attempt should be locked
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: user.password,
          master_password: user.master_password,
        })
        .expect(401);

      assert.match(res.body.error, /locked/i);
    });

    it('records failed login attempts in DB', async () => {
      const user = await makeUser(app);
      await request(app)
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: 'wrong',
          master_password: user.master_password,
        })
        .expect(401);

      const attempt = db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(user.email);
      assert.ok(attempt);
      assert.equal(attempt.attempts, 1);
    });

    it('resets attempts on successful login', async () => {
      const user = await makeUser(app);

      // 2 failed attempts
      for (let i = 0; i < 2; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ email: user.email, password: 'wrong', master_password: user.master_password })
          .expect(401);
      }

      // Successful login
      await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password, master_password: user.master_password })
        .expect(200);

      const attempt = db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(user.email);
      assert.equal(attempt, undefined, 'Attempts should be cleared');
    });
  });

  // ─── Logout ───
  describe('POST /api/auth/logout', () => {
    it('logs out and clears session', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `df_sid=${login.sid}`)
        .expect(200);

      assert.deepEqual(res.body, { ok: true });

      // Session should be deleted from DB
      const session = db.prepare('SELECT * FROM sessions WHERE sid = ?').get(login.sid);
      assert.equal(session, undefined);
    });

    it('clears vault key from session vault on logout', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);
      assert.ok(getVaultKey(login.sid));

      await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `df_sid=${login.sid}`)
        .expect(200);

      assert.equal(getVaultKey(login.sid), null);
    });

    it('handles logout without session', async () => {
      await request(app)
        .post('/api/auth/logout')
        .expect(200);
    });
  });

  // ─── Session check ───
  describe('GET /api/auth/session', () => {
    it('returns authenticated user info', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);

      const res = await authRequest(app, login.sid)
        .get('/api/auth/session')
        .expect(200);

      assert.equal(res.body.authenticated, true);
      assert.equal(res.body.user.email, user.email);
      assert.equal(res.body.user.role, user.role);
    });

    it('returns unauthenticated when no session', async () => {
      const res = await request(app)
        .get('/api/auth/session')
        .expect(200);

      assert.equal(res.body.authenticated, false);
    });

    it('returns unauthenticated with invalid session', async () => {
      const res = await request(app)
        .get('/api/auth/session')
        .set('Cookie', 'df_sid=invalidsessionid')
        .expect(200);

      assert.equal(res.body.authenticated, false);
    });
  });

  // ─── Password change ───
  describe('PUT /api/auth/password', () => {
    it('changes password and master password', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);

      const res = await request(app)
        .put('/api/auth/password')
        .set('Cookie', `df_sid=${login.sid}`)
        .send({
          current_password: user.password,
          new_password: 'NewPassword456!',
          current_master_password: user.master_password,
          new_master_password: 'NewMaster456!',
        })
        .expect(200);

      assert.deepEqual(res.body, { ok: true });

      // Can login with new credentials
      await request(app)
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: 'NewPassword456!',
          master_password: 'NewMaster456!',
        })
        .expect(200);
    });

    it('rejects wrong current password', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);

      await request(app)
        .put('/api/auth/password')
        .set('Cookie', `df_sid=${login.sid}`)
        .send({
          current_password: 'WrongCurrent',
          new_password: 'NewPassword456!',
          current_master_password: user.master_password,
          new_master_password: 'NewMaster456!',
        })
        .expect(401);
    });

    it('rejects wrong current master password', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);

      await request(app)
        .put('/api/auth/password')
        .set('Cookie', `df_sid=${login.sid}`)
        .send({
          current_password: user.password,
          new_password: 'NewPassword456!',
          current_master_password: 'WrongMaster!',
          new_master_password: 'NewMaster456!',
        })
        .expect(401);
    });

    it('rejects unauthenticated request', async () => {
      await request(app)
        .put('/api/auth/password')
        .send({
          current_password: 'any',
          new_password: 'NewPassword456!',
          current_master_password: 'any',
          new_master_password: 'NewMaster456!',
        })
        .expect(401);
    });

    it('preserves vault key after password change', async () => {
      const user = await makeUser(app);
      const login1 = await loginUser(app, user);
      const vaultKey1 = getVaultKey(login1.sid);
      assert.ok(vaultKey1);

      await request(app)
        .put('/api/auth/password')
        .set('Cookie', `df_sid=${login1.sid}`)
        .send({
          current_password: user.password,
          new_password: 'NewPassword456!',
          current_master_password: user.master_password,
          new_master_password: 'NewMaster456!',
        })
        .expect(200);

      // Login with new creds and verify vault key is the same
      const login2 = await loginUser(app, {
        email: user.email,
        password: 'NewPassword456!',
        master_password: 'NewMaster456!',
      });
      const vaultKey2 = getVaultKey(login2.sid);
      assert.deepEqual(vaultKey1, vaultKey2, 'Vault key should be preserved');
    });
  });

  // ─── Audit logging ───
  it('logs register action in audit log', async () => {
    await makeUser(app, { email: 'audit@test.com' });
    const log = db.prepare("SELECT * FROM audit_log WHERE action = 'register'").get();
    assert.ok(log, 'Should have register audit log');
    assert.equal(log.resource, 'user');
  });

  it('logs login action in audit log', async () => {
    const user = await makeUser(app);
    await loginUser(app, user);
    const log = db.prepare("SELECT * FROM audit_log WHERE action = 'login'").get();
    assert.ok(log, 'Should have login audit log');
  });

  it('logs password_change action', async () => {
    const user = await makeUser(app);
    const login = await loginUser(app, user);
    await request(app)
      .put('/api/auth/password')
      .set('Cookie', `df_sid=${login.sid}`)
      .send({
        current_password: user.password,
        new_password: 'NewPassword456!',
        current_master_password: user.master_password,
        new_master_password: 'NewMaster456!',
      })
      .expect(200);

    const log = db.prepare("SELECT * FROM audit_log WHERE action = 'password_change'").get();
    assert.ok(log, 'Should have password_change audit log');
  });
});
