'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser } = require('./helpers');

describe('Auth Service', () => {
  let db, app, authService;

  before(() => {
    ({ app, db } = setup());
    const createAuthService = require('../src/services/auth.service');
    const createAuditLogger = require('../src/services/audit');
    const audit = createAuditLogger(db);
    authService = createAuthService(db, audit);
  });

  beforeEach(() => {
    cleanDb();
  });

  after(() => teardown());

  // ── register ──

  describe('register', () => {
    it('should register a new user and return user + sid', async () => {
      const result = await authService.register({
        email: 'test@example.com',
        password: 'TestPass123!',
        displayName: 'Test User',
        masterPassword: 'MasterPass123!',
      });

      assert.ok(result.user);
      assert.ok(result.sid);
      assert.equal(result.user.email, 'test@example.com');
      assert.equal(typeof result.sid, 'string');
      assert.equal(result.sid.length, 64);
    });

    it('should make the first user admin', async () => {
      const result = await authService.register({
        email: 'admin@example.com',
        password: 'TestPass123!',
        displayName: 'Admin',
        masterPassword: 'MasterPass123!',
      });
      assert.equal(result.user.role, 'admin');
    });

    it('should make subsequent users adult', async () => {
      await authService.register({
        email: 'first@example.com',
        password: 'TestPass123!',
        displayName: 'First',
        masterPassword: 'MasterPass123!',
      });
      const result = await authService.register({
        email: 'second@example.com',
        password: 'TestPass123!',
        displayName: 'Second',
        masterPassword: 'MasterPass123!',
      });
      assert.equal(result.user.role, 'adult');
    });

    it('should reject duplicate email', async () => {
      await authService.register({
        email: 'dup@example.com',
        password: 'TestPass123!',
        displayName: 'First',
        masterPassword: 'MasterPass123!',
      });
      await assert.rejects(
        () => authService.register({
          email: 'dup@example.com',
          password: 'TestPass123!',
          displayName: 'Second',
          masterPassword: 'MasterPass123!',
        }),
        { code: 'CONFLICT' }
      );
    });
  });

  // ── login ──

  describe('login', () => {
    beforeEach(async () => {
      await authService.register({
        email: 'login@example.com',
        password: 'TestPass123!',
        displayName: 'Login User',
        masterPassword: 'MasterPass123!',
      });
    });

    it('should login successfully with correct credentials', async () => {
      const result = await authService.login({
        email: 'login@example.com',
        password: 'TestPass123!',
        masterPassword: 'MasterPass123!',
      });
      assert.ok(result.user);
      assert.ok(result.sid);
      assert.equal(result.user.email, 'login@example.com');
    });

    it('should reject wrong password', async () => {
      await assert.rejects(
        () => authService.login({
          email: 'login@example.com',
          password: 'WrongPass123!',
          masterPassword: 'MasterPass123!',
        }),
        { code: 'UNAUTHORIZED' }
      );
    });

    it('should reject non-existent email', async () => {
      await assert.rejects(
        () => authService.login({
          email: 'nobody@example.com',
          password: 'TestPass123!',
          masterPassword: 'MasterPass123!',
        }),
        { code: 'UNAUTHORIZED' }
      );
    });

    it('should reject wrong master password', async () => {
      await assert.rejects(
        () => authService.login({
          email: 'login@example.com',
          password: 'TestPass123!',
          masterPassword: 'WrongMaster123!',
        }),
        { code: 'UNAUTHORIZED' }
      );
    });

    it('should lock after 5 failed attempts', async () => {
      for (let i = 0; i < 5; i++) {
        try {
          await authService.login({
            email: 'login@example.com',
            password: 'WrongPass123!',
            masterPassword: 'MasterPass123!',
          });
        } catch { /* expected */ }
      }
      await assert.rejects(
        () => authService.login({
          email: 'login@example.com',
          password: 'TestPass123!',
          masterPassword: 'MasterPass123!',
        }),
        { message: 'Account temporarily locked. Try again later.' }
      );
    });
  });

  // ── logout ──

  describe('logout', () => {
    it('should delete session on logout', async () => {
      const { sid } = await authService.register({
        email: 'logout@example.com',
        password: 'TestPass123!',
        displayName: 'Logout User',
        masterPassword: 'MasterPass123!',
      });
      authService.logout(sid);
      const session = authService.getSession(sid);
      assert.equal(session, null);
    });
  });

  // ── getSession ──

  describe('getSession', () => {
    it('should return user for valid session', async () => {
      const { sid } = await authService.register({
        email: 'session@example.com',
        password: 'TestPass123!',
        displayName: 'Session User',
        masterPassword: 'MasterPass123!',
      });
      const user = authService.getSession(sid);
      assert.ok(user);
      assert.equal(user.email, 'session@example.com');
    });

    it('should return null for invalid sid', () => {
      const user = authService.getSession('invalidsid');
      assert.equal(user, null);
    });

    it('should return null for null sid', () => {
      const user = authService.getSession(null);
      assert.equal(user, null);
    });
  });

  // ── changePassword ──

  describe('changePassword', () => {
    it('should change password successfully', async () => {
      const { sid } = await authService.register({
        email: 'change@example.com',
        password: 'OldPass123!',
        displayName: 'Change User',
        masterPassword: 'OldMaster123!',
      });

      const result = await authService.changePassword(sid, {
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass123!',
        currentMasterPassword: 'OldMaster123!',
        newMasterPassword: 'NewMaster123!',
      });
      assert.deepEqual(result, { ok: true });

      // Login with new credentials should work
      const loginResult = await authService.login({
        email: 'change@example.com',
        password: 'NewPass123!',
        masterPassword: 'NewMaster123!',
      });
      assert.ok(loginResult.user);
    });

    it('should reject wrong current password', async () => {
      const { sid } = await authService.register({
        email: 'wrongpw@example.com',
        password: 'TestPass123!',
        displayName: 'Test',
        masterPassword: 'MasterPass123!',
      });
      await assert.rejects(
        () => authService.changePassword(sid, {
          currentPassword: 'WrongPass123!',
          newPassword: 'NewPass123!',
          currentMasterPassword: 'MasterPass123!',
          newMasterPassword: 'NewMaster123!',
        }),
        { message: 'Current password is incorrect' }
      );
    });

    it('should reject wrong current master password', async () => {
      const { sid } = await authService.register({
        email: 'wrongmaster@example.com',
        password: 'TestPass123!',
        displayName: 'Test',
        masterPassword: 'MasterPass123!',
      });
      await assert.rejects(
        () => authService.changePassword(sid, {
          currentPassword: 'TestPass123!',
          newPassword: 'NewPass123!',
          currentMasterPassword: 'WrongMaster123!',
          newMasterPassword: 'NewMaster123!',
        }),
        { message: 'Current master password is incorrect' }
      );
    });

    it('should reject invalid session', async () => {
      await assert.rejects(
        () => authService.changePassword('invalidsid', {
          currentPassword: 'TestPass123!',
          newPassword: 'NewPass123!',
          currentMasterPassword: 'MasterPass123!',
          newMasterPassword: 'NewMaster123!',
        }),
        { code: 'UNAUTHORIZED' }
      );
    });
  });

  // ── recordFailedAttempt ──

  describe('recordFailedAttempt', () => {
    it('should create login attempt on first failure', () => {
      authService.recordFailedAttempt('fail@example.com');
      const createAuthRepo = require('../src/repositories/auth.repository');
      const repo = createAuthRepo(db);
      const attempt = repo.findLoginAttempt('fail@example.com');
      assert.ok(attempt);
      assert.equal(attempt.attempts, 1);
    });

    it('should increment attempts on subsequent failures', () => {
      authService.recordFailedAttempt('incr@example.com');
      authService.recordFailedAttempt('incr@example.com');
      const createAuthRepo = require('../src/repositories/auth.repository');
      const repo = createAuthRepo(db);
      const attempt = repo.findLoginAttempt('incr@example.com');
      assert.equal(attempt.attempts, 2);
    });

    it('should set lockout after 5 failures', () => {
      for (let i = 0; i < 5; i++) {
        authService.recordFailedAttempt('lock@example.com');
      }
      const createAuthRepo = require('../src/repositories/auth.repository');
      const repo = createAuthRepo(db);
      const attempt = repo.findLoginAttempt('lock@example.com');
      assert.equal(attempt.attempts, 5);
      assert.ok(attempt.locked_until);
    });
  });
});
