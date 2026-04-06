'use strict';

const createSessionRepo = require('../repositories/session.repository');
const createAuthRepo = require('../repositories/auth.repository');

function createAuthMiddleware(db) {
  const sessionRepo = createSessionRepo(db);
  const authRepo = createAuthRepo(db);

  function requireAuth(req, res, next) {
    const sid = req.cookies && (req.cookies['__Host-df_sid'] || req.cookies.df_sid);
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const session = sessionRepo.findValidSession(sid);

    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    const user = authRepo.findUserById(session.user_id);
    if (!user || user.active === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.userId = session.user_id;
    req.userRole = user.role;
    req.sessionId = sid;
    next();
  }

  function optionalAuth(req, res, next) {
    const sid = req.cookies && (req.cookies['__Host-df_sid'] || req.cookies.df_sid);
    if (!sid) return next();

    const session = sessionRepo.findValidSession(sid);

    if (session) {
      const user = authRepo.findUserById(session.user_id);
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
