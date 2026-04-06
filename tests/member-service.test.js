'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown } = require('./helpers');

describe('Member Service', () => {
  let db, memberService, adminId, authService;

  before(() => {
    ({ db } = setup());
    const createMemberService = require('../src/services/member.service');
    const createAuditLogger = require('../src/services/audit');
    const createAuthService = require('../src/services/auth.service');
    const audit = createAuditLogger(db);
    memberService = createMemberService(db, audit);
    authService = createAuthService(db, audit);
  });

  beforeEach(async () => {
    cleanDb();
    // Create an admin user
    const result = await authService.register({
      email: 'admin@example.com',
      password: 'TestPass123!',
      displayName: 'Admin User',
      masterPassword: 'MasterPass123!',
    });
    adminId = result.user.id;
  });

  after(() => teardown());

  // ── findAll ──

  describe('findAll', () => {
    it('should return full details for admin', () => {
      const members = memberService.findAll('admin');
      assert.ok(Array.isArray(members));
      assert.equal(members.length, 1);
      assert.ok(members[0].email);
      assert.ok(members[0].created_at);
    });

    it('should return full details for adult', () => {
      const members = memberService.findAll('adult');
      assert.ok(members[0].email);
    });

    it('should return basic details for child', () => {
      const members = memberService.findAll('child');
      assert.ok(Array.isArray(members));
      assert.equal(members.length, 1);
      assert.equal(members[0].email, undefined);
      assert.ok(members[0].display_name);
    });
  });

  // ── findById ──

  describe('findById', () => {
    it('should return member by id', () => {
      const member = memberService.findById(adminId);
      assert.equal(member.id, adminId);
      assert.equal(member.email, 'admin@example.com');
    });

    it('should throw NotFoundError for missing member', () => {
      assert.throws(
        () => memberService.findById(9999),
        { code: 'NOT_FOUND' }
      );
    });
  });

  // ── invite ──

  describe('invite', () => {
    it('should invite a new member', async () => {
      const member = await memberService.invite(adminId, {
        email: 'invited@example.com',
        displayName: 'Invited User',
        role: 'adult',
        password: 'InvPass123!',
        masterPassword: 'InvMaster123!',
      });
      assert.equal(member.email, 'invited@example.com');
      assert.equal(member.role, 'adult');
      assert.equal(member.active, 1);
    });

    it('should reject duplicate email', async () => {
      await assert.rejects(
        () => memberService.invite(adminId, {
          email: 'admin@example.com',
          displayName: 'Dup',
          role: 'adult',
          password: 'TestPass123!',
          masterPassword: 'MasterPass123!',
        }),
        { code: 'CONFLICT' }
      );
    });
  });

  // ── update ──

  describe('update', () => {
    it('should update display_name as admin', () => {
      const updated = memberService.update(adminId, 'admin', adminId, { display_name: 'New Name' });
      assert.equal(updated.display_name, 'New Name');
    });

    it('should update own display_name as non-admin', async () => {
      const { user } = await authService.register({
        email: 'adult@example.com',
        password: 'TestPass123!',
        displayName: 'Adult',
        masterPassword: 'MasterPass123!',
      });
      const updated = memberService.update(user.id, 'adult', user.id, { display_name: 'Updated' });
      assert.equal(updated.display_name, 'Updated');
    });

    it('should allow admin to change role', () => {
      // Need another user to change role on
      db.prepare(
        "INSERT INTO users (email, password_hash, display_name, role, master_key_salt, master_key_params, vault_key_encrypted) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run('child@example.com', 'hash', 'Child', 'child', 'salt', '{}', '{}');
      const child = db.prepare("SELECT id FROM users WHERE email = 'child@example.com'").get();

      const updated = memberService.update(adminId, 'admin', child.id, { role: 'adult' });
      assert.equal(updated.role, 'adult');
    });

    it('should reject role change by non-admin', async () => {
      const { user } = await authService.register({
        email: 'nonadmin@example.com',
        password: 'TestPass123!',
        displayName: 'Non Admin',
        masterPassword: 'MasterPass123!',
      });
      assert.throws(
        () => memberService.update(user.id, 'adult', adminId, { role: 'child' }),
        { code: 'FORBIDDEN' }
      );
    });

    it('should reject updating another member profile as non-admin', async () => {
      const { user } = await authService.register({
        email: 'other@example.com',
        password: 'TestPass123!',
        displayName: 'Other',
        masterPassword: 'MasterPass123!',
      });
      assert.throws(
        () => memberService.update(user.id, 'adult', adminId, { display_name: 'Hacked' }),
        { code: 'FORBIDDEN' }
      );
    });
  });

  // ── deactivate ──

  describe('deactivate', () => {
    it('should deactivate a member', async () => {
      const invited = await memberService.invite(adminId, {
        email: 'deact@example.com',
        displayName: 'Deactivate Me',
        role: 'adult',
        password: 'TestPass123!',
        masterPassword: 'MasterPass123!',
      });
      const result = memberService.deactivate(adminId, invited.id);
      assert.equal(result.active, 0);
    });

    it('should reject self-deactivation', () => {
      assert.throws(
        () => memberService.deactivate(adminId, adminId),
        { code: 'FORBIDDEN' }
      );
    });

    it('should throw NotFoundError for missing member', () => {
      assert.throws(
        () => memberService.deactivate(adminId, 9999),
        { code: 'NOT_FOUND' }
      );
    });
  });

  // ── activate ──

  describe('activate', () => {
    it('should activate a deactivated member', async () => {
      const invited = await memberService.invite(adminId, {
        email: 'act@example.com',
        displayName: 'Activate Me',
        role: 'adult',
        password: 'TestPass123!',
        masterPassword: 'MasterPass123!',
      });
      memberService.deactivate(adminId, invited.id);
      const result = memberService.activate(adminId, invited.id);
      assert.equal(result.active, 1);
    });
  });

  // ── delete ──

  describe('delete', () => {
    it('should hard delete a member', async () => {
      const invited = await memberService.invite(adminId, {
        email: 'del@example.com',
        displayName: 'Delete Me',
        role: 'adult',
        password: 'TestPass123!',
        masterPassword: 'MasterPass123!',
      });
      memberService.delete(adminId, invited.id);
      assert.throws(
        () => memberService.findById(invited.id),
        { code: 'NOT_FOUND' }
      );
    });

    it('should reject self-delete', () => {
      assert.throws(
        () => memberService.delete(adminId, adminId),
        { code: 'FORBIDDEN' }
      );
    });

    it('should throw NotFoundError for missing member', () => {
      assert.throws(
        () => memberService.delete(adminId, 9999),
        { code: 'NOT_FOUND' }
      );
    });
  });
});
