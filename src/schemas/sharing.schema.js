'use strict';

const { z } = require('zod');

const shareItemSchema = z.object({
  user_id: z.number().int().positive(),
  permission: z.enum(['read', 'write']),
  expires_at: z.string().optional(),
});

module.exports = { shareItemSchema };
