'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { UnauthorizedError, ConflictError } = require('../errors');
const { deriveKey, generateVaultKey, wrapVaultKey, unwrapVaultKey, zeroBuffer } = require('./encryption');
const sessionVault = require('./session-vault');
const createAuthRepo = require('../repositories/auth.repository');
const createSessionRepo = require('../repositories/session.repository');

function createAuthService(db, audit) {
  const authRepo = createAuthRepo(db);
  const sessionRepo = createSessionRepo(db);

  return {
    async register({ email, password, displayName, masterPassword }) {
      const existing = authRepo.findUserByEmail(email);
      if (existing) throw new ConflictError('Email already registered');

      const userCount = authRepo.getUserCount();
      const role = userCount === 0 ? 'admin' : 'adult';

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

      const sid = crypto.randomBytes(32).toString('hex');
      sessionRepo.createSession(sid, user.id, config.session.maxAgeDays);

      sessionVault.setVaultKey(sid, vaultKey, user.id);

      zeroBuffer(derivedKey);
      zeroBuffer(vaultKey);

      return { user, sid };
    },

    async login({ email, password, masterPassword }) {
      // Check lockout
      const attempt = authRepo.findLoginAttempt(email);
      if (attempt && attempt.locked_until) {
        const lockedUntil = new Date(attempt.locked_until);
        if (lockedUntil > new Date()) {
          throw new UnauthorizedError('Account temporarily locked. Try again later.');
        }
        authRepo.deleteLoginAttempt(email);
      }

      const user = authRepo.findUserByEmail(email);
      if (!user) {
        this.recordFailedAttempt(email);
        throw new UnauthorizedError('Invalid email or password');
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        this.recordFailedAttempt(email);
        throw new UnauthorizedError('Invalid email or password');
      }

      authRepo.deleteLoginAttempt(email);

      const salt = Buffer.from(user.master_key_salt, 'hex');
      const params = JSON.parse(user.master_key_params);
      const derivedKey = await deriveKey(masterPassword, salt, params);

      const wrapped = JSON.parse(user.vault_key_encrypted);
      let vaultKey;
      try {
        vaultKey = unwrapVaultKey(wrapped, derivedKey);
      } catch (_e) {
        zeroBuffer(derivedKey);
        throw new UnauthorizedError('Invalid master password');
      }
      zeroBuffer(derivedKey);

      const sid = crypto.randomBytes(32).toString('hex');
      sessionRepo.createSession(sid, user.id, config.session.maxAgeDays);

      sessionVault.setVaultKey(sid, vaultKey, user.id);

      return {
        user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
        sid,
      };
    },

    logout(sid) {
      // Get user ID before clearing, to clear all their vault keys
      const session = sessionRepo.findValidSession(sid);
      if (session) {
        sessionVault.clearByUserId(session.user_id);
      } else {
        sessionVault.clearVaultKey(sid);
      }
      sessionRepo.deleteSession(sid);
    },

    getSession(sid) {
      if (!sid) return null;
      const session = sessionRepo.findValidSession(sid);
      if (!session) return null;

      const user = authRepo.findUserById(session.user_id);
      if (!user) return null;

      return {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
      };
    },

    async changePassword(sid, { currentPassword, newPassword, currentMasterPassword, newMasterPassword }) {
      const session = sessionRepo.findValidSession(sid);
      if (!session) throw new UnauthorizedError();

      const user = authRepo.findUserById(session.user_id);
      if (!user) throw new UnauthorizedError();

      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) throw new UnauthorizedError('Current password is incorrect');

      // Derive old vault key
      const oldSalt = Buffer.from(user.master_key_salt, 'hex');
      const oldParams = JSON.parse(user.master_key_params);
      const oldDerivedKey = await deriveKey(currentMasterPassword, oldSalt, oldParams);

      const oldWrapped = JSON.parse(user.vault_key_encrypted);
      let vaultKey;
      try {
        vaultKey = unwrapVaultKey(oldWrapped, oldDerivedKey);
      } catch (_e) {
        zeroBuffer(oldDerivedKey);
        throw new UnauthorizedError('Current master password is incorrect');
      }
      zeroBuffer(oldDerivedKey);

      // Hash new login password
      const newPasswordHash = await bcrypt.hash(newPassword, config.isTest ? 4 : config.auth.saltRounds);

      // Derive new encryption key
      const newSalt = crypto.randomBytes(32);
      const newParams = {
        memoryCost: config.isTest ? 1024 : config.argon2.memoryCost,
        timeCost: config.isTest ? 1 : config.argon2.timeCost,
        parallelism: config.argon2.parallelism,
      };
      const newDerivedKey = await deriveKey(newMasterPassword, newSalt, newParams);

      const newWrapped = wrapVaultKey(vaultKey, newDerivedKey);
      zeroBuffer(newDerivedKey);

      authRepo.updateUserPassword(user.id, {
        passwordHash: newPasswordHash,
        masterKeySalt: newSalt.toString('hex'),
        masterKeyParams: JSON.stringify(newParams),
        vaultKeyEncrypted: JSON.stringify(newWrapped),
      });

      sessionVault.setVaultKey(sid, vaultKey, user.id);

      return { ok: true };
    },

    recordFailedAttempt(email) {
      const attempt = authRepo.findLoginAttempt(email);
      const now = new Date().toISOString();

      if (!attempt) {
        authRepo.createLoginAttempt(email, now);
        return;
      }

      const windowMs = 15 * 60 * 1000;
      const firstAttempt = new Date(attempt.first_attempt_at + 'Z');
      if (Date.now() - firstAttempt.getTime() > windowMs) {
        authRepo.resetLoginAttempt(email, now);
        return;
      }

      const newAttempts = attempt.attempts + 1;
      if (newAttempts >= 5) {
        const lockedUntil = new Date(Date.now() + windowMs).toISOString();
        authRepo.incrementLoginAttempt(email, newAttempts, lockedUntil);
      } else {
        authRepo.incrementLoginAttempt(email, newAttempts);
      }
    },
  };
}

module.exports = createAuthService;
