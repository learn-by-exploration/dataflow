'use strict';

const { z } = require('zod');

const encryptedPayload = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  tag: z.string(),
});

const createItemSchema = z.object({
  category_id: z.number().int().positive(),
  record_type_id: z.number().int().positive(),
  title: z.string().min(1).max(500).optional(),
  notes: z.string().optional(),
  encrypted: z.boolean().optional(),
  title_encrypted: encryptedPayload.optional(),
  notes_encrypted: encryptedPayload.optional(),
  fields: z.array(z.object({
    field_def_id: z.number().int().positive().optional().nullable(),
    value: z.string().optional(),
    value_encrypted: z.string().optional(),
    value_iv: z.string().optional(),
    value_tag: z.string().optional(),
  })).optional(),
  tags: z.array(z.number().int().positive()).optional(),
  favorite: z.boolean().optional(),
}).refine(
  (data) => data.encrypted ? !!data.title_encrypted : !!data.title,
  { message: 'title is required for server-encrypted items, title_encrypted for client-encrypted', path: ['title'] }
);

const updateItemSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().optional(),
  encrypted: z.boolean().optional(),
  title_encrypted: encryptedPayload.optional(),
  notes_encrypted: encryptedPayload.optional(),
  category_id: z.number().int().positive().optional(),
  fields: z.array(z.object({
    field_def_id: z.number().int().positive().optional().nullable(),
    value: z.string().optional(),
    value_encrypted: z.string().optional(),
    value_iv: z.string().optional(),
    value_tag: z.string().optional(),
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
