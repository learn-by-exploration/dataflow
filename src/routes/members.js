'use strict';

const { Router } = require('express');
const { requireRole } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const { inviteSchema, updateMemberSchema } = require('../schemas/member.schema');
const { idParam } = require('../schemas/common.schema');
const createMemberService = require('../services/member.service');
const createAuditLogger = require('../services/audit');
const createAuthService = require('../services/auth.service');

module.exports = function createMemberRoutes(db) {
  const router = Router();
  const audit = createAuditLogger(db);
  const memberService = createMemberService(db, audit);
  const authService = createAuthService(db, audit);

  // GET / — list all members
  router.get('/', (req, res, next) => {
    try {
      const members = memberService.findAll(req.userRole);
      res.json(members);
    } catch (err) { next(err); }
  });

  // POST /invite — admin only
  router.post('/invite', requireRole('admin'), validate({ body: inviteSchema }), async (req, res, next) => {
    try {
      const { email, display_name, role, password, master_password } = req.body;

      const result = await memberService.invite(req.userId, {
        email,
        displayName: display_name,
        role,
        password,
        masterPassword: master_password,
      }, { ip: req.ip, ua: req.headers['user-agent'] });

      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  // GET /:id — get member profile
  router.get('/:id', validate({ params: idParam }), (req, res, next) => {
    try {
      const member = memberService.findById(req.params.id);
      res.json(member);
    } catch (err) { next(err); }
  });

  // PUT /:id — update member
  router.put('/:id', validate({ params: idParam, body: updateMemberSchema }), (req, res, next) => {
    try {
      const updated = memberService.update(req.userId, req.userRole, req.params.id, req.body);
      res.json(updated);
    } catch (err) { next(err); }
  });

  // PUT /:id/deactivate — admin only
  router.put('/:id/deactivate', requireRole('admin'), validate({ params: idParam }), (req, res, next) => {
    try {
      const updated = memberService.deactivate(req.userId, req.params.id, { ip: req.ip, ua: req.headers['user-agent'] });
      res.json(updated);
    } catch (err) { next(err); }
  });

  // PUT /:id/activate — admin only
  router.put('/:id/activate', requireRole('admin'), validate({ params: idParam }), (req, res, next) => {
    try {
      const updated = memberService.activate(req.userId, req.params.id, { ip: req.ip, ua: req.headers['user-agent'] });
      res.json(updated);
    } catch (err) { next(err); }
  });

  // DELETE /:id — admin only, hard delete + cascade
  router.delete('/:id', requireRole('admin'), validate({ params: idParam }), (req, res, next) => {
    try {
      memberService.delete(req.userId, req.params.id, { ip: req.ip, ua: req.headers['user-agent'] });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // POST /:id/unlock — admin only, clear lockout
  router.post('/:id/unlock', requireRole('admin'), validate({ params: idParam }), (req, res, next) => {
    try {
      const member = memberService.findById(req.params.id);
      authService.unlockAccount(member.email);

      audit.log({
        userId: req.userId,
        action: 'account_unlock',
        resource: 'user',
        resourceId: String(req.params.id),
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  return router;
};
