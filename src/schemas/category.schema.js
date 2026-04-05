'use strict';

const { z } = require('zod');

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color');

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().optional(),
  color: hexColor.optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().optional(),
  color: hexColor.optional(),
});

module.exports = { createCategorySchema, updateCategorySchema };
