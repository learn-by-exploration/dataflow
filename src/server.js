'use strict';

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const config = require('./config');
const initDatabase = require('./db');
const { seedRecordTypes } = require('./db/seed');
const createAuthMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errors');
const createCsrfMiddleware = require('./middleware/csrf');
const createAuditLogger = require('./services/audit');
const createRequestLogger = require('./middleware/request-logger');
const createScheduler = require('./scheduler');
const logger = require('./logger');

const app = express();

// Trust proxy
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// Initialize database
const db = initDatabase(config.dbDir);

// Seed built-in record types
seedRecordTypes(db);

// Audit logger
const audit = createAuditLogger(db);
const deps = { db, audit };

const { requireAuth } = createAuthMiddleware(db);

// ─── Security headers ───
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.trustProxy ? [] : null,
    },
  },
  strictTransportSecurity: config.trustProxy,
  referrerPolicy: { policy: 'same-origin' },
}));

// ─── No-cache on API responses ───
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ─── CORS ───
if (config.allowedOrigins.length > 0) {
  app.use(cors({
    origin: function(origin, callback) {
      if (!origin) return callback(null, true);
      if (config.allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));
} else {
  app.use(cors({ origin: false }));
}

// ─── Rate limiting ───
if (!config.isTest) {
  const globalLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });
  app.use('/api/', globalLimiter);
}

// Auth-specific rate limiter (stricter)
const authLimiter = config.isTest ? (_req, _res, next) => next() : rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later' },
});

// ─── Body parsing ───
app.use(compression());
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Guard: ensure req.body is always an object for API mutations
app.use('/api', (req, _res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.body) req.body = {};
  next();
});

// ─── Static files ───
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── CSRF Protection ───
const csrfProtection = createCsrfMiddleware();
if (!config.isTest) {
  app.use('/api', csrfProtection);
}

// ─── Request Logging ───
if (!config.isTest) {
  app.use(createRequestLogger(logger));
}

// ─── Auth routes (no auth required) ───
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/change-password', authLimiter);
app.use(require('./routes/auth')(deps));

// ─── Health (no auth required) ───
app.use('/api/health', require('./routes/health')(db));

// ─── Apply auth middleware to remaining /api/* routes ───
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/health') return next();
  requireAuth(req, res, next);
});

// ─── Authenticated API routes ───
const sessionVault = require('./services/session-vault');
app.use('/api/categories', require('./routes/categories')(db));
app.use('/api/record-types', require('./routes/record-types')(db));
app.use('/api/items', require('./routes/items')(db, sessionVault));
app.use('/api', require('./routes/attachments')(db, sessionVault));
app.use('/api/tags', require('./routes/tags')(db));
app.use('/api/settings', require('./routes/settings')(db));
app.use('/api/members', require('./routes/members')(db));
app.use('/api/shared', require('./routes/sharing')(db));
app.use('/api/emergency', require('./routes/emergency')(db));
app.use('/api/audit', require('./routes/audit')(db));
app.use('/api', require('./routes/password-generator')());
app.use('/api/stats', require('./routes/stats')(db));
app.use('/api/data', require('./routes/data')(db, sessionVault));

// ─── API 404 catch-all ───
app.all('/api/{*splat}', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── SPA fallback ───
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Global error handler ───
app.use(errorHandler);

// ─── Start server ───
if (require.main === module) {
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception — forcing shutdown');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled rejection — forcing shutdown');
    process.exit(1);
  });

  const server = app.listen(config.port, () =>
    logger.info({ port: config.port, version: config.version }, 'DataFlow started')
  );

  const scheduler = createScheduler(db, logger);
  scheduler.registerBuiltinJobs();
  scheduler.start();

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutdown signal received, draining connections...');
    scheduler.stop();

    const sessionVault = require('./services/session-vault');
    sessionVault.clearAll();

    server.close(() => {
      logger.info('HTTP server closed');
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.close();
      } catch (e) {
        logger.error({ err: e }, 'Error during DB shutdown');
        try { db.close(); } catch { /* ignore */ }
      }
      logger.info('Database closed');
      process.exit(0);
    });

    setTimeout(() => {
      logger.warn('Forcing shutdown after timeout');
      try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* ignore */ }
      process.exit(1);
    }, config.shutdownTimeoutMs);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { app, db };
