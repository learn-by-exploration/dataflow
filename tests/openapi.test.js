'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { setup, cleanDb, teardown, makeUser, loginUser } = require('./helpers');

describe('#86: OpenAPI spec validation', () => {
  let app, db, user;

  before(async () => {
    ({ app, db } = setup());
    cleanDb();
    user = await makeUser(app);
    const logged = await loginUser(app, user);
    user.sid = logged.sid;
  });

  after(() => teardown());

  const specPath = path.join(__dirname, '..', 'docs', 'openapi.yaml');

  it('openapi.yaml exists', () => {
    assert.ok(fs.existsSync(specPath), 'openapi.yaml should exist');
  });

  it('openapi.yaml is valid YAML with required fields', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    assert.ok(content.includes('openapi:'), 'should have openapi version');
    assert.ok(content.includes('info:'), 'should have info section');
    assert.ok(content.includes('paths:'), 'should have paths section');
    assert.ok(content.includes('title: DataFlow API'), 'should have API title');
  });

  it('spec covers /api/health endpoint', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    assert.ok(content.includes('/api/health:'), 'should document /api/health');
    assert.ok(content.includes('get:'), 'should document GET method');
  });

  it('spec covers /api/auth/register endpoint', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    assert.ok(content.includes('/api/auth/register:'), 'should document /api/auth/register');
  });

  it('spec covers /api/auth/login endpoint', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    assert.ok(content.includes('/api/auth/login:'), 'should document /api/auth/login');
  });

  it('spec covers /api/categories endpoint', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    assert.ok(content.includes('/api/categories:'), 'should document /api/categories');
  });

  it('spec covers /api/items endpoint', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    assert.ok(content.includes('/api/items:'), 'should document /api/items');
  });

  it('spec covers /api/tags endpoint', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    assert.ok(content.includes('/api/tags:'), 'should document /api/tags');
  });

  it('spec covers /api/metrics endpoint', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    assert.ok(content.includes('/api/metrics:'), 'should document /api/metrics');
  });

  it('spec covers /api/data endpoints', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    assert.ok(content.includes('/api/data/import:'), 'should document import');
    assert.ok(content.includes('/api/data/export:'), 'should document export');
    assert.ok(content.includes('/api/data/backup:'), 'should document backup');
    assert.ok(content.includes('/api/data/backups/verify:'), 'should document backup verify');
  });

  it('spec covers /api/members endpoints', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    assert.ok(content.includes('/api/members:'), 'should document members');
    assert.ok(content.includes('/api/members/invite:'), 'should document invite');
  });

  it('spec covers /api/security endpoints', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    assert.ok(content.includes('/api/security/breach-check/{prefix}:'), 'should document breach check');
    assert.ok(content.includes('/api/security/reused-passwords:'), 'should document reused passwords');
  });

  it('health response matches spec schema', async () => {
    const res = await request(app).get('/api/health').expect(200);
    assert.equal(typeof res.body.status, 'string');
    assert.equal(typeof res.body.uptime, 'number');
  });

  it('register response returns 201', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: `openapi-test-${Date.now()}@test.com`,
        password: 'TestPass123!',
        master_password: 'MasterPass123!',
        display_name: 'OpenAPI Test',
      });
    assert.equal(res.status, 201);
  });

  it('metrics response matches text/plain content type', async () => {
    const res = await request(app).get('/api/metrics').expect(200);
    assert.ok(res.headers['content-type'].includes('text/plain'));
  });
});
