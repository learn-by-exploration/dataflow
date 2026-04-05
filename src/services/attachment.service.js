'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { encryptFile, decryptFile } = require('./encryption');
const createAttachmentRepo = require('../repositories/attachment.repository');
const { ValidationError } = require('../errors');
const config = require('../config');

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv',
  'application/json',
  'application/zip', 'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
];

function createAttachmentService(db, audit) {
  const repo = createAttachmentRepo(db);

  function getAttachmentsDir() {
    const dir = path.join(config.dbDir, 'attachments');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  return {
    upload(userId, itemId, file, vaultKey) {
      if (!file) throw new ValidationError('No file provided');
      if (file.size > config.maxAttachmentSize) {
        throw new ValidationError(`File too large. Maximum size is ${Math.floor(config.maxAttachmentSize / 1024 / 1024)}MB`);
      }
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        throw new ValidationError(`File type ${file.mimetype} is not allowed`);
      }

      const filename = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
      const attachDir = getAttachmentsDir();
      const encPath = path.join(attachDir, filename);

      const { iv, tag } = encryptFile(file.path, encPath, vaultKey);

      // Remove temp upload file
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }

      const attachment = repo.create({
        item_id: itemId,
        user_id: userId,
        filename,
        original_name: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        encryption_iv: iv,
        encryption_tag: tag,
      });

      if (audit) {
        audit.log({ userId, action: 'attachment.upload', resource: 'attachment', resourceId: attachment.id });
      }

      return attachment;
    },

    download(id, userId, vaultKey) {
      const attachment = repo.findByIdAndUser(id, userId);
      const attachDir = getAttachmentsDir();
      const encPath = path.join(attachDir, attachment.filename);
      const tmpPath = path.join(attachDir, `tmp_${crypto.randomUUID()}`);

      try {
        decryptFile(encPath, tmpPath, attachment.encryption_iv, attachment.encryption_tag, vaultKey);
      } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        throw err;
      }

      return { attachment, decryptedPath: tmpPath };
    },

    delete(id, userId) {
      const attachment = repo.findByIdAndUser(id, userId);
      const attachDir = getAttachmentsDir();
      const encPath = path.join(attachDir, attachment.filename);
      try { fs.unlinkSync(encPath); } catch { /* ignore */ }
      repo.delete(id);

      if (audit) {
        audit.log({ userId, action: 'attachment.delete', resource: 'attachment', resourceId: id });
      }
    },

    findByItem(itemId) {
      return repo.findByItem(itemId);
    },

    countByUser(userId) {
      return repo.countByUser(userId);
    },

    totalSizeByUser(userId) {
      return repo.totalSizeByUser(userId);
    },
  };
}

module.exports = createAttachmentService;
