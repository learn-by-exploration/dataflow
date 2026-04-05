'use strict';

const { z } = require('zod');

const inviteSchema = z.object({
  email: z.string().email().max(255),
  display_name: z.string().min(1).max(100),
  role: z.enum(['admin', 'adult', 'child', 'guest']),
  password: z.string().min(8).max(128),
  master_password: z.string().min(12).max(128),
});

const updateMemberSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  role: z.enum(['admin', 'adult', 'child', 'guest']).optional(),
});

module.exports = { inviteSchema, updateMemberSchema };
