'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Compute SHA-256 checksum of a file.
 */
function computeChecksum(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Create a checksum companion file for a backup.
 */
function createChecksumFile(backupPath) {
  const checksum = computeChecksum(backupPath);
  const checksumPath = backupPath + '.sha256';
  fs.writeFileSync(checksumPath, checksum + '  ' + path.basename(backupPath) + '\n');
  return { checksum, checksumPath };
}

/**
 * Verify a backup file against its stored checksum.
 * Returns { valid, backupPath, expected, actual, error? }
 */
function verifyBackup(backupPath) {
  const checksumPath = backupPath + '.sha256';
  if (!fs.existsSync(backupPath)) {
    return { valid: false, backupPath, error: 'Backup file not found' };
  }
  if (!fs.existsSync(checksumPath)) {
    return { valid: false, backupPath, error: 'Checksum file not found' };
  }

  const content = fs.readFileSync(checksumPath, 'utf8').trim();
  const expected = content.split(/\s+/)[0];
  const actual = computeChecksum(backupPath);

  return {
    valid: expected === actual,
    backupPath,
    expected,
    actual,
  };
}

/**
 * Verify all backups in a directory.
 */
function verifyAllBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];

  const backupFiles = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('dataflow-backup-') && f.endsWith('.db'));

  return backupFiles.map(f => verifyBackup(path.join(backupDir, f)));
}

module.exports = { computeChecksum, createChecksumFile, verifyBackup, verifyAllBackups };
