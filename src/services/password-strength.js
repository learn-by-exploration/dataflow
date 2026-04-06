'use strict';

/**
 * Password strength scoring service.
 * Simple zxcvbn-like scoring without external dependency.
 * Score 0-4: 0=very weak (<20 bits), 1=weak (<40), 2=fair (<60), 3=strong (<80), 4=very strong (80+)
 */

const COMMON_PASSWORDS = new Set([
  'password', '123456', '12345678', 'qwerty', 'abc123', 'monkey', 'master',
  'dragon', 'login', 'princess', 'football', 'shadow', 'sunshine', 'trustno1',
  'iloveyou', 'batman', 'access', 'hello', 'charlie', 'letmein', 'welcome',
  'password1', 'password123', 'admin', 'qwerty123', '1234567890', '123456789',
]);

const SEQUENTIAL_PATTERNS = [
  'abcdefghijklmnopqrstuvwxyz',
  'zyxwvutsrqponmlkjihgfedcba',
  '01234567890',
  '09876543210',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

function hasSequentialChars(pw, minLen) {
  const lower = pw.toLowerCase();
  for (const pattern of SEQUENTIAL_PATTERNS) {
    for (let i = 0; i <= pattern.length - minLen; i++) {
      const seq = pattern.slice(i, i + minLen);
      if (lower.includes(seq)) return true;
    }
  }
  return false;
}

function hasRepeatedChars(pw, minLen) {
  for (let i = 0; i <= pw.length - minLen; i++) {
    const ch = pw[i];
    let count = 1;
    for (let j = i + 1; j < pw.length && pw[j] === ch; j++) count++;
    if (count >= minLen) return true;
  }
  return false;
}

function countCharClasses(pw) {
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^a-zA-Z0-9]/.test(pw)) classes++;
  return classes;
}

function estimateEntropy(pw) {
  if (!pw || pw.length === 0) return 0;

  let poolSize = 0;
  if (/[a-z]/.test(pw)) poolSize += 26;
  if (/[A-Z]/.test(pw)) poolSize += 26;
  if (/[0-9]/.test(pw)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) poolSize += 32;

  if (poolSize === 0) poolSize = 26;

  let entropy = pw.length * Math.log2(poolSize);

  // Penalize common passwords heavily
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) {
    entropy = Math.min(entropy, 10);
  }

  // Penalize sequential chars
  if (hasSequentialChars(pw, 3)) {
    entropy *= 0.7;
  }

  // Penalize repeated chars
  if (hasRepeatedChars(pw, 3)) {
    entropy *= 0.7;
  }

  // Penalize low character class diversity
  const classes = countCharClasses(pw);
  if (classes <= 1 && pw.length > 4) {
    entropy *= 0.8;
  }

  return entropy;
}

function scorePassword(password) {
  if (!password) return 0;

  const entropy = estimateEntropy(password);

  if (entropy < 20) return 0;
  if (entropy < 40) return 1;
  if (entropy < 60) return 2;
  if (entropy < 80) return 3;
  return 4;
}

module.exports = { scorePassword, estimateEntropy };
