'use strict';

const logger = require('../logger');
const { AppError } = require('../errors');

function errorHandler(err, req, res, _next) {
  logger.error({ err, method: req.method, url: req.originalUrl }, 'Request error');

  if (err instanceof AppError) {
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }

  // SQLite constraint violations
  if (err.message && err.message.includes('SQLITE_CONSTRAINT')) {
    return res.status(409).json({ error: 'Constraint violation' });
  }

  // JSON parse errors
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
}

module.exports = errorHandler;
