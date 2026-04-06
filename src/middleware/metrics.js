'use strict';

/**
 * Simple Prometheus-style metrics collector.
 * No external dependencies — uses plain objects and arrays.
 */

const metrics = {
  http_requests_total: {},    // { "method:path:status": count }
  http_request_durations: [], // [{ method, path, status, duration }] — circular buffer
  _maxDurations: 10000,
};

function normalizeRoute(req) {
  // Use Express route pattern if available, else normalize numeric IDs
  if (req.route && req.route.path && req.baseUrl) {
    return req.baseUrl + req.route.path;
  }
  return req.path.replace(/\/\d+/g, '/:id');
}

function createMetricsMiddleware() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      const method = req.method;
      const route = normalizeRoute(req);
      const status = String(res.statusCode);

      // Increment counter
      const key = `${method}:${route}:${status}`;
      metrics.http_requests_total[key] = (metrics.http_requests_total[key] || 0) + 1;

      // Record duration for histogram
      metrics.http_request_durations.push({ method, route, status, duration: durationSec });
      if (metrics.http_request_durations.length > metrics._maxDurations) {
        metrics.http_request_durations = metrics.http_request_durations.slice(-5000);
      }
    });

    next();
  };
}

/**
 * Build histogram buckets from duration samples.
 */
function buildHistogram(durations) {
  const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  const lines = [];
  let sum = 0;
  const count = durations.length;

  for (const b of buckets) {
    const le = durations.filter(d => d <= b).length;
    lines.push(`http_request_duration_seconds_bucket{le="${b}"} ${le}`);
  }
  lines.push(`http_request_duration_seconds_bucket{le="+Inf"} ${count}`);
  for (const d of durations) sum += d;
  lines.push(`http_request_duration_seconds_sum ${sum.toFixed(6)}`);
  lines.push(`http_request_duration_seconds_count ${count}`);

  return lines;
}

/**
 * Generate Prometheus text exposition format.
 */
function formatMetrics(db) {
  const lines = [];

  // ─── HTTP requests total ───
  lines.push('# HELP http_requests_total Total number of HTTP requests');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, count] of Object.entries(metrics.http_requests_total)) {
    const [method, path, status] = key.split(':');
    lines.push(`http_requests_total{method="${method}",path="${path}",status="${status}"} ${count}`);
  }

  // ─── HTTP request duration ───
  lines.push('# HELP http_request_duration_seconds HTTP request duration in seconds');
  lines.push('# TYPE http_request_duration_seconds histogram');
  const allDurations = metrics.http_request_durations.map(d => d.duration);
  lines.push(...buildHistogram(allDurations));

  // ─── DB metrics ───
  if (db) {
    try {
      const pageCount = db.pragma('page_count', { simple: true });
      const pageSize = db.pragma('page_size', { simple: true });
      const dbSize = pageCount * pageSize;
      lines.push('# HELP db_size_bytes Database size in bytes');
      lines.push('# TYPE db_size_bytes gauge');
      lines.push(`db_size_bytes ${dbSize}`);
    } catch { /* ignore */ }

    try {
      const itemsTotal = db.prepare('SELECT COUNT(*) as c FROM items').get().c;
      lines.push('# HELP items_total Total number of items');
      lines.push('# TYPE items_total gauge');
      lines.push(`items_total ${itemsTotal}`);
    } catch { /* ignore */ }

    try {
      const sessionsActive = db.prepare("SELECT COUNT(*) as c FROM sessions WHERE expires_at > datetime('now')").get().c;
      lines.push('# HELP active_sessions Number of active sessions');
      lines.push('# TYPE active_sessions gauge');
      lines.push(`active_sessions ${sessionsActive}`);
    } catch { /* ignore */ }
  }

  return lines.join('\n') + '\n';
}

module.exports = { createMetricsMiddleware, formatMetrics, metrics };
