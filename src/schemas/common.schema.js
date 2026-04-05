'use strict';

const { z } = require('zod');

const idParam = z.object({
  id: z.coerce.number().int().positive(),
});

const positiveInt = z.coerce.number().int().positive();

const pagination = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const reorderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

module.exports = { idParam, positiveInt, pagination, reorderSchema };
