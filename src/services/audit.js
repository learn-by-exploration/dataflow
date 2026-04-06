'use strict';

function createAuditLogger(db) {
  const insertStmt = db.prepare(
    'INSERT INTO audit_log (user_id, action, resource, resource_id, ip, ua, detail) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  function log({ userId, action, resource, resourceId, ip, ua, detail }) {
    try {
      insertStmt.run(
        userId || null,
        action,
        resource || null,
        resourceId !== null && resourceId !== undefined ? String(resourceId) : null,
        typeof ip === 'string' ? ip.slice(0, 45) : '',
        typeof ua === 'string' ? ua.slice(0, 256) : '',
        detail || null
      );
    } catch (_e) {
      // Never let audit failures break application flow
    }
  }

  function cleanOldAuditLogs(retentionDays) {
    if (!retentionDays || retentionDays <= 0) return { deleted: 0 };
    const result = db.prepare(
      "DELETE FROM audit_log WHERE created_at < datetime('now', '-' || ? || ' days')"
    ).run(String(retentionDays));
    return { deleted: result.changes };
  }

  return { log, cleanOldAuditLogs };
}

module.exports = createAuditLogger;
