'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser } = require('./helpers');

describe('Settings Service', () => {
  let db, app, settingsService, userId;

  before(() => {
    ({ app, db } = setup());
    const createSettingsService = require('../src/services/settings.service');
    settingsService = createSettingsService(db);
  });

  beforeEach(async () => {
    cleanDb();
    const user = await makeUser(app);
    userId = user.id;
  });

  after(() => teardown());

  // ── findAll ──

  describe('findAll', () => {
    it('should return empty object when no settings', () => {
      const settings = settingsService.findAll(userId);
      assert.deepEqual(settings, {});
    });

    it('should return settings as key-value map', () => {
      settingsService.upsert(userId, 'theme', 'dark');
      settingsService.upsert(userId, 'language', 'en');
      const settings = settingsService.findAll(userId);
      assert.deepEqual(settings, { theme: 'dark', language: 'en' });
    });
  });

  // ── upsert ──

  describe('upsert', () => {
    it('should create a new setting', () => {
      const result = settingsService.upsert(userId, 'theme', 'dark');
      assert.deepEqual(result, { key: 'theme', value: 'dark' });
      const settings = settingsService.findAll(userId);
      assert.equal(settings.theme, 'dark');
    });

    it('should update an existing setting', () => {
      settingsService.upsert(userId, 'theme', 'dark');
      settingsService.upsert(userId, 'theme', 'light');
      const settings = settingsService.findAll(userId);
      assert.equal(settings.theme, 'light');
    });

    it('should not affect other users settings', async () => {
      const user2 = await makeUser(app, { email: 'other@example.com' });
      settingsService.upsert(userId, 'theme', 'dark');
      settingsService.upsert(user2.id, 'theme', 'light');
      assert.equal(settingsService.findAll(userId).theme, 'dark');
      assert.equal(settingsService.findAll(user2.id).theme, 'light');
    });
  });

  // ── delete ──

  describe('delete', () => {
    it('should delete a setting', () => {
      settingsService.upsert(userId, 'theme', 'dark');
      settingsService.delete(userId, 'theme');
      const settings = settingsService.findAll(userId);
      assert.equal(settings.theme, undefined);
    });

    it('should not error when deleting non-existent key', () => {
      assert.doesNotThrow(() => {
        settingsService.delete(userId, 'nonexistent');
      });
    });
  });
});
