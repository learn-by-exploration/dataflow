'use strict';

const { z } = require('zod');

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color');

const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: hexColor.optional(),
});

const updateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: hexColor.optional(),
});

module.exports = { createTagSchema, updateTagSchema };
