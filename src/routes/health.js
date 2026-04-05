'use strict';

const { Router } = require('express');
const config = require('../config');

const startTime = Date.now();

module.exports = function createHealthRoutes(db) {
  const router = Router();

  router.get('/', (_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    res.json({ status: 'ok', uptime, version: config.version });
  });

  return router;
};
