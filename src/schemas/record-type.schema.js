'use strict';

const { z } = require('zod');

const FIELD_TYPES = [
  'text', 'password', 'date', 'number', 'phone',
  'email', 'url', 'select', 'textarea', 'file', 'hidden', 'toggle',
];

const createRecordTypeSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().optional(),
  description: z.string().optional(),
});

const updateRecordTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
});

const addFieldSchema = z.object({
  name: z.string().min(1).max(100),
  field_type: z.enum(FIELD_TYPES),
  options: z.any().optional(),
  required: z.boolean().optional(),
});

const updateFieldSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  field_type: z.enum(FIELD_TYPES).optional(),
  options: z.any().optional(),
  required: z.boolean().optional(),
});

module.exports = { createRecordTypeSchema, updateRecordTypeSchema, addFieldSchema, updateFieldSchema, FIELD_TYPES };
