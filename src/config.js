require('dotenv').config();
const path = require('path');
const fs = require('fs');

let version = '0.1.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  version = pkg.version || version;
} catch { /* ignore */ }

const config = Object.freeze({
  port: parseInt(process.env.PORT, 10) || 3460,
  dbDir: process.env.DB_DIR || path.join(__dirname, '..', 'data'),
  nodeEnv: process.env.NODE_ENV || 'development',
  isTest: process.env.NODE_ENV === 'test',
  isProd: process.env.NODE_ENV === 'production',
  version,
  session: {
    maxAgeDays: parseInt(process.env.SESSION_MAX_AGE_DAYS, 10) || 7,
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 200,
  },
  auth: {
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12,
  },
  argon2: {
    memoryCost: parseInt(process.env.ARGON2_MEMORY, 10) || 65536,
    timeCost: parseInt(process.env.ARGON2_TIME, 10) || 3,
    parallelism: parseInt(process.env.ARGON2_PARALLELISM, 10) || 1,
  },
  autoLockMinutes: parseInt(process.env.AUTO_LOCK_MINUTES, 10) || 5,
  maxAttachmentSize: parseInt(process.env.MAX_ATTACHMENT_SIZE, 10) || 10485760,
  backup: {
    retainCount: parseInt(process.env.BACKUP_RETAIN_COUNT, 10) || 7,
    intervalHours: parseInt(process.env.BACKUP_INTERVAL_HOURS, 10) || 24,
  },
  log: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  },
  shutdownTimeoutMs: parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 10000,
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : [],
});

module.exports = config;
