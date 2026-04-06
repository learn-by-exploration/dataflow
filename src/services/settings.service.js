'use strict';

const createSettingsRepo = require('../repositories/settings.repository');

function createSettingsService(db) {
  const repo = createSettingsRepo(db);

  return {
    findAll(userId) {
      const rows = repo.findAll(userId);
      const settings = {};
      for (const row of rows) {
        settings[row.key] = row.value;
      }
      return settings;
    },

    upsert(userId, key, value) {
      repo.upsert(userId, key, value);
      return { key, value };
    },

    delete(userId, key) {
      repo.delete(userId, key);
    },
  };
}

module.exports = createSettingsService;
