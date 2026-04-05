'use strict';

const fs = require('fs');
const path = require('path');

function createBackup(db, backupDir) {
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `dataflow-backup-${timestamp}.db`);
  db.backup(backupPath);
  return backupPath;
}

function restoreBackup(backupPath, dbDir) {
  if (!fs.existsSync(backupPath)) throw new Error(`Backup file not found: ${backupPath}`);
  const destPath = path.join(dbDir, 'dataflow.db');
  fs.copyFileSync(backupPath, destPath);
  // Remove WAL/SHM files if they exist
  try { fs.unlinkSync(destPath + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(destPath + '-shm'); } catch { /* ignore */ }
  return destPath;
}

function getBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter(f => f.startsWith('dataflow-backup-') && f.endsWith('.db'))
    .map(f => ({
      name: f,
      path: path.join(backupDir, f),
      size: fs.statSync(path.join(backupDir, f)).size,
      created: fs.statSync(path.join(backupDir, f)).mtime,
    }))
    .sort((a, b) => b.created - a.created);
}

function autoCleanBackups(backupDir, keep = 7) {
  const backups = getBackups(backupDir);
  const toDelete = backups.slice(keep);
  for (const b of toDelete) {
    try { fs.unlinkSync(b.path); } catch { /* ignore */ }
  }
  return toDelete.length;
}

module.exports = { createBackup, restoreBackup, getBackups, autoCleanBackups };
