'use strict';

const createItemRepo = require('../repositories/item.repository');
const createItemFieldRepo = require('../repositories/item-field.repository');
const createTagRepo = require('../repositories/tag.repository');
const { encrypt, decrypt, computeSortKey } = require('./encryption');

function createItemService(db, audit) {
  const itemRepo = createItemRepo(db);
  const fieldRepo = createItemFieldRepo(db);
  const tagRepo = createTagRepo(db);

  function encryptField(value, vaultKey) {
    const result = encrypt(value, vaultKey);
    return { value_encrypted: result.ciphertext, value_iv: result.iv, value_tag: result.tag };
  }

  function decryptField(encrypted, iv, tag, vaultKey) {
    if (!encrypted) return null;
    return decrypt(encrypted, iv, tag, vaultKey);
  }

  function decryptItem(item, vaultKey) {
    return {
      ...item,
      title: decryptField(item.title_encrypted, item.title_iv, item.title_tag, vaultKey),
      notes: decryptField(item.notes_encrypted, item.notes_iv, item.notes_tag, vaultKey),
    };
  }

  return {
    create(userId, vaultKey, { title, notes, category_id, record_type_id, fields, tags, favorite }) {
      const titleEnc = encryptField(title, vaultKey);
      const notesEnc = notes ? encryptField(notes, vaultKey) : {};
      const titleSortKey = computeSortKey(title, vaultKey);

      const txn = db.transaction(() => {
        const item = itemRepo.create(userId, {
          category_id,
          record_type_id,
          title_encrypted: titleEnc.value_encrypted,
          title_iv: titleEnc.value_iv,
          title_tag: titleEnc.value_tag,
          notes_encrypted: notesEnc.value_encrypted || null,
          notes_iv: notesEnc.value_iv || null,
          notes_tag: notesEnc.value_tag || null,
          favorite: favorite || false,
          title_sort_key: titleSortKey,
        });

        if (fields && fields.length > 0) {
          const encFields = fields.map(f => {
            const enc = encryptField(f.value, vaultKey);
            return { field_def_id: f.field_def_id, ...enc };
          });
          fieldRepo.bulkCreate(item.id, encFields);
        }

        if (tags && tags.length > 0) {
          for (const tagId of tags) {
            tagRepo.linkItem(item.id, tagId);
          }
        }

        return item;
      });

      const item = txn();

      if (audit) {
        audit.log({ userId, action: 'item.create', resource: 'item', resourceId: item.id });
      }

      return this.findById(item.id, userId, vaultKey);
    },

    findAll(userId, vaultKey, filters = {}) {
      const { page = 1, limit = 20, ...rest } = filters;
      const offset = (page - 1) * limit;
      const items = itemRepo.findAll(userId, { ...rest, limit, offset });
      return items.map(item => {
        const decrypted = decryptItem(item, vaultKey);
        const itemFields = fieldRepo.findByItem(item.id).map(f => ({
          ...f,
          value: decryptField(f.value_encrypted, f.value_iv, f.value_tag, vaultKey),
        }));
        const itemTags = tagRepo.findByItem(item.id);
        return { ...decrypted, fields: itemFields, tags: itemTags };
      });
    },

    findById(id, userId, vaultKey) {
      const item = itemRepo.findById(id, userId);
      const decrypted = decryptItem(item, vaultKey);
      const fields = fieldRepo.findByItem(item.id).map(f => ({
        ...f,
        value: decryptField(f.value_encrypted, f.value_iv, f.value_tag, vaultKey),
      }));
      const tags = tagRepo.findByItem(item.id);
      return { ...decrypted, fields, tags };
    },

    update(id, userId, vaultKey, data) {
      const txn = db.transaction(() => {
        const updateData = {};

        if (data.title !== undefined) {
          const enc = encryptField(data.title, vaultKey);
          updateData.title_encrypted = enc.value_encrypted;
          updateData.title_iv = enc.value_iv;
          updateData.title_tag = enc.value_tag;
          updateData.title_sort_key = computeSortKey(data.title, vaultKey);
        }

        if (data.notes !== undefined) {
          if (data.notes) {
            const enc = encryptField(data.notes, vaultKey);
            updateData.notes_encrypted = enc.value_encrypted;
            updateData.notes_iv = enc.value_iv;
            updateData.notes_tag = enc.value_tag;
          } else {
            updateData.notes_encrypted = null;
            updateData.notes_iv = null;
            updateData.notes_tag = null;
          }
        }

        if (data.category_id !== undefined) updateData.category_id = data.category_id;
        if (data.favorite !== undefined) updateData.favorite = data.favorite;

        itemRepo.update(id, userId, updateData);

        if (data.fields !== undefined) {
          fieldRepo.deleteByItem(id);
          if (data.fields.length > 0) {
            const encFields = data.fields.map(f => {
              const enc = encryptField(f.value, vaultKey);
              return { field_def_id: f.field_def_id, ...enc };
            });
            fieldRepo.bulkCreate(id, encFields);
          }
        }

        if (data.tags !== undefined) {
          tagRepo.unlinkAllFromItem(id);
          for (const tagId of data.tags) {
            tagRepo.linkItem(id, tagId);
          }
        }
      });

      txn();

      if (audit) {
        audit.log({ userId, action: 'item.update', resource: 'item', resourceId: id });
      }

      return this.findById(id, userId, vaultKey);
    },

    delete(id, userId) {
      itemRepo.delete(id, userId);
      if (audit) {
        audit.log({ userId, action: 'item.delete', resource: 'item', resourceId: id });
      }
    },

    bulkDelete(userId, ids) {
      itemRepo.bulkDelete(userId, ids);
      if (audit) {
        audit.log({ userId, action: 'item.bulk_delete', resource: 'item', detail: JSON.stringify({ ids }) });
      }
    },

    bulkMove(userId, ids, categoryId) {
      itemRepo.bulkMove(userId, ids, categoryId);
      if (audit) {
        audit.log({ userId, action: 'item.bulk_move', resource: 'item', detail: JSON.stringify({ ids, categoryId }) });
      }
    },

    countByUser(userId) {
      return itemRepo.countByUser(userId);
    },
  };
}

module.exports = createItemService;
