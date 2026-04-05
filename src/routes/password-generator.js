'use strict';

const { Router } = require('express');
const { generatePassword, generatePassphrase } = require('../services/password-generator');

module.exports = function createPasswordGeneratorRoutes() {
  const router = Router();

  // POST /api/generate-password
  router.post('/generate-password', (req, res, next) => {
    try {
      const { length, uppercase, lowercase, numbers, symbols } = req.body;
      const password = generatePassword({ length, uppercase, lowercase, numbers, symbols });
      res.json({ password });
    } catch (err) { next(err); }
  });

  // POST /api/generate-passphrase
  router.post('/generate-passphrase', (req, res, next) => {
    try {
      const { words, separator, capitalize } = req.body;
      const passphrase = generatePassphrase({ words, separator, capitalize });
      res.json({ passphrase });
    } catch (err) { next(err); }
  });

  return router;
};
