'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser } = require('./helpers');

describe('Session Repository', () => {
  let db, app, sessionRepo, userId;

  before(() => {
    ({ app, db } = setup());
    const createSessionRepo = require('../src/repositories/session.repository');
    sessionRepo = createSessionRepo(db);
  });

  beforeEach(async () => {
    cleanDb();
    const user = await makeUser(app);
    userId = user.id;
  });

  after(() => teardown());

  // ── createSession + findValidSession ──

  describe('create and find', () => {
    it('should create a session and find it', () => {
      sessionRepo.createSession('testsid123', userId, 7);
      const session = sessionRepo.findValidSession('testsid123');
      assert.ok(session);
      assert.equal(session.sid, 'testsid123');
      assert.equal(session.user_id, userId);
    });

    it('should return null for non-existent session', () => {
      const session = sessionRepo.findValidSession('nonexistent');
      assert.equal(session, null);
    });
  });

  // ── expired session ──

  describe('expired session', () => {
    it('should not find an expired session', () => {
      // Insert an already-expired session
      db.prepare(
        "INSERT INTO sessions (sid, user_id, expires_at) VALUES (?, ?, datetime('now', '-1 day'))"
      ).run('expiredsid', userId);

      const session = sessionRepo.findValidSession('expiredsid');
      assert.equal(session, null);
    });
  });

  // ── deleteSession ──

  describe('deleteSession', () => {
    it('should delete a session', () => {
      sessionRepo.createSession('delsid', userId, 7);
      sessionRepo.deleteSession('delsid');
      const session = sessionRepo.findValidSession('delsid');
      assert.equal(session, null);
    });

    it('should not error when deleting non-existent session', () => {
      assert.doesNotThrow(() => {
        sessionRepo.deleteSession('nonexistent');
      });
    });
  });

  // ── deleteUserSessions ──

  describe('deleteUserSessions', () => {
    it('should delete all sessions for a user', () => {
      sessionRepo.createSession('sid1', userId, 7);
      sessionRepo.createSession('sid2', userId, 7);
      sessionRepo.deleteUserSessions(userId);
      assert.equal(sessionRepo.findValidSession('sid1'), null);
      assert.equal(sessionRepo.findValidSession('sid2'), null);
    });

    it('should not affect other users sessions', async () => {
      const user2 = await makeUser(app, { email: 'other@example.com' });
      sessionRepo.createSession('usid1', userId, 7);
      sessionRepo.createSession('usid2', user2.id, 7);
      sessionRepo.deleteUserSessions(userId);
      assert.equal(sessionRepo.findValidSession('usid1'), null);
      assert.ok(sessionRepo.findValidSession('usid2'));
    });
  });
});
