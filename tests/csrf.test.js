'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown } = require('./helpers');

describe('CSRF Protection', () => {
  before(() => {
    // CSRF is disabled in test mode (config.isTest = true), so we test
    // CSRF middleware behavior directly for these tests
    setup();
  });

  after(() => teardown());

  beforeEach(() => cleanDb());

  it('CSRF middleware is a function', () => {
    const createCsrfMiddleware = require('../src/middleware/csrf');
    const middleware = createCsrfMiddleware();
    assert.equal(typeof middleware, 'function');
  });

  it('CSRF middleware allows GET requests', () => {
    const createCsrfMiddleware = require('../src/middleware/csrf');
    const middleware = createCsrfMiddleware();
    let nextCalled = false;
    const req = { method: 'GET', cookies: {}, path: '/test', headers: {} };
    const res = {
      getHeader: () => undefined,
      setHeader: () => {},
    };
    middleware(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('CSRF middleware allows HEAD requests', () => {
    const createCsrfMiddleware = require('../src/middleware/csrf');
    const middleware = createCsrfMiddleware();
    let nextCalled = false;
    const req = { method: 'HEAD', cookies: {}, path: '/test', headers: {} };
    const res = {
      getHeader: () => undefined,
      setHeader: () => {},
    };
    middleware(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('CSRF middleware allows OPTIONS requests', () => {
    const createCsrfMiddleware = require('../src/middleware/csrf');
    const middleware = createCsrfMiddleware();
    let nextCalled = false;
    const req = { method: 'OPTIONS', cookies: {}, path: '/test', headers: {} };
    const res = {
      getHeader: () => undefined,
      setHeader: () => {},
    };
    middleware(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('CSRF middleware exempts auth login', () => {
    const createCsrfMiddleware = require('../src/middleware/csrf');
    const middleware = createCsrfMiddleware();
    let nextCalled = false;
    const req = { method: 'POST', cookies: {}, path: '/auth/login', headers: {} };
    const res = {
      getHeader: () => undefined,
      setHeader: () => {},
    };
    middleware(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('CSRF middleware exempts auth register', () => {
    const createCsrfMiddleware = require('../src/middleware/csrf');
    const middleware = createCsrfMiddleware();
    let nextCalled = false;
    const req = { method: 'POST', cookies: {}, path: '/auth/register', headers: {} };
    const res = {
      getHeader: () => undefined,
      setHeader: () => {},
    };
    middleware(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('CSRF middleware exempts auth logout', () => {
    const createCsrfMiddleware = require('../src/middleware/csrf');
    const middleware = createCsrfMiddleware();
    let nextCalled = false;
    const req = { method: 'POST', cookies: {}, path: '/auth/logout', headers: {} };
    const res = {
      getHeader: () => undefined,
      setHeader: () => {},
    };
    middleware(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('CSRF middleware rejects POST without token', () => {
    const createCsrfMiddleware = require('../src/middleware/csrf');
    const middleware = createCsrfMiddleware();
    let nextCalled = false;
    let statusCode, body;
    const req = { method: 'POST', cookies: {}, path: '/items', headers: {} };
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { body = data; },
      getHeader: () => undefined,
      setHeader: () => {},
    };
    middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
    assert.match(body.error, /CSRF/i);
  });

  it('CSRF middleware rejects mismatched tokens', () => {
    const createCsrfMiddleware = require('../src/middleware/csrf');
    const middleware = createCsrfMiddleware();
    let nextCalled = false;
    let statusCode;
    const req = {
      method: 'POST',
      path: '/items',
      cookies: { csrf_token: 'aaaa' },
      headers: { 'x-csrf-token': 'bbbb' },
    };
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: () => {},
      getHeader: () => undefined,
      setHeader: () => {},
    };
    middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  it('CSRF middleware accepts matching tokens', () => {
    const createCsrfMiddleware = require('../src/middleware/csrf');
    const middleware = createCsrfMiddleware();
    let nextCalled = false;
    const token = 'a'.repeat(64);
    const req = {
      method: 'POST',
      path: '/items',
      cookies: { csrf_token: token },
      headers: { 'x-csrf-token': token },
    };
    const res = {
      getHeader: () => undefined,
      setHeader: () => {},
    };
    middleware(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('CSRF middleware sets cookie on GET if none exists', () => {
    const createCsrfMiddleware = require('../src/middleware/csrf');
    const middleware = createCsrfMiddleware();
    const req = { method: 'GET', cookies: {}, path: '/test', headers: {} };
    let cookieHeader;
    const res = {
      getHeader: () => undefined,
      setHeader: (name, value) => { if (name === 'Set-Cookie') cookieHeader = value; },
    };
    middleware(req, res, () => {});
    assert.ok(cookieHeader, 'Should set CSRF cookie');
    const cookieStr = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
    assert.match(cookieStr, /csrf_token=[a-f0-9]{64}/);
    assert.match(cookieStr, /SameSite=Strict/);
  });

  it('CSRF middleware does not reset existing cookie', () => {
    const createCsrfMiddleware = require('../src/middleware/csrf');
    const middleware = createCsrfMiddleware();
    const existing = 'a'.repeat(64);
    const req = { method: 'GET', cookies: { csrf_token: existing }, path: '/test' };
    let cookieHeader;
    const res = {
      getHeader: () => undefined,
      setHeader: (name, value) => { if (name === 'Set-Cookie') cookieHeader = value; },
    };
    middleware(req, res, () => {});
    assert.equal(cookieHeader, undefined, 'Should not reset existing CSRF cookie');
  });
});
