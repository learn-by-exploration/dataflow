'use strict';

const { Router } = require('express');
const createEmergencyRepo = require('../repositories/emergency.repository');
const createAuditLogger = require('../services/audit');
const { NotFoundError, ForbiddenError } = require('../errors');

module.exports = function createEmergencyRoutes(db) {
  const router = Router();
  const repo = createEmergencyRepo(db);
  const audit = createAuditLogger(db);

  // POST /request — request emergency access
  router.post('/request', (req, res, next) => {
    try {
      const { grantor_id } = req.body;
      if (!grantor_id) return res.status(400).json({ error: 'grantor_id is required' });

      if (grantor_id === req.userId) throw new ForbiddenError('Cannot request access to your own vault');

      const grantor = db.prepare('SELECT id FROM users WHERE id = ?').get(grantor_id);
      if (!grantor) throw new NotFoundError('User', grantor_id);

      // Get wait_days from grantor settings (default 3)
      const setting = db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?')
        .get(grantor_id, 'emergency_wait_days');
      const waitDays = setting ? parseInt(setting.value, 10) : 3;

      const request = repo.create(grantor_id, req.userId, waitDays);

      audit.log({
        userId: req.userId,
        action: 'emergency.request',
        resource: 'emergency_access',
        resourceId: request.id,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.status(201).json(request);
    } catch (err) { next(err); }
  });

  // GET /requests — list my requests (as grantor or grantee)
  router.get('/requests', (req, res, next) => {
    try {
      const requests = repo.findByUser(req.userId);
      res.json(requests);
    } catch (err) { next(err); }
  });

  // PUT /:id/approve — grantor approves (or admin overrides wait period)
  router.put('/:id/approve', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const request = repo.findById(id);
      if (!request) throw new NotFoundError('Emergency request', id);

      if (request.status !== 'pending') {
        return res.status(400).json({ error: 'Request is not pending' });
      }

      if (request.grantor_id !== req.userId && req.userRole !== 'admin') {
        throw new ForbiddenError('Only the grantor or admin can approve');
      }

      // Check wait period (admin can override)
      if (req.userRole !== 'admin') {
        const requestedAt = new Date(request.requested_at + 'Z');
        const waitUntil = new Date(requestedAt.getTime() + request.wait_days * 24 * 60 * 60 * 1000);
        if (new Date() < waitUntil) {
          return res.status(400).json({
            error: 'Wait period has not elapsed',
            wait_until: waitUntil.toISOString(),
          });
        }
      }

      const updated = repo.approve(id);

      audit.log({
        userId: req.userId,
        action: 'emergency.approve',
        resource: 'emergency_access',
        resourceId: id,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.json(updated);
    } catch (err) { next(err); }
  });

  // PUT /:id/reject — grantor rejects
  router.put('/:id/reject', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const request = repo.findById(id);
      if (!request) throw new NotFoundError('Emergency request', id);

      if (request.status !== 'pending') {
        return res.status(400).json({ error: 'Request is not pending' });
      }

      if (request.grantor_id !== req.userId && req.userRole !== 'admin') {
        throw new ForbiddenError('Only the grantor or admin can reject');
      }

      const updated = repo.reject(id);

      audit.log({
        userId: req.userId,
        action: 'emergency.reject',
        resource: 'emergency_access',
        resourceId: id,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.json(updated);
    } catch (err) { next(err); }
  });

  // DELETE /:id — cancel request (by grantee or admin)
  router.delete('/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const request = repo.findById(id);
      if (!request) throw new NotFoundError('Emergency request', id);

      if (request.grantee_id !== req.userId && req.userRole !== 'admin') {
        throw new ForbiddenError('Only the requester or admin can cancel');
      }

      repo.cancel(id);

      audit.log({
        userId: req.userId,
        action: 'emergency.cancel',
        resource: 'emergency_access',
        resourceId: id,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
};
