'use strict';

module.exports = function createRequestLogger(logger) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path.startsWith('/api/')) {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        logger.info({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(durationMs),
          userId: req.userId || null,
          ip: req.ip,
        }, 'request');
      }
    });
    next();
  };
};
