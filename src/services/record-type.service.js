'use strict';

const createRecordTypeRepo = require('../repositories/record-type.repository');
const { ForbiddenError, ValidationError } = require('../errors');
const { FIELD_TYPES } = require('../schemas/record-type.schema');

function createRecordTypeService(db, audit) {
  const repo = createRecordTypeRepo(db);

  return {
    findAll(userId) {
      return repo.findAll(userId);
    },

    findById(id) {
      return repo.findById(id);
    },

    create(userId, data) {
      if (!data.name || data.name.trim().length === 0) {
        throw new ValidationError('Record type name is required');
      }
      return repo.create(userId, { ...data, name: data.name.trim() });
    },

    update(id, userId, data) {
      const existing = repo.findById(id);
      if (existing.is_builtin) throw new ForbiddenError('Cannot modify built-in record type');
      if (data.name !== undefined && data.name.trim().length === 0) {
        throw new ValidationError('Record type name cannot be empty');
      }
      const updateData = { ...data };
      if (updateData.name) updateData.name = updateData.name.trim();
      return repo.update(id, userId, updateData);
    },

    delete(id, userId) {
      const existing = repo.findById(id);
      if (existing.is_builtin) throw new ForbiddenError('Cannot delete built-in record type');
      repo.delete(id, userId);
      if (audit) {
        audit.log({ userId, action: 'record_type.delete', resource: 'record_type', resourceId: id });
      }
    },

    findFields(recordTypeId) {
      return repo.findFields(recordTypeId);
    },

    addField(recordTypeId, data) {
      if (!FIELD_TYPES.includes(data.field_type)) {
        throw new ValidationError(`Invalid field type: ${data.field_type}`);
      }
      return repo.addField(recordTypeId, data);
    },

    updateField(id, data) {
      if (data.field_type && !FIELD_TYPES.includes(data.field_type)) {
        throw new ValidationError(`Invalid field type: ${data.field_type}`);
      }
      return repo.updateField(id, data);
    },

    deleteField(id) {
      repo.deleteField(id);
    },

    reorderFields(recordTypeId, orderedIds) {
      repo.reorderFields(recordTypeId, orderedIds);
    },
  };
}

module.exports = createRecordTypeService;
