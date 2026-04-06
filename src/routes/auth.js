'use strict';

const { Router } = require('express');
const config = require('../config');
const validate = require('../middleware/validate');
const { registerSchema, loginSchema, changePasswordSchema } = require('../schemas/auth.schema');
const createAuthService = require('../services/auth.service');

module.exports = function createAuthRoutes({ db, audit }) {
  const router = Router();
  const authService = createAuthService(db, audit);

  // ─── POST /api/auth/register ───
  router.post('/api/auth/register', validate({ body: registerSchema }), async (req, res, next) => {
    try {
      const { email, password, display_name, master_password } = req.body;

      const { user, sid } = await authService.register({
        email,
        password,
        displayName: display_name,
        masterPassword: master_password,
      });

      // Set session cookie
      const maxAge = config.session.maxAgeDays;
      const cookieOpts = [
        `df_sid=${sid}`,
        'HttpOnly',
        'SameSite=Strict',
        `Path=/`,
        `Max-Age=${maxAge * 86400}`,
      ];
      if (config.isProd) cookieOpts.push('Secure');
      res.setHeader('Set-Cookie', cookieOpts.join('; '));

      audit.log({
        userId: user.id,
        action: 'register',
        resource: 'user',
        resourceId: user.id,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  });

  // ─── POST /api/auth/login ───
  router.post('/api/auth/login', validate({ body: loginSchema }), async (req, res, next) => {
    try {
      const { email, password, master_password } = req.body;

      const { user, sid } = await authService.login({
        email,
        password,
        masterPassword: master_password,
      });

      // Set session cookie
      const maxAge = config.session.maxAgeDays;
      const cookieOpts = [
        `df_sid=${sid}`,
        'HttpOnly',
        'SameSite=Strict',
        `Path=/`,
        `Max-Age=${maxAge * 86400}`,
      ];
      if (config.isProd) cookieOpts.push('Secure');
      res.setHeader('Set-Cookie', cookieOpts.join('; '));

      audit.log({
        userId: user.id,
        action: 'login',
        resource: 'session',
        resourceId: null,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.json(user);
    } catch (err) {
      next(err);
    }
  });

  // ─── POST /api/auth/logout ───
  router.post('/api/auth/logout', (req, res) => {
    const sid = req.cookies && req.cookies.df_sid;
    if (sid) {
      authService.logout(sid);
    }

    res.setHeader('Set-Cookie', 'df_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  // ─── GET /api/auth/session ───
  router.get('/api/auth/session', (req, res) => {
    const sid = req.cookies && req.cookies.df_sid;
    const user = authService.getSession(sid);

    if (!user) {
      return res.json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      user,
    });
  });

  // ─── PUT /api/auth/password ───
  router.put('/api/auth/password', validate({ body: changePasswordSchema }), async (req, res, next) => {
    try {
      const sid = req.cookies && req.cookies.df_sid;

      const sessionUser = authService.getSession(sid);

      await authService.changePassword(sid, {
        currentPassword: req.body.current_password,
        newPassword: req.body.new_password,
        currentMasterPassword: req.body.current_master_password,
        newMasterPassword: req.body.new_master_password,
      });

      if (sessionUser) {
        audit.log({
          userId: sessionUser.id,
          action: 'password_change',
          resource: 'user',
          resourceId: sessionUser.id,
          ip: req.ip,
          ua: req.headers['user-agent'],
        });
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
