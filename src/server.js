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
const { createMetricsMiddleware, formatMetrics } = require('./middleware/metrics');

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
      upgradeInsecureRequests: config.secureCookie ? [] : null,
      reportUri: '/api/csp-report',
    },
  },
  strictTransportSecurity: config.trustProxy,
  referrerPolicy: { policy: 'same-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
}));

// Permissions-Policy header (not set by helmet by default)
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

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
const writeLimiter = config.isTest ? (_req, _res, next) => next() : rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests, please try again later' },
});

const readLimiter = config.isTest ? (_req, _res, next) => next() : rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many read requests, please try again later' },
});

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

// ─── JSON depth limiting ───
function getJsonDepth(obj, current) {
  if (current === undefined) current = 0;
  if (obj === null || typeof obj !== 'object') return current;
  let max = current + 1;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const d = getJsonDepth(obj[i], current + 1);
      if (d > max) max = d;
    }
  } else {
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const d = getJsonDepth(obj[keys[i]], current + 1);
      if (d > max) max = d;
    }
  }
  return max;
}

app.use('/api', (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    if (getJsonDepth(req.body) > 6) {
      return res.status(400).json({ error: 'Request body too deeply nested' });
    }
  }
  next();
});

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

// ─── Metrics collection ───
app.use(createMetricsMiddleware());

// ─── Auth routes (no auth required) ───
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/change-password', authLimiter);
app.use(require('./routes/auth')(deps));

// ─── CSP violation reporting (no auth required, rate-limited) ───
const cspLimiter = config.isTest ? (_req, _res, next) => next() : rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many CSP reports' },
});
app.post('/api/csp-report', cspLimiter, express.json({ type: 'application/csp-report', limit: '10kb' }), (req, res) => {
  const report = req.body && req.body['csp-report'];
  if (report) {
    audit.log({
      userId: null,
      action: 'csp_violation',
      resource: 'csp',
      resourceId: null,
      ip: req.ip,
      ua: req.headers['user-agent'],
      detail: JSON.stringify(report),
    });
  }
  res.status(204).end();
});

// ─── Health (no auth required) ───
app.use('/api/health', require('./routes/health')(db));

// ─── Metrics (no auth required, separate mount) ───
app.get('/api/metrics', (req, res) => {
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  if (!isLocal) {
    return res.status(403).json({ error: 'Metrics only accessible from localhost' });
  }
  try {
    const text = formatMetrics(db);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch (err) {
    res.status(500).send('# Error generating metrics\n');
  }
});

// ─── Apply auth middleware to remaining /api/* routes ───
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/health' || req.path.startsWith('/health/') || req.path === '/metrics' || req.path === '/csp-report' || (req.method === 'GET' && req.path.startsWith('/share-links/')) || (req.method === 'POST' && req.path.match(/^\/share-links\/[^/]+\/resolve$/))) return next();
  requireAuth(req, res, next);
});

// ─── Per-route rate limiters (write=60/min, read=120/min) ───
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  return readLimiter(req, res, next);
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
app.use('/api/security', require('./routes/security')(db));
app.use('/api/data', require('./routes/data')(db, sessionVault));
app.use('/api/share-links', require('./routes/share-links')(db));
app.use('/api/templates', require('./routes/templates')(db));

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
  scheduler.runStartupChecks();
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

module.exports = { app, db, getJsonDepth };
