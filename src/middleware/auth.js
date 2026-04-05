'use strict';

function createAuthMiddleware(db) {
  function requireAuth(req, res, next) {
    const sid = req.cookies && req.cookies.df_sid;
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const session = db.prepare(
      "SELECT * FROM sessions WHERE sid = ? AND expires_at > datetime('now')"
    ).get(sid);

    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    const user = db.prepare('SELECT id, role, active FROM users WHERE id = ?').get(session.user_id);
    if (!user || user.active === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.userId = session.user_id;
    req.userRole = user.role;
    req.sessionId = sid;
    next();
  }

  function optionalAuth(req, res, next) {
    const sid = req.cookies && req.cookies.df_sid;
    if (!sid) return next();

    const session = db.prepare(
      "SELECT * FROM sessions WHERE sid = ? AND expires_at > datetime('now')"
    ).get(sid);

    if (session) {
      const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(session.user_id);
      if (user) {
        req.userId = session.user_id;
        req.userRole = user.role;
        req.sessionId = sid;
      }
    }
    next();
  }

  return { requireAuth, optionalAuth };
}

module.exports = createAuthMiddleware;
