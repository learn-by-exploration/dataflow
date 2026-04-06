'use strict';

const { zeroBuffer } = require('./encryption');

class SessionVault {
  constructor() {
    this._store = new Map();
  }

  /**
   * Store vault key for a session.
   * @param {string} sid - session ID
   * @param {Buffer} vaultKey - 32-byte vault key
   * @param {number} userId
   */
  setVaultKey(sid, vaultKey, userId) {
    this._store.set(sid, {
      vaultKey: Buffer.from(vaultKey),  // clone to prevent caller's zeroBuffer from destroying our copy
      lastActivity: Date.now(),
      userId,
    });
  }

  /**
   * Get vault key for a session. Returns null if not found or expired.
   * Updates lastActivity on access.
   * @param {string} sid
   * @returns {Buffer|null}
   */
  getVaultKey(sid) {
    const entry = this._store.get(sid);
    if (!entry) return null;
    entry.lastActivity = Date.now();
    return entry.vaultKey;
  }

  /**
   * Get vault key by user ID (finds any active session for that user).
   * @param {number} userId
   * @returns {Buffer|null}
   */
  getVaultKeyByUserId(userId) {
    for (const entry of this._store.values()) {
      if (entry.userId === userId && entry.vaultKey && !entry.vaultKey.every(b => b === 0)) {
        entry.lastActivity = Date.now();
        return entry.vaultKey;
      }
    }
    return null;
  }

  /**
   * Clear vault key for a session (zeros memory).
   * @param {string} sid
   */
  clearVaultKey(sid) {
    const entry = this._store.get(sid);
    if (entry) {
      zeroBuffer(entry.vaultKey);
      this._store.delete(sid);
    }
  }

  /**
   * Clear all vault keys for a user (zeros memory, deletes entries).
   * @param {number} userId
   */
  clearByUserId(userId) {
    for (const [sid, entry] of this._store.entries()) {
      if (entry.userId === userId) {
        zeroBuffer(entry.vaultKey);
        this._store.delete(sid);
      }
    }
  }

  /**
   * Clear all expired vault keys.
   * @param {number} timeoutMs - inactivity timeout in ms
   */
  clearExpired(timeoutMs) {
    const now = Date.now();
    for (const [sid, entry] of this._store.entries()) {
      if (now - entry.lastActivity > timeoutMs) {
        zeroBuffer(entry.vaultKey);
        this._store.delete(sid);
      }
    }
  }

  /**
   * Clear all vault keys (shutdown).
   */
  clearAll() {
    for (const [, entry] of this._store.entries()) {
      zeroBuffer(entry.vaultKey);
    }
    this._store.clear();
  }

  get size() {
    return this._store.size;
  }
}

// Singleton instance
const sessionVault = new SessionVault();

module.exports = sessionVault;
