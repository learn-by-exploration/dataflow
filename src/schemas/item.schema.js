'use strict';

const { z } = require('zod');

const createItemSchema = z.object({
  category_id: z.number().int().positive(),
  record_type_id: z.number().int().positive(),
  title: z.string().min(1).max(500),
  notes: z.string().optional(),
  fields: z.array(z.object({
    field_def_id: z.number().int().positive(),
    value: z.string(),
  })).optional(),
  tags: z.array(z.number().int().positive()).optional(),
  favorite: z.boolean().optional(),
});

const updateItemSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().optional(),
  category_id: z.number().int().positive().optional(),
  fields: z.array(z.object({
    field_def_id: z.number().int().positive(),
    value: z.string(),
  })).optional(),
  tags: z.array(z.number().int().positive()).optional(),
  favorite: z.boolean().optional(),
});

const bulkItemSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  action: z.enum(['delete', 'move']),
  category_id: z.number().int().positive().optional(),
}).refine(
  (data) => data.action !== 'move' || data.category_id != null,
  { message: 'category_id is required for move action', path: ['category_id'] }
);

module.exports = { createItemSchema, updateItemSchema, bulkItemSchema };
