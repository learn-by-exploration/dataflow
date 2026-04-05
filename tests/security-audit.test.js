'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setup, cleanDb, teardown, makeUser, authRequest } = require('./helpers');

describe('Security Audit — OWASP Top 10', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());
  beforeEach(() => cleanDb());

  // ─── Content-Type ───
  describe('Content-Type headers', () => {
    it('returns application/json on /api/health', async () => {
      const res = await request(app).get('/api/health').expect(200);
      assert.match(res.headers['content-type'], /application\/json/);
    });

    it('returns application/json on auth endpoints', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'x@x.com', password: 'x', master_password: 'x' });
      assert.match(res.headers['content-type'], /application\/json/);
    });

    it('returns application/json on 404 API routes', async () => {
      const user = await makeUser(app);
      const res = await authRequest(app, user.sid).get('/api/nonexistent');
      assert.match(res.headers['content-type'], /application\/json/);
    });
  });

  // ─── Helmet headers ───
  describe('Security headers (Helmet)', () => {
    it('sets X-Content-Type-Options: nosniff', async () => {
      const res = await request(app).get('/api/health');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    });

    it('sets X-Frame-Options', async () => {
      const res = await request(app).get('/api/health');
      // Helmet may set either DENY or SAMEORIGIN, or use frame-ancestors in CSP
      const xfo = res.headers['x-frame-options'];
      const csp = res.headers['content-security-policy'] || '';
      assert.ok(xfo || csp.includes('frame-ancestors'), 'X-Frame-Options or CSP frame-ancestors should be set');
    });

    it('removes X-Powered-By header', async () => {
      const res = await request(app).get('/api/health');
      assert.equal(res.headers['x-powered-by'], undefined);
    });

    it('sets Content-Security-Policy', async () => {
      const res = await request(app).get('/api/health');
      assert.ok(res.headers['content-security-policy'], 'CSP header should be present');
    });

    it('sets X-DNS-Prefetch-Control', async () => {
      const res = await request(app).get('/api/health');
      assert.ok(res.headers['x-dns-prefetch-control'] !== undefined);
    });
  });

  // ─── Rate limiting ───
  describe('Login rate limiting', () => {
    it('locks account after 5 failed login attempts', async () => {
      const user = await makeUser(app);

      // Attempt 5 failed logins
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ email: user.email, password: 'wrong', master_password: 'wrong' });
      }

      // 6th attempt should be locked
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password, master_password: user.master_password });

      assert.ok(res.status === 401 || res.status === 429, `Expected 401 or 429, got ${res.status}`);
      assert.ok(
        res.body.error.toLowerCase().includes('locked') || res.body.error.toLowerCase().includes('too many'),
        'Error should mention lockout'
      );
    });
  });

  // ─── Session cookie flags ───
  describe('Session cookie security', () => {
    it('sets HttpOnly flag on session cookie', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'cookie@test.com', password: 'Pass123!', display_name: 'Test', master_password: 'Master123!' })
        .expect(201);

      const cookies = res.headers['set-cookie'];
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      assert.ok(cookieStr.includes('HttpOnly'), 'Cookie should have HttpOnly flag');
    });

    it('sets SameSite flag on session cookie', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'samesite@test.com', password: 'Pass123!', display_name: 'Test', master_password: 'Master123!' })
        .expect(201);

      const cookies = res.headers['set-cookie'];
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      assert.ok(cookieStr.includes('SameSite'), 'Cookie should have SameSite flag');
    });
  });

  // ─── CORS ───
  describe('CORS configuration', () => {
    it('does not reflect arbitrary origins', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://evil.com');
      // Should NOT get access-control-allow-origin for arbitrary domains
      const acao = res.headers['access-control-allow-origin'];
      assert.ok(!acao || acao !== 'https://evil.com', 'Should not allow arbitrary origin');
    });
  });

  // ─── Body size limit ───
  describe('JSON body size limit', () => {
    it('rejects oversized JSON bodies', async () => {
      const user = await makeUser(app);
      const bigBody = { data: 'x'.repeat(200 * 1024) }; // 200KB > 100KB limit
      const res = await authRequest(app, user.sid)
        .post('/api/categories')
        .send(bigBody);
      assert.ok(res.status === 413 || res.status === 400, `Expected 413 or 400, got ${res.status}`);
    });
  });

  // ─── Error response safety ───
  describe('Error response safety', () => {
    it('does not leak stack traces in error responses', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nope@x.com', password: 'x', master_password: 'x' });
      const body = JSON.stringify(res.body);
      assert.ok(!body.includes('at '), 'Error should not contain stack trace');
      assert.ok(!body.includes('node_modules'), 'Error should not reference node_modules');
    });

    it('returns JSON error for malformed JSON', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{ bad json }');
      assert.match(res.headers['content-type'], /application\/json/);
      assert.ok(res.body.error);
    });
  });

  // ─── Authentication enforcement ───
  describe('Authentication enforcement', () => {
    it('allows unauthenticated access to /api/auth/register', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'open@test.com', password: 'Pass123!', display_name: 'Test', master_password: 'Master123!' });
      assert.equal(res.status, 201);
    });

    it('allows unauthenticated access to /api/auth/login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'none@test.com', password: 'x', master_password: 'x' });
      // Should get auth error, not 401 for missing session
      assert.ok(res.status === 400 || res.status === 401);
    });

    it('allows unauthenticated access to /api/health', async () => {
      const res = await request(app).get('/api/health');
      assert.equal(res.status, 200);
    });

    it('returns 401 on protected routes without auth', async () => {
      const res = await request(app).get('/api/categories');
      assert.equal(res.status, 401);
    });

    it('returns 401 on /api/items without auth', async () => {
      const res = await request(app).get('/api/items');
      assert.equal(res.status, 401);
    });

    it('returns 401 on /api/tags without auth', async () => {
      const res = await request(app).get('/api/tags');
      assert.equal(res.status, 401);
    });
  });

  // ─── 404 returns JSON ───
  describe('404 responses', () => {
    it('returns JSON for missing API routes', async () => {
      const user = await makeUser(app);
      const res = await authRequest(app, user.sid).get('/api/does-not-exist');
      assert.equal(res.status, 404);
      assert.match(res.headers['content-type'], /application\/json/);
      assert.ok(res.body.error);
    });

    it('returns JSON for missing resource by ID', async () => {
      const user = await makeUser(app);
      const res = await authRequest(app, user.sid).get('/api/categories/999999');
      assert.equal(res.status, 404);
      assert.match(res.headers['content-type'], /application\/json/);
    });
  });
});
