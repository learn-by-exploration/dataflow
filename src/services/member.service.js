'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { ConflictError, ForbiddenError } = require('../errors');
const { deriveKey, generateVaultKey, wrapVaultKey, zeroBuffer } = require('./encryption');
const createMemberRepo = require('../repositories/member.repository');
const createSessionRepo = require('../repositories/session.repository');
const createAuthRepo = require('../repositories/auth.repository');

function createMemberService(db, audit) {
  const memberRepo = createMemberRepo(db);
  const sessionRepo = createSessionRepo(db);
  const authRepo = createAuthRepo(db);

  return {
    findAll(userRole) {
      if (['admin', 'adult'].includes(userRole)) {
        return memberRepo.findAll();
      }
      return memberRepo.findAllBasic();
    },

    findById(id) {
      return memberRepo.findById(id);
    },

    async invite(adminUserId, { email, displayName, role, password, masterPassword }, meta = {}) {
      const existing = authRepo.findUserByEmail(email);
      if (existing) throw new ConflictError('Email already registered');

      const passwordHash = await bcrypt.hash(password, config.isTest ? 4 : config.auth.saltRounds);

      const salt = crypto.randomBytes(32);
      const params = {
        memoryCost: config.isTest ? 1024 : config.argon2.memoryCost,
        timeCost: config.isTest ? 1 : config.argon2.timeCost,
        parallelism: config.argon2.parallelism,
      };
      const derivedKey = await deriveKey(masterPassword, salt, params);
      const vaultKey = generateVaultKey();
      const wrapped = wrapVaultKey(vaultKey, derivedKey);

      const user = authRepo.createUser({
        email,
        passwordHash,
        displayName,
        role,
        masterKeySalt: salt.toString('hex'),
        masterKeyParams: JSON.stringify(params),
        vaultKeyEncrypted: JSON.stringify(wrapped),
      });

      zeroBuffer(derivedKey);
      zeroBuffer(vaultKey);

      if (audit) {
        audit.log({
          userId: adminUserId,
          action: 'member.invite',
          resource: 'user',
          resourceId: user.id,
          ip: meta.ip,
          ua: meta.ua,
        });
      }

      return { id: user.id, email, display_name: displayName, role, active: 1 };
    },

    update(requesterId, requesterRole, memberId, updates) {
      const member = memberRepo.findByIdMinimal(memberId);

      const fields = {};

      if (updates.role !== undefined) {
        if (requesterRole !== 'admin') throw new ForbiddenError('Only admin can change roles');
        fields.role = updates.role;
      }

      if (updates.display_name !== undefined) {
        if (requesterId !== memberId && requesterRole !== 'admin') {
          throw new ForbiddenError("Cannot update another member's profile");
        }
        fields.display_name = updates.display_name;
      }

      if (Object.keys(fields).length > 0) {
        return memberRepo.update(memberId, fields);
      }
      return memberRepo.findById(memberId);
    },

    deactivate(adminUserId, memberId, meta = {}) {
      memberRepo.findByIdMinimal(memberId); // ensure exists
      if (memberId === adminUserId) throw new ForbiddenError('Cannot deactivate yourself');

      memberRepo.deactivate(memberId);
      sessionRepo.deleteUserSessions(memberId);

      if (audit) {
        audit.log({
          userId: adminUserId,
          action: 'member.deactivate',
          resource: 'user',
          resourceId: memberId,
          ip: meta.ip,
          ua: meta.ua,
        });
      }

      return memberRepo.findById(memberId);
    },

    activate(adminUserId, memberId, meta = {}) {
      memberRepo.findByIdMinimal(memberId); // ensure exists

      memberRepo.activate(memberId);

      if (audit) {
        audit.log({
          userId: adminUserId,
          action: 'member.activate',
          resource: 'user',
          resourceId: memberId,
          ip: meta.ip,
          ua: meta.ua,
        });
      }

      return memberRepo.findById(memberId);
    },

    delete(adminUserId, memberId, meta = {}) {
      memberRepo.findByIdMinimal(memberId); // ensure exists
      if (memberId === adminUserId) throw new ForbiddenError('Cannot delete yourself');

      memberRepo.hardDelete(memberId);

      if (audit) {
        audit.log({
          userId: adminUserId,
          action: 'member.delete',
          resource: 'user',
          resourceId: memberId,
          ip: meta.ip,
          ua: meta.ua,
        });
      }
    },
  };
}

module.exports = createMemberService;
