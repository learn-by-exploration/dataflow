'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, makeInvitedUser } = require('./helpers');

describe('Batch 2 — Security Hardening', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());
  beforeEach(() => cleanDb());

  // ═══════════════════════════════════════════════════════════════
  // #11: Session Management API
  // ═══════════════════════════════════════════════════════════════
  describe('#11 — Session Management API', () => {
    it('GET /api/auth/sessions lists active sessions', async () => {
      const user = await makeUser(app);
      const res = await authRequest(app, user.sid).get('/api/auth/sessions').expect(200);

      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length >= 1);
      const current = res.body.find(s => s.is_current === true);
      assert.ok(current, 'Should include current session');
      assert.ok(current.created_at);
      assert.ok(current.expires_at);
    });

    it('GET /api/auth/sessions shows multiple sessions after re-login', async () => {
      const user = await makeUser(app);
      // Login again to create second session
      const login = await loginUser(app, user);

      const res = await authRequest(app, login.sid).get('/api/auth/sessions').expect(200);
      assert.ok(res.body.length >= 2, 'Should show at least 2 sessions');
    });

    it('DELETE /api/auth/sessions/:ref revokes a specific session', async () => {
      const user = await makeUser(app);
      const login = await loginUser(app, user);

      // List sessions from login session
      const list = await authRequest(app, login.sid).get('/api/auth/sessions').expect(200);
      const other = list.body.find(s => !s.is_current);
      assert.ok(other, 'Should have a non-current session');
      assert.ok(other.ref, 'Should have a ref field');
      assert.ok(!other.sid_full, 'Should NOT have sid_full');

      // Revoke the register session by ref
      await authRequest(app, login.sid).delete(`/api/auth/sessions/${other.ref}`).expect(200);

      // Verify revoked session is gone
      const list2 = await authRequest(app, login.sid).get('/api/auth/sessions').expect(200);
      const gone = list2.body.find(s => s.ref === other.ref);
      assert.ok(!gone, 'Revoked session should be removed');
    });

    it('DELETE /api/auth/sessions/:ref cannot revoke current session', async () => {
      const user = await makeUser(app);
      const list = await authRequest(app, user.sid).get('/api/auth/sessions').expect(200);
      const current = list.body.find(s => s.is_current);
      const res = await authRequest(app, user.sid).delete(`/api/auth/sessions/${current.ref}`).expect(400);
      assert.match(res.body.error, /current/i);
    });

    it('DELETE /api/auth/sessions revokes all sessions except current', async () => {
      const user = await makeUser(app);
      // Create extra sessions
      await loginUser(app, user);
      await loginUser(app, user);

      const res = await authRequest(app, user.sid).delete('/api/auth/sessions').expect(200);
      assert.ok(res.body.ok);
      assert.ok(res.body.revoked >= 2);

      // Verify only current session remains
      const list = await authRequest(app, user.sid).get('/api/auth/sessions').expect(200);
      assert.equal(list.body.length, 1);
      assert.equal(list.body[0].is_current, true);
    });

    it('requires auth for session management endpoints', async () => {
      await request(app).get('/api/auth/sessions').expect(401);
      await request(app).delete('/api/auth/sessions').expect(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // #12: Session Management UI
  // ═══════════════════════════════════════════════════════════════
  describe('#12 — Session Management UI', () => {
    it('app.js contains sessions UI container', () => {
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
      assert.match(js, /active-sessions-section/);
      assert.match(js, /sessions-list/);
      assert.match(js, /revoke-all-sessions/);
      assert.match(js, /revoke-session-btn/);
    });

    it('app.js has valid syntax', () => {
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
      const stripped = js
        .replace(/^\s*import\s+.*$/gm, '// import removed')
        .replace(/^\s*export\s+/gm, '// export ');
      assert.doesNotThrow(() => new vm.Script(stripped), 'app.js has syntax errors');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // #13: Password Change UI
  // ═══════════════════════════════════════════════════════════════
  describe('#13 — Password Change UI', () => {
    it('app.js contains change password form elements', () => {
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
      assert.match(js, /change-password-section/);
      assert.match(js, /sec-current-pw/);
      assert.match(js, /sec-new-pw/);
      assert.match(js, /sec-confirm-pw/);
      assert.match(js, /sec-current-master/);
      assert.match(js, /sec-new-master/);
      assert.match(js, /pw-strength/);
    });

    it('app.js has password strength indicator logic', () => {
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
      assert.match(js, /Very weak|Weak|Fair|Good|Strong/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // #14: Progressive Account Lockout
  // ═══════════════════════════════════════════════════════════════
  describe('#14 — Progressive Account Lockout', () => {
    async function failLogin(email, n) {
      for (let i = 0; i < n; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ email, password: 'wrong', master_password: 'wrong' });
      }
    }

    it('5 failed attempts → 5 min lockout', async () => {
      const user = await makeUser(app);
      await failLogin(user.email, 5);

      const attempt = db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(user.email);
      assert.ok(attempt.locked_until, 'Should be locked');
      assert.equal(attempt.attempts, 5);

      // The locked_until should be approximately 5 minutes from now
      const lockTime = new Date(attempt.locked_until);
      const diff = lockTime.getTime() - Date.now();
      // Between 4 and 6 minutes
      assert.ok(diff > 4 * 60 * 1000 && diff < 6 * 60 * 1000,
        `Lockout should be ~5 min, got ${Math.round(diff / 60000)} min`);
    });

    it('10 failed attempts → 15 min lockout', async () => {
      const user = await makeUser(app);
      // Simulate 9 failed attempts with no lock yet
      const now = new Date().toISOString();
      db.prepare('INSERT INTO login_attempts (email, attempts, first_attempt_at) VALUES (?, 9, ?)').run(user.email, now);

      // 10th attempt triggers 15-min lockout
      await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'wrong', master_password: 'wrong' });

      const attempt = db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(user.email);
      assert.ok(attempt.locked_until, 'Should be locked');
      assert.equal(attempt.attempts, 10);

      const lockTime = new Date(attempt.locked_until);
      const diff = lockTime.getTime() - Date.now();
      assert.ok(diff > 14 * 60 * 1000 && diff < 16 * 60 * 1000,
        `Lockout should be ~15 min, got ${Math.round(diff / 60000)} min`);
    });

    it('15 failed attempts → 60 min lockout', async () => {
      const user = await makeUser(app);
      // Simulate 14 failed attempts with no lock
      const now = new Date().toISOString();
      db.prepare('INSERT INTO login_attempts (email, attempts, first_attempt_at) VALUES (?, 14, ?)').run(user.email, now);

      // 15th attempt triggers 60-min lockout
      await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'wrong', master_password: 'wrong' });

      const attempt = db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(user.email);
      assert.ok(attempt.locked_until, 'Should be locked');
      assert.equal(attempt.attempts, 15);

      const lockTime = new Date(attempt.locked_until);
      const diff = lockTime.getTime() - Date.now();
      assert.ok(diff > 59 * 60 * 1000 && diff < 61 * 60 * 1000,
        `Lockout should be ~60 min, got ${Math.round(diff / 60000)} min`);
    });

    it('logs lockout events to audit log', async () => {
      const user = await makeUser(app);
      db.exec('DELETE FROM audit_log');
      await failLogin(user.email, 5);

      const logs = db.prepare("SELECT * FROM audit_log WHERE action = 'account_lockout'").all();
      assert.ok(logs.length >= 1, 'Should log lockout event');
      const detail = JSON.parse(logs[0].detail);
      assert.equal(detail.email, user.email);
      assert.equal(detail.attempts, 5);
      assert.equal(detail.lockout_minutes, 5);
    });

    it('admin can unlock a locked account', async () => {
      const admin = await makeUser(app);
      const member = await makeInvitedUser(app, admin.sid);

      // Lock member account
      await failLogin(member.email, 5);

      // Confirm locked
      const res1 = await request(app)
        .post('/api/auth/login')
        .send({ email: member.email, password: member.password, master_password: member.master_password });
      assert.equal(res1.status, 401);
      assert.match(res1.body.error, /locked/i);

      // Admin unlocks
      await authRequest(app, admin.sid).post(`/api/members/${member.id}/unlock`).expect(200);

      // Login should work now
      const res2 = await request(app)
        .post('/api/auth/login')
        .send({ email: member.email, password: member.password, master_password: member.master_password })
        .expect(200);
      assert.ok(res2.body.id);
    });

    it('non-admin cannot unlock accounts', async () => {
      const admin = await makeUser(app);
      const member = await makeInvitedUser(app, admin.sid);

      await authRequest(app, member.sid).post(`/api/members/${member.id}/unlock`).expect(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // #15: Security Headers Tightening
  // ═══════════════════════════════════════════════════════════════
  describe('#15 — Security Headers', () => {
    it('sets Permissions-Policy header', async () => {
      const res = await request(app).get('/api/health');
      const pp = res.headers['permissions-policy'];
      assert.ok(pp, 'Permissions-Policy header should be present');
      assert.match(pp, /camera=\(\)/);
      assert.match(pp, /microphone=\(\)/);
      assert.match(pp, /geolocation=\(\)/);
    });

    it('sets Cross-Origin-Opener-Policy header', async () => {
      const res = await request(app).get('/api/health');
      assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
    });

    it('still has Content-Security-Policy', async () => {
      const res = await request(app).get('/api/health');
      const csp = res.headers['content-security-policy'];
      assert.ok(csp, 'CSP header should be present');
      assert.match(csp, /default-src/);
      assert.match(csp, /'self'/);
    });

    it('CSP includes report-uri', async () => {
      const res = await request(app).get('/api/health');
      const csp = res.headers['content-security-policy'];
      assert.match(csp, /report-uri\s+\/api\/csp-report/);
    });

    it('has Referrer-Policy', async () => {
      const res = await request(app).get('/api/health');
      assert.equal(res.headers['referrer-policy'], 'same-origin');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // #16: Per-route Rate Limiting
  // ═══════════════════════════════════════════════════════════════
  describe('#16 — Per-route Rate Limiting', () => {
    it('rate limiters are defined in server.js', () => {
      const serverJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
      assert.match(serverJs, /writeLimiter/);
      assert.match(serverJs, /readLimiter/);
      assert.match(serverJs, /max:\s*60/);
      assert.match(serverJs, /max:\s*120/);
    });

    it('per-route limiting middleware is applied', () => {
      const serverJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
      assert.match(serverJs, /POST.*PUT.*PATCH.*DELETE/);
      assert.match(serverJs, /writeLimiter/);
      assert.match(serverJs, /readLimiter/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // #17: Input Sanitization
  // ═══════════════════════════════════════════════════════════════
  describe('#17 — Input Sanitization', () => {
    it('rejects null bytes in email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test' + '\0' + '@example.com',
          password: 'TestPass123!',
          display_name: 'Test',
          master_password: 'MasterPass123!',
        });
      assert.equal(res.status, 400);
    });

    it('rejects null bytes in password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'TestPass' + '\0' + '123!',
          display_name: 'Test',
          master_password: 'MasterPass123!',
        });
      assert.equal(res.status, 400);
    });

    it('rejects null bytes in display_name', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'TestPass123!',
          display_name: 'Test' + '\0' + 'Name',
          master_password: 'MasterPass123!',
        });
      assert.equal(res.status, 400);
    });

    it('rejects overly nested JSON body', async () => {
      // Build a deeply nested object (depth > 6)
      let obj = { a: 'value' };
      for (let i = 0; i < 8; i++) {
        obj = { nested: obj };
      }

      const user = await makeUser(app);
      const res = await authRequest(app, user.sid)
        .post('/api/items')
        .send(obj);
      assert.equal(res.status, 400);
      assert.match(res.body.error, /nested/i);
    });

    it('accepts normally nested JSON body', async () => {
      // Normal depth object (3 levels) should be fine
      const user = await makeUser(app);
      // This won't create an item (missing fields), but should not be rejected for nesting
      const res = await authRequest(app, user.sid)
        .post('/api/items')
        .send({ title: 'test', notes: '', fields: [{ value: 'v' }] });
      // Should not be 400 for nesting (may be 400 for validation but not nesting)
      if (res.status === 400) {
        assert.doesNotMatch(res.body.error || '', /nested/i);
      }
    });

    it('normalizes email via NFC transform in schema', () => {
      // Verify the auth schema applies NFC normalization
      const { registerSchema } = require('../src/schemas/auth.schema');
      // Use a standard ASCII email — the transform should apply NFC
      // The NFC normalization is mostly relevant for display_name, but we test it works on the email pipeline
      const email = 'test-user@example.com';
      const result = registerSchema.safeParse({
        email,
        password: 'TestPass123!',
        display_name: 'Test',
        master_password: 'MasterPass123!',
      });
      assert.ok(result.success, 'Should parse successfully');
      assert.equal(result.data.email, email.normalize('NFC'));

      // Verify that NFC normalization transform is configured in schema
      const schemaJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'schemas', 'auth.schema.js'), 'utf8');
      assert.match(schemaJs, /normalize.*NFC|NFC.*normalize/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // #18: Audit Log Retention
  // ═══════════════════════════════════════════════════════════════
  describe('#18 — Audit Log Retention', () => {
    it('config has auditRetentionDays with default 90', () => {
      const config = require('../src/config');
      assert.equal(typeof config.auditRetentionDays, 'number');
      assert.equal(config.auditRetentionDays, 90);
    });

    it('cleanOldAuditLogs removes entries older than threshold', () => {
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);

      // Insert an old audit log entry
      db.prepare(
        "INSERT INTO audit_log (user_id, action, resource, created_at) VALUES (NULL, 'test_old', 'test', datetime('now', '-100 days'))"
      ).run();
      // Insert a recent one
      db.prepare(
        "INSERT INTO audit_log (user_id, action, resource, created_at) VALUES (NULL, 'test_recent', 'test', datetime('now'))"
      ).run();

      const result = audit.cleanOldAuditLogs(90);
      assert.ok(result.deleted >= 1, 'Should delete old entries');

      // Recent entry should remain
      const remaining = db.prepare("SELECT * FROM audit_log WHERE action = 'test_recent'").all();
      assert.ok(remaining.length >= 1);

      // Old entry should be gone
      const old = db.prepare("SELECT * FROM audit_log WHERE action = 'test_old'").all();
      assert.equal(old.length, 0);
    });

    it('cleanOldAuditLogs does nothing when retention is 0', () => {
      const createAuditLogger = require('../src/services/audit');
      const audit = createAuditLogger(db);

      db.prepare(
        "INSERT INTO audit_log (user_id, action, resource, created_at) VALUES (NULL, 'keep_me', 'test', datetime('now', '-365 days'))"
      ).run();

      const result = audit.cleanOldAuditLogs(0);
      assert.equal(result.deleted, 0);

      const entry = db.prepare("SELECT * FROM audit_log WHERE action = 'keep_me'").get();
      assert.ok(entry, 'Old entry should remain when retention is disabled');
    });

    it('scheduler registers audit-retention job', () => {
      const schedulerJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'scheduler.js'), 'utf8');
      assert.match(schedulerJs, /audit-retention/);
      assert.match(schedulerJs, /auditRetentionDays/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // #19: Secure Cookie Enforcement
  // ═══════════════════════════════════════════════════════════════
  describe('#19 — Secure Cookie Enforcement', () => {
    it('uses df_sid cookie name in test mode', async () => {
      const user = await makeUser(app);
      assert.ok(user.sid, 'Should get a session ID');

      // Verify we can auth with df_sid
      const res = await authRequest(app, user.sid).get('/api/categories').expect(200);
      assert.ok(Array.isArray(res.body));
    });

    it('register sets df_sid cookie in test mode', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'cookie-test@example.com',
          password: 'TestPass123!',
          display_name: 'Cookie Test',
          master_password: 'MasterPass123!',
        })
        .expect(201);

      const cookies = res.headers['set-cookie'];
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      assert.match(cookieStr, /df_sid=/);
      assert.match(cookieStr, /HttpOnly/);
      assert.match(cookieStr, /SameSite=Strict/);
    });

    it('auth routes use __Host- prefix logic for prod', () => {
      const authJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.js'), 'utf8');
      assert.match(authJs, /__Host-df_sid/);
      assert.match(authJs, /isProd/);
      assert.match(authJs, /cookieName/);
    });

    it('cookie attributes are correct in test mode (no Secure flag)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'cookie-attr@example.com',
          password: 'TestPass123!',
          display_name: 'Cookie Attr',
          master_password: 'MasterPass123!',
        })
        .expect(201);

      const cookies = res.headers['set-cookie'];
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      // In test mode, no Secure flag
      assert.doesNotMatch(cookieStr, /;\s*Secure/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // #20: CSP Violation Reporting
  // ═══════════════════════════════════════════════════════════════
  describe('#20 — CSP Violation Reporting', () => {
    it('POST /api/csp-report accepts valid CSP reports', async () => {
      db.exec('DELETE FROM audit_log');

      const report = {
        'csp-report': {
          'document-uri': 'https://example.com',
          'blocked-uri': 'https://evil.com/script.js',
          'violated-directive': 'script-src',
          'original-policy': "default-src 'self'",
        },
      };

      await request(app)
        .post('/api/csp-report')
        .set('Content-Type', 'application/csp-report')
        .send(JSON.stringify(report))
        .expect(204);
    });

    it('CSP report is logged to audit_log', async () => {
      db.exec('DELETE FROM audit_log');

      const report = {
        'csp-report': {
          'document-uri': 'https://example.com',
          'blocked-uri': 'https://evil.com/hack.js',
          'violated-directive': 'script-src',
        },
      };

      await request(app)
        .post('/api/csp-report')
        .set('Content-Type', 'application/csp-report')
        .send(JSON.stringify(report))
        .expect(204);

      const logs = db.prepare("SELECT * FROM audit_log WHERE action = 'csp_violation'").all();
      assert.ok(logs.length >= 1, 'Should log CSP violation');
      const detail = JSON.parse(logs[0].detail);
      assert.equal(detail['blocked-uri'], 'https://evil.com/hack.js');
    });

    it('CSP report endpoint does not require auth', async () => {
      const report = {
        'csp-report': {
          'document-uri': 'https://example.com',
          'blocked-uri': 'inline',
          'violated-directive': 'script-src',
        },
      };

      // No cookie, should still work
      await request(app)
        .post('/api/csp-report')
        .set('Content-Type', 'application/csp-report')
        .send(JSON.stringify(report))
        .expect(204);
    });

    it('CSP report rate limiter is configured', () => {
      const serverJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
      assert.match(serverJs, /cspLimiter/);
      assert.match(serverJs, /max:\s*5/);
    });
  });
});
