'use strict';

const crypto = require('crypto');
const createItemRepo = require('../repositories/item.repository');
const createItemFieldRepo = require('../repositories/item-field.repository');
const createTagRepo = require('../repositories/tag.repository');
const createHistoryRepo = require('../repositories/history.repository');
const { encrypt, decrypt, computeSortKey } = require('./encryption');
const { scorePassword } = require('./password-strength');

function createItemService(db, audit) {
  const itemRepo = createItemRepo(db);
  let historyRepo;
  try { historyRepo = createHistoryRepo(db); } catch { historyRepo = null; }
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
    create(userId, vaultKey, { title, notes, category_id, record_type_id, fields, tags, favorite, encrypted, title_encrypted, notes_encrypted: notesEncPayload }) {
      let titleEnc, notesEnc, titleSortKey, clientEncrypted;

      if (encrypted) {
        // Client-encrypted: store encrypted payloads directly, no server-side encryption
        titleEnc = title_encrypted || {};
        notesEnc = notesEncPayload || {};
        titleSortKey = null;
        clientEncrypted = true;
      } else {
        titleEnc = encryptField(title, vaultKey);
        notesEnc = notes ? encryptField(notes, vaultKey) : {};
        titleSortKey = computeSortKey(title, vaultKey);
        clientEncrypted = false;
      }

      const txn = db.transaction(() => {
        const item = itemRepo.create(userId, {
          category_id,
          record_type_id,
          title_encrypted: titleEnc.value_encrypted || titleEnc.ciphertext,
          title_iv: titleEnc.value_iv || titleEnc.iv,
          title_tag: titleEnc.value_tag || titleEnc.tag,
          notes_encrypted: notesEnc.value_encrypted || notesEnc.ciphertext || null,
          notes_iv: notesEnc.value_iv || notesEnc.iv || null,
          notes_tag: notesEnc.value_tag || notesEnc.tag || null,
          favorite: favorite || false,
          title_sort_key: titleSortKey,
          client_encrypted: clientEncrypted,
        });

        if (fields && fields.length > 0) {
          const encFields = fields.map(f => {
            if (clientEncrypted) {
              return { field_def_id: f.field_def_id, value_encrypted: f.value_encrypted, value_iv: f.value_iv, value_tag: f.value_tag };
            }
            const enc = encryptField(f.value, vaultKey);
            // Check if this is a password field and compute strength
            let strength_score = null;
            let password_last_changed = null;
            if (f.field_def_id) {
              const fieldDef = db.prepare('SELECT field_type FROM record_type_fields WHERE id = ?').get(f.field_def_id);
              if (fieldDef && fieldDef.field_type === 'password' && f.value) {
                strength_score = scorePassword(f.value);
                password_last_changed = new Date().toISOString();
              }
            }
            return { field_def_id: f.field_def_id, ...enc, strength_score, password_last_changed };
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

      const result = this.findById(item.id, userId, vaultKey);

      // Duplicate detection: check for existing items with same title + record_type_id
      if (title && record_type_id) {
        const hash = crypto.createHmac('sha256', 'dataflow-dedup').update(title + ':' + record_type_id).digest('hex');
        const existing = db.prepare(
          'SELECT i.id FROM items i WHERE i.user_id = ? AND i.id != ? AND i.record_type_id = ? AND i.deleted_at IS NULL'
        ).all(userId, item.id, record_type_id);
        for (const ex of existing) {
          // Decrypt existing item title to compare
          try {
            const exItem = this.findById(ex.id, userId, vaultKey);
            if (exItem.title === title) {
              result.possibleDuplicate = { id: ex.id, title: exItem.title };
              break;
            }
          } catch { /* skip */ }
        }
      }

      return result;
    },

    findAll(userId, vaultKey, filters = {}) {
      const { page = 1, limit = 20, ...rest } = filters;
      const offset = (page - 1) * limit;
      const items = itemRepo.findAll(userId, { ...rest, limit, offset });
      return items.map(item => {
        if (item.client_encrypted) {
          // Client-encrypted: return encrypted payloads as-is
          const itemFields = fieldRepo.findByItem(item.id);
          const itemTags = tagRepo.findByItem(item.id);
          return { ...item, fields: itemFields, tags: itemTags };
        }
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
      if (item.client_encrypted) {
        const fields = fieldRepo.findByItem(item.id);
        const tags = tagRepo.findByItem(item.id);
        return { ...item, fields, tags };
      }
      const decrypted = decryptItem(item, vaultKey);
      const fields = fieldRepo.findByItem(item.id).map(f => ({
        ...f,
        value: decryptField(f.value_encrypted, f.value_iv, f.value_tag, vaultKey),
      }));
      const tags = tagRepo.findByItem(item.id);
      return { ...decrypted, fields, tags };
    },

    update(id, userId, vaultKey, data) {
      // Capture old values for history tracking before the transaction
      let oldItem;
      try { oldItem = itemRepo.findById(id, userId); } catch { oldItem = null; }
      let oldTitle = null;
      if (oldItem && !oldItem.client_encrypted) {
        try { oldTitle = decryptField(oldItem.title_encrypted, oldItem.title_iv, oldItem.title_tag, vaultKey); } catch { /* skip */ }
      }

      const txn = db.transaction(() => {
        const updateData = {};

        if (data.encrypted) {
          // Client-encrypted update: store payloads directly
          if (data.title_encrypted) {
            updateData.title_encrypted = data.title_encrypted.ciphertext;
            updateData.title_iv = data.title_encrypted.iv;
            updateData.title_tag = data.title_encrypted.tag;
          }
          if (data.notes_encrypted) {
            updateData.notes_encrypted = data.notes_encrypted.ciphertext;
            updateData.notes_iv = data.notes_encrypted.iv;
            updateData.notes_tag = data.notes_encrypted.tag;
          }
          updateData.client_encrypted = 1;
        } else {
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
        }

        if (data.category_id !== undefined) updateData.category_id = data.category_id;
        if (data.favorite !== undefined) updateData.favorite = data.favorite;

        itemRepo.update(id, userId, updateData);

        if (data.fields !== undefined) {
          // Get old fields for password change detection
          const oldFields = fieldRepo.findByItem(id);
          fieldRepo.deleteByItem(id);
          if (data.fields.length > 0) {
            const encFields = data.fields.map(f => {
              if (data.encrypted) {
                return { field_def_id: f.field_def_id, value_encrypted: f.value_encrypted, value_iv: f.value_iv, value_tag: f.value_tag };
              }
              const enc = encryptField(f.value, vaultKey);
              // Check if this is a password field and compute strength
              let strength_score = null;
              let password_last_changed = null;
              if (f.field_def_id) {
                const fieldDef = db.prepare('SELECT field_type FROM record_type_fields WHERE id = ?').get(f.field_def_id);
                if (fieldDef && fieldDef.field_type === 'password' && f.value) {
                  strength_score = scorePassword(f.value);
                  // Check if password value changed
                  const oldField = oldFields.find(of => of.field_def_id === f.field_def_id);
                  if (oldField) {
                    try {
                      const oldValue = decryptField(oldField.value_encrypted, oldField.value_iv, oldField.value_tag, vaultKey);
                      password_last_changed = (oldValue !== f.value)
                        ? new Date().toISOString()
                        : (oldField.password_last_changed || new Date().toISOString());
                    } catch {
                      password_last_changed = new Date().toISOString();
                    }
                  } else {
                    password_last_changed = new Date().toISOString();
                  }
                }
              }
              return { field_def_id: f.field_def_id, ...enc, strength_score, password_last_changed };
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

      // Record history for tracked field changes
      if (historyRepo && oldItem) {
        try {
          if (data.title !== undefined && oldTitle !== data.title) {
            historyRepo.create({ item_id: id, field_name: 'title', old_value: oldTitle, new_value: data.title, changed_by: userId });
          }
          if (data.category_id !== undefined && oldItem.category_id !== data.category_id) {
            historyRepo.create({ item_id: id, field_name: 'category_id', old_value: String(oldItem.category_id), new_value: String(data.category_id), changed_by: userId });
          }
          if (data.favorite !== undefined && oldItem.favorite !== (data.favorite ? 1 : 0)) {
            historyRepo.create({ item_id: id, field_name: 'favorite', old_value: String(oldItem.favorite), new_value: String(data.favorite ? 1 : 0), changed_by: userId });
          }
          if (data.notes !== undefined) {
            let oldNotes = null;
            try { oldNotes = decryptField(oldItem.notes_encrypted, oldItem.notes_iv, oldItem.notes_tag, vaultKey); } catch { /* skip */ }
            if (oldNotes !== data.notes) {
              historyRepo.create({ item_id: id, field_name: 'notes', old_value: oldNotes, new_value: data.notes, changed_by: userId });
            }
          }
        } catch { /* history recording is best-effort */ }
      }

      if (audit) {
        audit.log({ userId, action: 'item.update', resource: 'item', resourceId: id });
      }

      return this.findById(id, userId, vaultKey);
    },

    delete(id, userId) {
      itemRepo.softDelete(id, userId);
      if (audit) {
        audit.log({ userId, action: 'item.delete', resource: 'item', resourceId: id });
      }
    },

    softDeleteItem(id, userId) {
      itemRepo.softDelete(id, userId);
      if (audit) {
        audit.log({ userId, action: 'item.soft_delete', resource: 'item', resourceId: id });
      }
    },

    restoreItem(id, userId) {
      const item = itemRepo.restore(id, userId);
      if (!item) return null;
      if (audit) {
        audit.log({ userId, action: 'item.restore', resource: 'item', resourceId: id });
      }
      return item;
    },

    getTrash(userId, vaultKey) {
      const items = itemRepo.findDeleted(userId);
      return items.map(item => {
        if (item.client_encrypted) {
          return item;
        }
        try {
          return decryptItem(item, vaultKey);
        } catch {
          return item;
        }
      });
    },

    emptyTrash(userId) {
      const trashed = itemRepo.findDeleted(userId);
      for (const item of trashed) {
        itemRepo.permanentlyDelete(item.id);
      }
      if (audit) {
        audit.log({ userId, action: 'item.empty_trash', resource: 'item', detail: JSON.stringify({ count: trashed.length }) });
      }
      return trashed.length;
    },

    purgeOldTrash() {
      return itemRepo.purgeOldDeletedItems(30);
    },

    copyItem(id, userId, vaultKey, targetCategoryId) {
      const original = itemRepo.findById(id, userId);
      const decrypted = decryptItem(original, vaultKey);
      const newTitle = (decrypted.title || 'Untitled') + ' (Copy)';
      const titleEnc = encryptField(newTitle, vaultKey);
      const notesEnc = original.notes_encrypted ? encryptField(decrypted.notes || '', vaultKey) : {};
      const titleSortKey = computeSortKey(newTitle, vaultKey);

      const txn = db.transaction(() => {
        const copy = itemRepo.create(userId, {
          category_id: targetCategoryId || original.category_id,
          record_type_id: original.record_type_id,
          title_encrypted: titleEnc.value_encrypted,
          title_iv: titleEnc.value_iv,
          title_tag: titleEnc.value_tag,
          notes_encrypted: notesEnc.value_encrypted || null,
          notes_iv: notesEnc.value_iv || null,
          notes_tag: notesEnc.value_tag || null,
          favorite: 0,
          title_sort_key: titleSortKey,
          client_encrypted: original.client_encrypted,
        });

        // Copy fields with new IVs
        const fields = fieldRepo.findByItem(id);
        if (fields.length > 0) {
          const newFields = fields.map(f => {
            if (original.client_encrypted) {
              return { field_def_id: f.field_def_id, value_encrypted: f.value_encrypted, value_iv: f.value_iv, value_tag: f.value_tag };
            }
            const value = decryptField(f.value_encrypted, f.value_iv, f.value_tag, vaultKey);
            const enc = encryptField(value, vaultKey);
            return { field_def_id: f.field_def_id, ...enc, strength_score: f.strength_score, password_last_changed: f.password_last_changed };
          });
          fieldRepo.bulkCreate(copy.id, newFields);
        }

        // Copy tags
        const itemTags = tagRepo.findByItem(id);
        for (const t of itemTags) {
          tagRepo.linkItem(copy.id, t.id || t.tag_id);
        }

        return copy;
      });

      const copy = txn();
      if (audit) {
        audit.log({ userId, action: 'item.copy', resource: 'item', resourceId: copy.id, detail: JSON.stringify({ originalId: id }) });
      }
      return this.findById(copy.id, userId, vaultKey);
    },

    bulkDelete(userId, ids) {
      itemRepo.bulkDelete(userId, ids);
      if (audit) {
        audit.log({ userId, action: 'item.bulk_delete', resource: 'item', detail: JSON.stringify({ ids }) });
      }
    },

    bulkSoftDelete(userId, ids) {
      // Validate ownership
      for (const id of ids) {
        if (!itemRepo.existsForUser(id, userId)) {
          throw new (require('../errors').ForbiddenError)('Item ' + id + ' not owned by user');
        }
      }
      itemRepo.bulkDelete(userId, ids);
      if (audit) {
        audit.log({ userId, action: 'item.bulk_soft_delete', resource: 'item', detail: JSON.stringify({ ids }) });
      }
    },

    bulkEdit(userId, ids, changes) {
      // Validate ownership
      for (const id of ids) {
        if (!itemRepo.existsForUser(id, userId)) {
          throw new (require('../errors').ForbiddenError)('Item ' + id + ' not owned by user');
        }
      }
      itemRepo.bulkEdit(userId, ids, changes);
      if (audit) {
        audit.log({ userId, action: 'item.bulk_edit', resource: 'item', detail: JSON.stringify({ ids, changes }) });
      }
      return ids.length;
    },

    bulkMove(userId, ids, categoryId) {
      itemRepo.bulkMove(userId, ids, categoryId);
      if (audit) {
        audit.log({ userId, action: 'item.bulk_move', resource: 'item', detail: JSON.stringify({ ids, categoryId }) });
      }
    },

    mergeItems(sourceId, targetId, userId, vaultKey, fieldSelections) {
      const source = this.findById(sourceId, userId, vaultKey);
      const target = this.findById(targetId, userId, vaultKey);

      const mergedFields = [];
      const sourceFields = source.fields || [];
      const targetFields = target.fields || [];

      // Build field map by field_def_id
      const sourceFieldMap = new Map();
      for (const f of sourceFields) {
        if (f.field_def_id) sourceFieldMap.set(f.field_def_id, f);
      }
      const targetFieldMap = new Map();
      for (const f of targetFields) {
        if (f.field_def_id) targetFieldMap.set(f.field_def_id, f);
      }

      // Collect all field_def_ids
      const allFieldIds = new Set([...sourceFieldMap.keys(), ...targetFieldMap.keys()]);

      for (const fid of allFieldIds) {
        const sel = fieldSelections[String(fid)] || 'target';
        const sf = sourceFieldMap.get(fid);
        const tf = targetFieldMap.get(fid);

        if (sel === 'source' && sf) {
          mergedFields.push({ field_def_id: sf.field_def_id, value: sf.value || '' });
        } else if (sel === 'both' && sf && tf) {
          const combined = (tf.value || '') + '\n' + (sf.value || '');
          mergedFields.push({ field_def_id: tf.field_def_id, value: combined.trim() });
        } else if (tf) {
          mergedFields.push({ field_def_id: tf.field_def_id, value: tf.value || '' });
        } else if (sf) {
          mergedFields.push({ field_def_id: sf.field_def_id, value: sf.value || '' });
        }
      }

      // Handle title selection
      const titleSel = fieldSelections.title || 'target';
      let mergedTitle = target.title;
      if (titleSel === 'source') mergedTitle = source.title;
      else if (titleSel === 'both') mergedTitle = (target.title || '') + ' / ' + (source.title || '');

      // Handle notes selection
      const notesSel = fieldSelections.notes || 'target';
      let mergedNotes = target.notes;
      if (notesSel === 'source') mergedNotes = source.notes;
      else if (notesSel === 'both') mergedNotes = ((target.notes || '') + '\n' + (source.notes || '')).trim();

      // Update target with merged data
      this.update(targetId, userId, vaultKey, {
        title: mergedTitle,
        notes: mergedNotes,
        fields: mergedFields,
      });

      // Soft-delete the source
      itemRepo.softDelete(sourceId, userId);

      if (audit) {
        audit.log({ userId, action: 'item.merge', resource: 'item', resourceId: targetId, detail: JSON.stringify({ sourceId, targetId }) });
      }

      return this.findById(targetId, userId, vaultKey);
    },

    countByUser(userId) {
      return itemRepo.countByUser(userId);
    },
  };
}

module.exports = createItemService;
