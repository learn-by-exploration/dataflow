'use strict';

const sessionVault = require('./services/session-vault');
const config = require('./config');

function createScheduler(db, logger) {
  const jobs = [];

  function register(name, intervalMs, fn) {
    jobs.push({ name, intervalMs, fn, timer: null });
  }

  function start() {
    for (const job of jobs) {
      job.fn().catch(err => logger.error({ err, job: job.name }, 'Scheduler job failed'));
      job.timer = setInterval(() => {
        job.fn().catch(err => logger.error({ err, job: job.name }, 'Scheduler job failed'));
      }, job.intervalMs);
    }
  }

  function stop() {
    for (const job of jobs) {
      if (job.timer) {
        clearInterval(job.timer);
        job.timer = null;
      }
    }
  }

  function registerBuiltinJobs() {
    // Stale session cleanup (every hour)
    register('session-cleanup', 60 * 60 * 1000, async () => {
      const result = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
      if (result.changes > 0) {
        logger.info({ deleted: result.changes }, 'Cleaned up expired sessions');
      }
    });

    // Vault key expiry cleanup (every minute)
    register('vault-key-cleanup', 60 * 1000, async () => {
      const timeoutMs = config.autoLockMinutes * 60 * 1000;
      sessionVault.clearExpired(timeoutMs);
    });

    // Audit log retention (daily check)
    register('audit-retention', 24 * 60 * 60 * 1000, async () => {
      if (!config.auditRetentionDays || config.auditRetentionDays <= 0) return;
      const result = db.prepare(
        "DELETE FROM audit_log WHERE created_at < datetime('now', '-' || ? || ' days')"
      ).run(String(config.auditRetentionDays));
      if (result.changes > 0) {
        logger.info({ deleted: result.changes, retentionDays: config.auditRetentionDays }, 'Cleaned old audit logs');
      }
    });

    // Trash purge (daily check — remove items deleted > 30 days ago)
    register('trash-purge', 24 * 60 * 60 * 1000, async () => {
      const result = db.prepare(
        "DELETE FROM items WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')"
      ).run();
      if (result.changes > 0) {
        logger.info({ deleted: result.changes }, 'Purged old trashed items');
      }
    });

    // Expired shares cleanup (every hour)
    register('expired-shares-cleanup', 60 * 60 * 1000, async () => {
      const createSharingRepo = require('./repositories/sharing.repository');
      const sharingRepo = createSharingRepo(db);
      const cleaned = sharingRepo.cleanExpiredShares();
      if (cleaned > 0) {
        logger.info({ deleted: cleaned }, 'Cleaned up expired shares');
      }
    });

    // ─── DB maintenance ───
    if (config.dbMaintenance.enabled) {
      // Daily: PRAGMA optimize
      register('db-optimize', 24 * 60 * 60 * 1000, async () => {
        try {
          db.pragma('optimize');
          logger.info('Database optimized');
        } catch (err) {
          logger.warn({ err }, 'Database optimize failed');
        }
      });

      // Weekly (every 7 days): WAL checkpoint + optimize
      register('db-wal-checkpoint', 7 * 24 * 60 * 60 * 1000, async () => {
        try {
          db.pragma('wal_checkpoint(TRUNCATE)');
          db.pragma('optimize');
          logger.info('Weekly WAL checkpoint completed');
        } catch (err) {
          logger.warn({ err }, 'WAL checkpoint failed');
        }
      });
    }

    // Weekly backup verification
    register('backup-verify', 7 * 24 * 60 * 60 * 1000, async () => {
      try {
        const path = require('path');
        const { verifyAllBackups } = require('./services/backup.service');
        const backupDir = path.join(config.dbDir, 'backups');
        const results = verifyAllBackups(backupDir);
        const failed = results.filter(r => !r.valid);
        if (failed.length > 0) {
          logger.warn({ failed: failed.length, total: results.length }, 'Backup verification found invalid backups');
        } else if (results.length > 0) {
          logger.info({ verified: results.length }, 'All backups verified');
        }
      } catch (err) {
        logger.warn({ err }, 'Backup verification failed');
      }
    });
  }

  /**
   * Run startup integrity check (non-blocking).
   */
  function runStartupChecks() {
    if (!config.dbMaintenance.enabled) return;
    try {
      const result = db.pragma('integrity_check', { simple: true });
      if (result === 'ok') {
        logger.info('Database integrity check passed');
      } else {
        logger.warn({ result }, 'Database integrity check warning');
      }
    } catch (err) {
      logger.warn({ err }, 'Database integrity check failed');
    }
  }

  return { register, start, stop, registerBuiltinJobs, runStartupChecks };
}

module.exports = createScheduler;
