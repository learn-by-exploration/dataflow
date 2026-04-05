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
  }

  return { register, start, stop, registerBuiltinJobs };
}

module.exports = createScheduler;
