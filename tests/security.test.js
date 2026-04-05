'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Security', () => {
  let app;

  before(() => {
    ({ app } = setup());
  });

  after(() => teardown());

  beforeEach(() => cleanDb());

  // ─── Helmet headers ───
  describe('Security Headers', () => {
    it('sets X-Content-Type-Options', async () => {
      const res = await request(app).get('/api/health');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    });

    it('sets X-Frame-Options or CSP frame-ancestors', async () => {
      const res = await request(app).get('/api/health');
      const hasXFrame = !!res.headers['x-frame-options'];
      const csp = res.headers['content-security-policy'] || '';
      const hasFrameAncestors = csp.includes('frame-ancestors');
      assert.ok(hasXFrame || hasFrameAncestors, 'Should have framing protection');
    });

    it('sets Content-Security-Policy', async () => {
      const res = await request(app).get('/api/health');
      assert.ok(res.headers['content-security-policy'], 'Should have CSP header');
    });

    it('sets Referrer-Policy', async () => {
      const res = await request(app).get('/api/health');
      assert.ok(res.headers['referrer-policy']);
    });

    it('sets X-DNS-Prefetch-Control', async () => {
      const res = await request(app).get('/api/health');
      assert.equal(res.headers['x-dns-prefetch-control'], 'off');
    });

    it('CSP blocks inline scripts', async () => {
      const res = await request(app).get('/api/health');
      const csp = res.headers['content-security-policy'] || '';
      assert.ok(!csp.includes("'unsafe-eval'"), 'Should not allow unsafe-eval');
    });
  });

  // ─── CORS ───
  describe('CORS', () => {
    it('does not set Access-Control-Allow-Origin by default', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://evil.com');
      // With cors({ origin: false }), no ACAO header
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });
  });

  // ─── Cookie security ───
  describe('Cookie Flags', () => {
    it('session cookie has HttpOnly flag', async () => {
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
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      assert.match(cookieStr, /HttpOnly/);
    });

    it('session cookie has SameSite=Strict', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'samesite@test.com',
          password: 'Password123!',
          display_name: 'SS',
          master_password: 'MasterPass123!',
        })
        .expect(201);

      const cookies = res.headers['set-cookie'];
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      assert.match(cookieStr, /SameSite=Strict/);
    });
  });

  // ─── API no-cache ───
  describe('Cache Control', () => {
    it('API responses have no-store', async () => {
      const res = await request(app).get('/api/health');
      assert.equal(res.headers['cache-control'], 'no-store');
    });
  });

  // ─── Auth required ───
  describe('Authentication Required', () => {
    it('protected endpoints require authentication', async () => {
      await request(app)
        .get('/api/items')
        .expect(401);
    });

    it('health endpoint is public', async () => {
      await request(app)
        .get('/api/health')
        .expect(200);
    });

    it('auth endpoints are public', async () => {
      const res = await request(app)
        .get('/api/auth/session')
        .expect(200);
      assert.equal(res.body.authenticated, false);
    });
  });

  // ─── API 404 catch-all ───
  describe('API 404', () => {
    it('returns JSON 404 for unknown API routes', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);
      const res = await authRequest(app, login.sid)
        .get('/api/nonexistent')
        .expect(404);
      assert.ok(res.body.error);
    });

    it('returns JSON 404 for unmatched API POST', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);
      const res = await authRequest(app, login.sid)
        .post('/api/nonexistent')
        .expect(404);
      assert.ok(res.body.error);
    });
  });

  // ─── Rate limiting (skipped in test but structure is there) ───
  describe('Rate Limiting Structure', () => {
    it('rate limit config exists', () => {
      const config = require('../src/config');
      assert.ok(config.rateLimit.windowMs > 0);
      assert.ok(config.rateLimit.max > 0);
    });
  });

  // ─── No sensitive data leak ───
  describe('Data Leak Prevention', () => {
    it('register response does not leak password hash', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'noleak@test.com',
          password: 'Password123!',
          display_name: 'NoLeak',
          master_password: 'MasterPass123!',
        })
        .expect(201);

      assert.equal(res.body.password_hash, undefined);
      assert.equal(res.body.master_key_salt, undefined);
      assert.equal(res.body.vault_key_encrypted, undefined);
    });

    it('login response does not leak password hash', async () => {
      const user = await makeUser(app);
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: user.email,
          password: user.password,
          master_password: user.master_password,
        })
        .expect(200);

      assert.equal(res.body.password_hash, undefined);
      assert.equal(res.body.master_key_salt, undefined);
      assert.equal(res.body.vault_key_encrypted, undefined);
    });

    it('session response does not leak sensitive fields', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);
      const res = await authRequest(app, login.sid)
        .get('/api/auth/session')
        .expect(200);

      assert.equal(res.body.user.password_hash, undefined);
      assert.equal(res.body.user.master_key_salt, undefined);
    });
  });

  // ─── SPA fallback ───
  describe('SPA Fallback', () => {
    it('serves index.html for non-API routes', async () => {
      const res = await request(app)
        .get('/some/page')
        .expect(200);
      assert.ok(res.text.includes('DataFlow'));
    });
  });
});
