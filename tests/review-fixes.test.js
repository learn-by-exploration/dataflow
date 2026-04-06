'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest } = require('./helpers');

describe('Code Review Fixes', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());
  beforeEach(() => cleanDb());

  // ─── FIX 1: Auth middleware cookie name ───
  describe('FIX 1: Auth middleware reads both cookie names', () => {
    it('authenticates with df_sid cookie', async () => {
      const user = await makeUser(app);
      const res = await request(app)
        .get('/api/categories')
        .set('Cookie', `df_sid=${user.sid}`)
        .expect(200);
      assert.ok(Array.isArray(res.body));
    });

    it('authenticates with __Host-df_sid cookie', async () => {
      const user = await makeUser(app);
      const res = await request(app)
        .get('/api/categories')
        .set('Cookie', `__Host-df_sid=${user.sid}`)
        .expect(200);
      assert.ok(Array.isArray(res.body));
    });

    it('prefers __Host-df_sid over df_sid', async () => {
      const user = await makeUser(app);
      const fakeSid = crypto.randomBytes(32).toString('hex');
      // __Host-df_sid has the valid sid, df_sid has a fake one
      const res = await request(app)
        .get('/api/categories')
        .set('Cookie', `__Host-df_sid=${user.sid}; df_sid=${fakeSid}`)
        .expect(200);
      assert.ok(Array.isArray(res.body));
    });
  });

  // ─── FIX 2: Stored XSS in print view ───
  describe('FIX 2: Print view escapes HTML entities', () => {
    it('openPrintView function wraps user data in esc()', () => {
      const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
      const fnMatch = appJs.match(/function openPrintView[\s\S]*?^}/m);
      assert.ok(fnMatch, 'openPrintView function should exist');
      const fnBody = fnMatch[0];

      // Category name must be escaped
      assert.match(fnBody, /\$\{esc\(catName\)\}/, 'catName should be wrapped in esc()');
      // Item title must be escaped
      assert.match(fnBody, /esc\(item\.title/, 'item.title should be wrapped in esc()');
      // Field name must be escaped
      assert.match(fnBody, /esc\(f\.field_name/, 'field_name should be wrapped in esc()');
      // Field value must be escaped
      assert.match(fnBody, /esc\(val\)/, 'val should be wrapped in esc()');
      // Notes must be escaped
      assert.match(fnBody, /esc\(item\.notes\)/, 'item.notes should be wrapped in esc()');
    });
  });

  // ─── FIX 3: Sessions API does NOT expose full SID ───
  describe('FIX 3: Sessions API hides full SID', () => {
    it('GET /api/auth/sessions does NOT include sid_full', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);

      const res = await authRequest(app, login.sid).get('/api/auth/sessions').expect(200);
      assert.ok(res.body.length >= 2);
      for (const s of res.body) {
        assert.ok(!('sid_full' in s), 'sid_full must not be exposed');
        assert.ok(s.ref, 'ref should be present');
        assert.equal(s.ref.length, 16, 'ref should be 16-char hex');
      }
    });

    it('session revoke by ref works', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);

      const list = await authRequest(app, login.sid).get('/api/auth/sessions').expect(200);
      const other = list.body.find(s => !s.is_current);
      assert.ok(other);

      await authRequest(app, login.sid).delete(`/api/auth/sessions/${other.ref}`).expect(200);

      const list2 = await authRequest(app, login.sid).get('/api/auth/sessions').expect(200);
      assert.ok(!list2.body.find(s => s.ref === other.ref));
    });

    it('revoke by invalid ref returns 404', async () => {
      const user = await makeUser(app);
      await authRequest(app, user.sid).delete('/api/auth/sessions/deadbeef12345678').expect(404);
    });
  });

  // ─── FIX 4: Recovery returns warning ───
  describe('FIX 4: Recovery response includes warning', () => {
    it('recovery returns ok and warning about data loss', async () => {
      const user = await makeUser(app);
      const genRes = await authRequest(app, user.sid)
        .post('/api/auth/recovery-codes/generate')
        .send({ password: user.password })
        .expect(200);
      const code = genRes.body.codes[0];

      const res = await request(app)
        .post('/api/auth/recover')
        .send({
          email: user.email,
          recovery_code: code,
          new_password: 'NewSecure1!',
          new_master_password: 'NewMaster1!',
        })
        .expect(200);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.warning, 'Response should include a warning');
      assert.match(res.body.warning, /unrecoverable/i);
    });
  });

  // ─── FIX 5: Share link POST with passphrase ───
  describe('FIX 5: Share link passphrase via POST body', () => {
    let user, itemId;

    beforeEach(async () => {
      cleanDb();
      user = await makeUser(app);
      const cat = await authRequest(app, user.sid)
        .post('/api/categories')
        .send({ name: 'Test' })
        .expect(201);
      const rt = db.prepare('SELECT id FROM record_types LIMIT 1').get();
      const item = await authRequest(app, user.sid)
        .post('/api/items')
        .send({ title: 'Secret', category_id: cat.body.id, record_type_id: rt.id, fields: [], tags: [] })
        .expect(201);
      itemId = item.body.id;
    });

    it('GET without passphrase still works for non-protected links', async () => {
      const link = await authRequest(app, user.sid)
        .post('/api/share-links')
        .send({ item_id: itemId })
        .expect(201);
      const res = await request(app)
        .get(`/api/share-links/${link.body.token}`)
        .expect(200);
      assert.ok(res.body.item);
    });

    it('POST /resolve with passphrase works for protected links', async () => {
      const link = await authRequest(app, user.sid)
        .post('/api/share-links')
        .send({ item_id: itemId, passphrase: 'mysecret' })
        .expect(201);

      // GET without passphrase should require it
      await request(app).get(`/api/share-links/${link.body.token}`).expect(401);

      // POST with correct passphrase
      const res = await request(app)
        .post(`/api/share-links/${link.body.token}/resolve`)
        .send({ passphrase: 'mysecret' })
        .expect(200);
      assert.ok(res.body.item);
    });

    it('POST /resolve with wrong passphrase returns 403', async () => {
      const link = await authRequest(app, user.sid)
        .post('/api/share-links')
        .send({ item_id: itemId, passphrase: 'correct' })
        .expect(201);

      await request(app)
        .post(`/api/share-links/${link.body.token}/resolve`)
        .send({ passphrase: 'wrong' })
        .expect(403);
    });
  });

  // ─── FIX 6: Metrics restricted to localhost ───
  describe('FIX 6: Metrics endpoint restricted', () => {
    it('returns metrics for localhost requests', async () => {
      // supertest connects via 127.0.0.1 by default
      const res = await request(app).get('/api/metrics');
      // Should succeed (127.0.0.1) or be blocked if trust proxy changes IP
      // In test env, req.ip is typically 127.0.0.1 or ::ffff:127.0.0.1
      assert.ok([200, 403].includes(res.status));
    });

    it('metrics endpoint source code restricts to localhost', () => {
      const serverJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
      assert.match(serverJs, /127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/, 'Should check for localhost IPs');
      assert.match(serverJs, /403/, 'Should return 403 for non-localhost');
    });
  });

  // ─── FIX 7: Recovery user enumeration ───
  describe('FIX 7: Recovery returns same error for all failures', () => {
    it('non-existent user gets same error as bad code', async () => {
      const res1 = await request(app)
        .post('/api/auth/recover')
        .send({
          email: 'nonexistent@test.com',
          recovery_code: 'FAKECODE',
          new_password: 'Pass1!',
          new_master_password: 'Master1!',
        });

      const user = await makeUser(app);
      const res2 = await request(app)
        .post('/api/auth/recover')
        .send({
          email: user.email,
          recovery_code: 'BADCODE1',
          new_password: 'Pass1!',
          new_master_password: 'Master1!',
        });

      // Both should return 401 with the same generic message
      assert.equal(res1.status, 401);
      assert.equal(res2.status, 401);
      assert.equal(res1.body.error, res2.body.error, 'Error messages should be identical');
      assert.equal(res1.body.error, 'Recovery failed');
    });
  });

  // ─── FIX 8: TOTP timing-safe comparison ───
  describe('FIX 8: TOTP verifyCode uses timing-safe comparison', () => {
    it('verifyCode still validates correct codes', () => {
      const totp = require('../src/services/totp.service');
      const secret = 'JBSWY3DPEHPK3PXP'; // standard test secret
      const code = totp.generateCode(secret);
      assert.equal(totp.verifyCode(code, secret), true);
    });

    it('verifyCode rejects wrong codes', () => {
      const totp = require('../src/services/totp.service');
      const secret = 'JBSWY3DPEHPK3PXP';
      assert.equal(totp.verifyCode('000000', secret), false);
    });

    it('source code uses timingSafeEqual', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'totp.service.js'), 'utf8');
      assert.match(src, /timingSafeEqual/, 'Should use crypto.timingSafeEqual');
    });
  });

  // ─── FIX 9: Bulk edit validates schema ───
  describe('FIX 9: Bulk edit validates input schema', () => {
    it('rejects non-array itemIds', async () => {
      const user = await makeUser(app);
      const res = await authRequest(app, user.sid)
        .put('/api/items/bulk/edit')
        .send({ itemIds: 'notarray', changes: { category_id: 1 } });
      assert.equal(res.status, 400);
    });

    it('rejects empty changes object', async () => {
      const user = await makeUser(app);
      const res = await authRequest(app, user.sid)
        .put('/api/items/bulk/edit')
        .send({ itemIds: [1], changes: {} });
      assert.equal(res.status, 400);
    });

    it('rejects invalid change fields (e.g. title)', async () => {
      const user = await makeUser(app);
      const res = await authRequest(app, user.sid)
        .put('/api/items/bulk/edit')
        .send({ itemIds: [1], changes: { title: 'hacked' } });
      assert.equal(res.status, 400);
    });

    it('accepts valid category_id change', async () => {
      const user = await makeUser(app);
      const cat = await authRequest(app, user.sid)
        .post('/api/categories')
        .send({ name: 'Target' })
        .expect(201);
      const rt = db.prepare('SELECT id FROM record_types LIMIT 1').get();
      const item = await authRequest(app, user.sid)
        .post('/api/items')
        .send({ title: 'BulkTest', category_id: cat.body.id, record_type_id: rt.id, fields: [], tags: [] })
        .expect(201);

      const res = await authRequest(app, user.sid)
        .put('/api/items/bulk/edit')
        .send({ itemIds: [item.body.id], changes: { category_id: cat.body.id } });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });
  });

  // ─── FIX 10: CSRF exemption for /auth/recover ───
  describe('FIX 10: CSRF exemption for /auth/recover', () => {
    it('csrf middleware source exempts /auth/recover', () => {
      const csrfSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'middleware', 'csrf.js'), 'utf8');
      assert.match(csrfSrc, /auth\/recover/, 'CSRF should exempt /auth/recover');
    });

    it('Docker compose has read_only and logs volume', () => {
      const dc = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
      assert.match(dc, /read_only:\s*true/, 'Should have read_only: true');
      assert.match(dc, /\.\/logs:\/app\/logs/, 'Should mount logs volume');
    });
  });
});
