'use strict';

const { z } = require('zod');

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  display_name: z.string().min(1).max(100),
  master_password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  master_password: z.string().min(1),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(128),
  current_master_password: z.string().min(1),
  new_master_password: z.string().min(8).max(128),
});

module.exports = { registerSchema, loginSchema, changePasswordSchema };
