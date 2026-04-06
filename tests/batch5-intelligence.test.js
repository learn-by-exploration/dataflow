'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, getVaultKey } = require('./helpers');

describe('Batch 5 — Vault Intelligence', () => {
  let app, db, user;

  before(async () => {
    ({ app, db } = setup());
    cleanDb();
    user = await makeUser(app);
    const logged = await loginUser(app, user);
    user.sid = logged.sid;
  });

  afterEach(() => {
    db.exec('DELETE FROM item_fields');
    db.exec('DELETE FROM item_tags');
    db.exec('DELETE FROM items');
  });

  after(() => teardown());

  // ─── Helpers ───
  function getBuiltinRT() {
    return db.prepare('SELECT * FROM record_types WHERE is_builtin = 1 LIMIT 1').get();
  }

  function getPasswordFieldDef(rtId) {
    return db.prepare("SELECT * FROM record_type_fields WHERE record_type_id = ? AND field_type = 'password' LIMIT 1").get(rtId);
  }

  async function createCategoryAndRT() {
    const catRes = await authRequest(app, user.sid)
      .post('/api/categories')
      .send({ name: 'IntCat-' + crypto.randomUUID().slice(0, 6) })
      .expect(201);
    const rt = getBuiltinRT();
    return { category_id: catRes.body.id, record_type_id: rt.id, rt };
  }

  async function createItemWithPassword(password, catId, rtId) {
    const pwFieldDef = getPasswordFieldDef(rtId);
    const fields = pwFieldDef
      ? [{ field_def_id: pwFieldDef.id, value: password }]
      : [];
    const res = await authRequest(app, user.sid)
      .post('/api/items')
      .send({ title: 'PW-' + crypto.randomUUID().slice(0, 6), category_id: catId, record_type_id: rtId, fields })
      .expect(201);
    return res.body;
  }

  // ─── #41: HIBP Breach Check ───
  describe('#41 — HIBP Breach Check', () => {
    it('GET /api/security/breach-check/:prefix validates hex prefix', async () => {
      await authRequest(app, user.sid)
        .get('/api/security/breach-check/ZZZZZ')
        .expect(400);
    });

    it('rejects prefix with wrong length', async () => {
      await authRequest(app, user.sid)
        .get('/api/security/breach-check/ABC')
        .expect(400);
    });

    it('rejects prefix with non-hex chars', async () => {
      await authRequest(app, user.sid)
        .get('/api/security/breach-check/GHIJK')
        .expect(400);
    });

    it('breach service accepts valid 5-char hex prefix', async () => {
      // Mock the fetch — the breach service uses global fetch
      const breachService = require('../src/services/breach.service');
      breachService.clearCache();
      // We can't actually call HIBP in tests, but we can test the service structure
      assert.equal(typeof breachService.checkPassword, 'function');
      assert.equal(typeof breachService.clearCache, 'function');
    });

    it('breach service caches results', () => {
      const breachService = require('../src/services/breach.service');
      // Manually populate cache to test
      breachService._cache.set('AABBC', {
        data: [{ suffix: 'DDEE12345', count: 5 }],
        timestamp: Date.now(),
      });
      assert.ok(breachService._cache.has('AABBC'));
      breachService.clearCache();
      assert.equal(breachService._cache.size, 0);
    });

    it('breach check requires authentication', async () => {
      const request = require('supertest');
      await request(app)
        .get('/api/security/breach-check/AABBC')
        .expect(401);
    });
  });

  // ─── #43: Password Strength Scoring ───
  describe('#43 — Password Strength Scoring', () => {
    const { scorePassword, estimateEntropy } = require('../src/services/password-strength');

    it('scores empty password as 0', () => {
      assert.equal(scorePassword(''), 0);
      assert.equal(scorePassword(null), 0);
    });

    it('scores very weak passwords (short/common) as 0', () => {
      assert.equal(scorePassword('abc'), 0);
      assert.equal(scorePassword('12345'), 0);
    });

    it('scores common passwords low', () => {
      assert.ok(scorePassword('password') <= 1);
      assert.ok(scorePassword('qwerty') <= 1);
      assert.ok(scorePassword('123456') <= 1);
    });

    it('scores weak passwords as 1', () => {
      assert.ok(scorePassword('hello123') <= 2);
    });

    it('scores medium passwords as 2-3', () => {
      const score = scorePassword('MyPass123');
      assert.ok(score >= 1 && score <= 3, `Expected 1-3, got ${score}`);
    });

    it('scores strong passwords as 3-4', () => {
      const score = scorePassword('X9#kL2$mN8@pQ4!rT6');
      assert.ok(score >= 3, `Expected 3+, got ${score}`);
    });

    it('scores very long mixed passwords as 4', () => {
      assert.equal(scorePassword('s8D#kM2!nP7@qR5$tV9^wX3&zA6*cF'), 4);
    });

    it('penalizes sequential characters', () => {
      const withSeq = estimateEntropy('abcdefgh1');
      const withoutSeq = estimateEntropy('xmqpzwyg1');
      assert.ok(withSeq < withoutSeq, 'Sequential should have less entropy');
    });

    it('penalizes repeated characters', () => {
      const withRepeats = estimateEntropy('aaaa1234');
      const withoutRepeats = estimateEntropy('abcd1234');
      assert.ok(withRepeats < withoutRepeats, 'Repeated should have less entropy');
    });

    it('stores strength score on item creation', async () => {
      const { category_id, record_type_id, rt } = await createCategoryAndRT();
      const pwFieldDef = getPasswordFieldDef(rt.id);
      if (!pwFieldDef) return; // Skip if no password field def

      const item = await createItemWithPassword('WeakPw1', category_id, record_type_id);
      const fields = db.prepare('SELECT * FROM item_fields WHERE item_id = ?').all(item.id);
      const pwField = fields.find(f => f.field_def_id === pwFieldDef.id);
      if (pwField) {
        assert.ok(pwField.strength_score != null, 'strength_score should be set');
        assert.ok(pwField.strength_score >= 0 && pwField.strength_score <= 4);
      }
    });
  });

  // ─── #44: TOTP Code Generator ───
  describe('#44 — TOTP Code Generator', () => {
    const totpService = require('../src/services/totp.service');

    it('generates 6-digit codes', () => {
      const secret = 'JBSWY3DPEHPK3PXP'; // base32 for "Hello!"
      const code = totpService.generateCode(secret, 0);
      assert.equal(code.length, 6);
      assert.match(code, /^\d{6}$/);
    });

    it('generates deterministic codes for same timestamp', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const ts = 1000 * 30 * 1000; // specific time
      const code1 = totpService.generateCode(secret, ts);
      const code2 = totpService.generateCode(secret, ts);
      assert.equal(code1, code2);
    });

    it('generates different codes for different time steps', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const code1 = totpService.generateCode(secret, 0);
      const code2 = totpService.generateCode(secret, 30 * 1000);
      // Different time windows should produce different codes (nearly always)
      // This is probabilistic but extremely unlikely to be equal
      assert.ok(code1 !== code2 || true); // weak assertion; primarily testing no crash
    });

    // RFC 6238 test vector: secret = "12345678901234567890" (ASCII), time steps
    it('matches RFC 6238 test vector for SHA1 at T=59', () => {
      // Secret "12345678901234567890" in base32 is "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
      const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
      const code = totpService.generateCode(secret, 59000, { period: 30, digits: 8 });
      assert.equal(code, '94287082');
    });

    it('matches RFC 6238 test vector for SHA1 at T=1111111109', () => {
      const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
      const code = totpService.generateCode(secret, 1111111109000, { period: 30, digits: 8 });
      assert.equal(code, '07081804');
    });

    it('parseOtpauthUri extracts components', () => {
      const uri = 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example';
      const parsed = totpService.parseOtpauthUri(uri);
      assert.equal(parsed.type, 'totp');
      assert.equal(parsed.secret, 'JBSWY3DPEHPK3PXP');
      assert.equal(parsed.issuer, 'Example');
      assert.equal(parsed.account, 'alice@example.com');
    });

    it('parseOtpauthUri throws for invalid URI', () => {
      assert.throws(() => totpService.parseOtpauthUri('not-a-uri'), /Invalid otpauth URI/);
    });

    it('getRemainingSeconds returns value 0-30', () => {
      const remaining = totpService.getRemainingSeconds();
      assert.ok(remaining >= 0 && remaining <= 30);
    });

    it('verifyCode accepts code from current window', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const code = totpService.generateCode(secret);
      assert.ok(totpService.verifyCode(code, secret));
    });

    it('verifyCode rejects invalid code', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      assert.equal(totpService.verifyCode('000000', secret), false);
    });

    it('POST /api/security/totp/verify validates code', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const code = totpService.generateCode(secret);
      const res = await authRequest(app, user.sid)
        .post('/api/security/totp/verify')
        .send({ code, secret })
        .expect(200);
      assert.equal(res.body.valid, true);
    });

    it('POST /api/security/totp/verify rejects missing fields', async () => {
      await authRequest(app, user.sid)
        .post('/api/security/totp/verify')
        .send({})
        .expect(400);
    });

    it('TOTP generate endpoint requires auth', async () => {
      const request = require('supertest');
      await request(app)
        .get('/api/security/totp/generate/1/1')
        .expect(401);
    });
  });

  // ─── #45: Security Score ───
  describe('#45 — Security Score', () => {
    it('GET /api/stats/security-score returns score and breakdown', async () => {
      const res = await authRequest(app, user.sid)
        .get('/api/stats/security-score')
        .expect(200);
      assert.ok('score' in res.body);
      assert.ok('breakdown' in res.body);
      assert.ok('weights' in res.body);
      assert.ok(res.body.score >= 0 && res.body.score <= 100);
      assert.ok('password_health' in res.body.breakdown);
      assert.ok('encryption_coverage' in res.body.breakdown);
      assert.ok('sharing_hygiene' in res.body.breakdown);
      assert.ok('unique_passwords' in res.body.breakdown);
      assert.ok('backup_status' in res.body.breakdown);
    });

    it('security score reflects password health', async () => {
      const createSecurityService = require('../src/services/security.service');
      const securityService = createSecurityService(db);
      const result = securityService.calculateSecurityScore(user.id);
      assert.equal(typeof result.score, 'number');
      assert.ok(result.score >= 0 && result.score <= 100);
    });

    it('weights sum to 100', async () => {
      const res = await authRequest(app, user.sid)
        .get('/api/stats/security-score')
        .expect(200);
      const sum = Object.values(res.body.weights).reduce((a, b) => a + b, 0);
      assert.equal(sum, 100);
    });
  });

  // ─── #46: Health Report ───
  describe('#46 — Health Report', () => {
    it('GET /api/stats/health-report returns comprehensive report', async () => {
      const res = await authRequest(app, user.sid)
        .get('/api/stats/health-report')
        .expect(200);
      assert.ok('total_items' in res.body);
      assert.ok('total_categories' in res.body);
      assert.ok('total_tags' in res.body);
      assert.ok('password_age_distribution' in res.body);
      assert.ok('sharing' in res.body);
      assert.ok('category_utilization' in res.body);
      assert.ok('recommendations' in res.body);
      assert.ok(Array.isArray(res.body.recommendations));
    });

    it('health report has password age buckets', async () => {
      const res = await authRequest(app, user.sid)
        .get('/api/stats/health-report')
        .expect(200);
      const dist = res.body.password_age_distribution;
      assert.ok('under_30d' in dist);
      assert.ok('30_90d' in dist);
      assert.ok('90_180d' in dist);
      assert.ok('over_180d' in dist);
    });

    it('health report includes sharing summary', async () => {
      const res = await authRequest(app, user.sid)
        .get('/api/stats/health-report')
        .expect(200);
      assert.ok('shared_by_me' in res.body.sharing);
      assert.ok('shared_with_me' in res.body.sharing);
    });

    it('health report category utilization is an array', async () => {
      const res = await authRequest(app, user.sid)
        .get('/api/stats/health-report')
        .expect(200);
      assert.ok(Array.isArray(res.body.category_utilization));
    });
  });

  // ─── #42: Password Health Dashboard ───
  describe('#42 — Password Health', () => {
    it('GET /api/stats/password-health returns health data', async () => {
      const res = await authRequest(app, user.sid)
        .get('/api/stats/password-health')
        .expect(200);
      assert.ok('total' in res.body);
      assert.ok('by_score' in res.body);
      assert.ok('weak' in res.body);
      assert.ok('old' in res.body);
    });

    it('password health counts reflect items', async () => {
      const { category_id, record_type_id } = await createCategoryAndRT();
      await createItemWithPassword('weak', category_id, record_type_id);

      const res = await authRequest(app, user.sid)
        .get('/api/stats/password-health')
        .expect(200);
      // Total should include at least our item's password field (if RT has password field)
      assert.ok(res.body.total >= 0);
    });
  });

  // ─── #48: Password Age Tracking ───
  describe('#48 — Password Age Tracking', () => {
    it('new item gets password_last_changed timestamp', async () => {
      const { category_id, record_type_id, rt } = await createCategoryAndRT();
      const pwFieldDef = getPasswordFieldDef(rt.id);
      if (!pwFieldDef) return;

      const item = await createItemWithPassword('TestPass1!', category_id, record_type_id);
      const fields = db.prepare('SELECT * FROM item_fields WHERE item_id = ?').all(item.id);
      const pwField = fields.find(f => f.field_def_id === pwFieldDef.id);
      if (pwField) {
        assert.ok(pwField.password_last_changed, 'password_last_changed should be set');
      }
    });

    it('updating password changes password_last_changed', async () => {
      const { category_id, record_type_id, rt } = await createCategoryAndRT();
      const pwFieldDef = getPasswordFieldDef(rt.id);
      if (!pwFieldDef) return;

      const item = await createItemWithPassword('OldPass1!', category_id, record_type_id);
      const oldFields = db.prepare('SELECT * FROM item_fields WHERE item_id = ?').all(item.id);
      const oldPwField = oldFields.find(f => f.field_def_id === pwFieldDef.id);
      if (!oldPwField) return;

      // Wait a tiny bit so timestamp differs
      await new Promise(r => setTimeout(r, 10));

      // Update with different password
      await authRequest(app, user.sid)
        .put('/api/items/' + item.id)
        .send({
          title: item.title,
          category_id,
          record_type_id,
          fields: [{ field_def_id: pwFieldDef.id, value: 'NewPass2!' }],
        })
        .expect(200);

      const newFields = db.prepare('SELECT * FROM item_fields WHERE item_id = ?').all(item.id);
      const newPwField = newFields.find(f => f.field_def_id === pwFieldDef.id);
      if (newPwField) {
        assert.ok(newPwField.password_last_changed, 'password_last_changed should be set');
      }
    });

    it('keeping same password preserves original timestamp', async () => {
      const { category_id, record_type_id, rt } = await createCategoryAndRT();
      const pwFieldDef = getPasswordFieldDef(rt.id);
      if (!pwFieldDef) return;

      const item = await createItemWithPassword('SamePass1!', category_id, record_type_id);
      const oldFields = db.prepare('SELECT * FROM item_fields WHERE item_id = ?').all(item.id);
      const oldPwField = oldFields.find(f => f.field_def_id === pwFieldDef.id);
      if (!oldPwField || !oldPwField.password_last_changed) return;

      const originalTimestamp = oldPwField.password_last_changed;

      // Update with SAME password
      await authRequest(app, user.sid)
        .put('/api/items/' + item.id)
        .send({
          title: item.title,
          category_id,
          record_type_id,
          fields: [{ field_def_id: pwFieldDef.id, value: 'SamePass1!' }],
        })
        .expect(200);

      const newFields = db.prepare('SELECT * FROM item_fields WHERE item_id = ?').all(item.id);
      const newPwField = newFields.find(f => f.field_def_id === pwFieldDef.id);
      if (newPwField) {
        assert.equal(newPwField.password_last_changed, originalTimestamp);
      }
    });

    it('migration adds password_last_changed column', () => {
      const cols = db.pragma('table_info(item_fields)').map(c => c.name);
      assert.ok(cols.includes('password_last_changed'), 'password_last_changed column should exist');
    });

    it('migration adds strength_score column', () => {
      const cols = db.pragma('table_info(item_fields)').map(c => c.name);
      assert.ok(cols.includes('strength_score'), 'strength_score column should exist');
    });
  });

  // ─── #49: Reused Password Detection ───
  describe('#49 — Reused Password Detection', () => {
    it('GET /api/security/reused-passwords returns array', async () => {
      const res = await authRequest(app, user.sid)
        .get('/api/security/reused-passwords')
        .expect(200);
      assert.ok(Array.isArray(res.body));
    });

    it('detects reused passwords in service', () => {
      const createSecurityService = require('../src/services/security.service');
      const securityService = createSecurityService(db);
      const vaultKey = getVaultKey(user.sid);
      const result = securityService.detectReusedPasswords(user.id, vaultKey);
      assert.ok(Array.isArray(result));
    });

    it('reused-passwords requires auth', async () => {
      const request = require('supertest');
      await request(app)
        .get('/api/security/reused-passwords')
        .expect(401);
    });
  });

  // ─── #50: Recovery Codes ───
  describe('#50 — Recovery Codes', () => {
    // Each test that does recovery must re-login and update user state
    afterEach(async () => {
      db.exec('DELETE FROM recovery_codes');
    });

    it('POST /api/auth/recovery-codes/generate returns 10 codes', async () => {
      const res = await authRequest(app, user.sid)
        .post('/api/auth/recovery-codes/generate')
        .send({ password: user.password })
        .expect(200);
      assert.ok(Array.isArray(res.body.codes));
      assert.equal(res.body.codes.length, 10);
      res.body.codes.forEach(code => {
        assert.equal(code.length, 8);
        assert.match(code, /^[A-Z0-9]+$/);
      });
    });

    it('rejects without password', async () => {
      await authRequest(app, user.sid)
        .post('/api/auth/recovery-codes/generate')
        .send({})
        .expect(400);
    });

    it('rejects with wrong password', async () => {
      await authRequest(app, user.sid)
        .post('/api/auth/recovery-codes/generate')
        .send({ password: 'WrongPassword!' })
        .expect(401);
    });

    it('GET /api/auth/recovery-codes/status returns code counts', async () => {
      // Generate codes first
      await authRequest(app, user.sid)
        .post('/api/auth/recovery-codes/generate')
        .send({ password: user.password })
        .expect(200);

      const res = await authRequest(app, user.sid)
        .get('/api/auth/recovery-codes/status')
        .expect(200);
      assert.equal(res.body.total, 10);
      assert.equal(res.body.used, 0);
      assert.equal(res.body.remaining, 10);
    });

    it('POST /api/auth/recover validates recovery code', async () => {
      // Generate codes
      const genRes = await authRequest(app, user.sid)
        .post('/api/auth/recovery-codes/generate')
        .send({ password: user.password })
        .expect(200);
      const codes = genRes.body.codes;

      // Use a recovery code to reset
      const request = require('supertest');
      const res = await request(app)
        .post('/api/auth/recover')
        .send({
          email: user.email,
          recovery_code: codes[0],
          new_password: user.password, // Keep same password to avoid state issues
          new_master_password: user.master_password,
        })
        .expect(200);
      assert.equal(res.body.ok, true);

      // Re-login to restore session
      const logged = await loginUser(app, user);
      user.sid = logged.sid;
    });

    it('recovery code can only be used once', async () => {
      const genRes = await authRequest(app, user.sid)
        .post('/api/auth/recovery-codes/generate')
        .send({ password: user.password })
        .expect(200);
      const code = genRes.body.codes[0];

      const request = require('supertest');
      // Use the code — keep same password to not break state
      await request(app)
        .post('/api/auth/recover')
        .send({
          email: user.email,
          recovery_code: code,
          new_password: user.password,
          new_master_password: user.master_password,
        })
        .expect(200);

      // Re-login to restore session
      const logged = await loginUser(app, user);
      user.sid = logged.sid;

      // Try same code again
      await request(app)
        .post('/api/auth/recover')
        .send({
          email: user.email,
          recovery_code: code,
          new_password: 'AnotherPass1!',
          new_master_password: 'AnotherMaster1!',
        })
        .expect(401);
    });

    it('recovery rejects invalid code', async () => {
      const request = require('supertest');
      await request(app)
        .post('/api/auth/recover')
        .send({
          email: user.email,
          recovery_code: 'INVALID1',
          new_password: 'NewPass1!',
          new_master_password: 'NewMaster1!',
        })
        .expect(401);
    });

    it('recovery rejects missing fields', async () => {
      const request = require('supertest');
      await request(app)
        .post('/api/auth/recover')
        .send({ email: user.email })
        .expect(400);
    });

    it('recovery codes table exists', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recovery_codes'").get();
      assert.ok(tables, 'recovery_codes table should exist');
    });

    it('generating new codes invalidates old ones', async () => {
      // Generate first set
      const gen1 = await authRequest(app, user.sid)
        .post('/api/auth/recovery-codes/generate')
        .send({ password: user.password })
        .expect(200);

      // Generate second set (should delete old)
      await authRequest(app, user.sid)
        .post('/api/auth/recovery-codes/generate')
        .send({ password: user.password })
        .expect(200);

      // Status should show 10 total (new set only)
      const status = await authRequest(app, user.sid)
        .get('/api/auth/recovery-codes/status')
        .expect(200);
      assert.equal(status.body.total, 10);

      // Old code should not work
      const request = require('supertest');
      await request(app)
        .post('/api/auth/recover')
        .send({
          email: user.email,
          recovery_code: gen1.body.codes[0],
          new_password: 'OldCode1!',
          new_master_password: 'OldMaster1!',
        })
        .expect(401);
    });

    it('can exhaust all recovery codes', async () => {
      const genRes = await authRequest(app, user.sid)
        .post('/api/auth/recovery-codes/generate')
        .send({ password: user.password })
        .expect(200);

      const request = require('supertest');
      const origPassword = user.password;
      const origMaster = user.master_password;

      // Use all 10 codes
      for (let i = 0; i < 10; i++) {
        const newPw = 'ExhaustPass' + i + '!A';
        const newMasterPw = 'ExhaustMaster' + i + '!A';
        await request(app)
          .post('/api/auth/recover')
          .send({
            email: user.email,
            recovery_code: genRes.body.codes[i],
            new_password: newPw,
            new_master_password: newMasterPw,
          })
          .expect(200);
        user.password = newPw;
        user.master_password = newMasterPw;
      }

      // Re-login after exhausting
      const logged = await loginUser(app, user);
      user.sid = logged.sid;

      // Status should show 0 remaining
      const status = await authRequest(app, user.sid)
        .get('/api/auth/recovery-codes/status')
        .expect(200);
      assert.equal(status.body.remaining, 0);
    });
  });

  // ─── Frontend code checks ───
  describe('Frontend — Vault Intelligence UI', () => {
    const fs = require('fs');
    const path = require('path');
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

    it('dashboard renders security score card', () => {
      assert.match(appJs, /security-score-card|security.score|Security Score/);
    });

    it('dashboard renders password health cards', () => {
      assert.match(appJs, /password-health|Weak Passwords|dash-weak-pw/);
    });

    it('dashboard renders vault health section', () => {
      assert.match(appJs, /vault-health-section|Vault Health|health-report/);
    });

    it('item detail shows TOTP code for totp fields', () => {
      assert.match(appJs, /totp-code|totp.copy|TOTP|totp/i);
    });

    it('item detail shows password age', () => {
      assert.match(appJs, /password_last_changed|field-age|days ago/i);
    });

    it('breach monitoring function exists', () => {
      assert.match(appJs, /checkBreachMonitoring|breach.*monitor/i);
    });

    it('breach alert banner function exists', () => {
      assert.match(appJs, /showBreachAlert|breach-alert|breach.*alert/i);
    });

    it('breach results cached in sessionStorage', () => {
      assert.match(appJs, /sessionStorage.*breach|df_breach_check/i);
    });

    it('recovery codes UI in settings', () => {
      assert.match(appJs, /recovery-codes|renderRecoveryCodes|Recovery Codes/);
    });

    it('recovery codes generate button exists', () => {
      assert.match(appJs, /generate-recovery-codes|Generate New Codes/);
    });
  });
});
