'use strict';

const { z } = require('zod');

/** Refinement: reject null bytes in strings */
const noNullBytes = (s) => !s.includes('\0');
const noNullMsg = 'Invalid characters';

/** Transform: NFC normalize email, then validate format */
const nfcEmail = z.string().max(255)
  .refine(noNullBytes, noNullMsg)
  .transform(s => s.normalize('NFC'))
  .pipe(z.string().email());

const safeStr = (min, max) => z.string().min(min).max(max).refine(noNullBytes, noNullMsg);

const registerSchema = z.object({
  email: nfcEmail,
  password: safeStr(8, 128),
  display_name: safeStr(1, 100),
  master_password: safeStr(8, 128),
});

const loginSchema = z.object({
  email: nfcEmail,
  password: z.string().min(1).refine(noNullBytes, noNullMsg),
  master_password: z.string().min(1).refine(noNullBytes, noNullMsg),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1).refine(noNullBytes, noNullMsg),
  new_password: safeStr(8, 128),
  current_master_password: z.string().min(1).refine(noNullBytes, noNullMsg),
  new_master_password: safeStr(8, 128),
});

module.exports = { registerSchema, loginSchema, changePasswordSchema };
