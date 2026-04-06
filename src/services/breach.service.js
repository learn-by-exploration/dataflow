'use strict';

/**
 * HIBP (Have I Been Pwned) breach check service.
 * Caches responses in memory for 24 hours.
 */

const HIBP_API_URL = 'https://api.pwnedpasswords.com/range/';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const cache = new Map();

function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
}

async function checkPassword(sha1HashPrefix) {
  if (!sha1HashPrefix || typeof sha1HashPrefix !== 'string') {
    throw new Error('Invalid hash prefix');
  }

  const prefix = sha1HashPrefix.toUpperCase();

  // Check cache
  const cached = cache.get(prefix);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // Periodically clean cache
  if (cache.size > 100) cleanExpiredCache();

  const response = await fetch(HIBP_API_URL + encodeURIComponent(prefix), {
    headers: {
      'User-Agent': 'DataFlow-PasswordManager',
      'Add-Padding': 'true',
    },
  });

  if (!response.ok) {
    throw new Error(`HIBP API error: ${response.status}`);
  }

  const text = await response.text();
  const results = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const [suffix, count] = line.split(':');
      return { suffix: suffix.trim(), count: parseInt(count.trim(), 10) || 0 };
    });

  cache.set(prefix, { data: results, timestamp: Date.now() });

  return results;
}

function clearCache() {
  cache.clear();
}

module.exports = { checkPassword, clearCache, _cache: cache };
