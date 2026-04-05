'use strict';

const createCategoryRepo = require('../repositories/category.repository');
const { ValidationError } = require('../errors');

function createCategoryService(db, audit) {
  const repo = createCategoryRepo(db);

  return {
    findAll(userId) {
      return repo.findAll(userId);
    },

    findById(id, userId) {
      return repo.findById(id, userId);
    },

    create(userId, data) {
      if (!data.name || data.name.trim().length === 0) {
        throw new ValidationError('Category name is required');
      }
      return repo.create(userId, { ...data, name: data.name.trim() });
    },

    update(id, userId, data) {
      if (data.name !== undefined && data.name.trim().length === 0) {
        throw new ValidationError('Category name cannot be empty');
      }
      const updateData = { ...data };
      if (updateData.name) updateData.name = updateData.name.trim();
      return repo.update(id, userId, updateData);
    },

    delete(id, userId) {
      repo.delete(id, userId);
      if (audit) {
        audit.log({ userId, action: 'category.delete', resource: 'category', resourceId: id });
      }
    },

    reorder(userId, orderedIds) {
      repo.reorder(userId, orderedIds);
    },
  };
}

module.exports = createCategoryService;
