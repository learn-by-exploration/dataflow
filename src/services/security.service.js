'use strict';

/**
 * Security service — security score calculator and reused password detection.
 */

const crypto = require('crypto');
const createItemRepo = require('../repositories/item.repository');
const createItemFieldRepo = require('../repositories/item-field.repository');
const createSharingRepo = require('../repositories/sharing.repository');
const { decrypt } = require('./encryption');

function createSecurityService(db) {
  const itemRepo = createItemRepo(db);
  const fieldRepo = createItemFieldRepo(db);
  const sharingRepo = createSharingRepo(db);

  function getPasswordFields(userId) {
    return db.prepare(`
      SELECT if2.*, rtf.field_type, rtf.name as field_name, i.title_encrypted, i.title_iv, i.title_tag, i.client_encrypted
      FROM item_fields if2
      JOIN items i ON if2.item_id = i.id
      LEFT JOIN record_type_fields rtf ON if2.field_def_id = rtf.id
      WHERE i.user_id = ? AND rtf.field_type = 'password'
    `).all(userId);
  }

  return {
    calculateSecurityScore(userId) {
      const passwordFields = getPasswordFields(userId);
      const totalItems = db.prepare('SELECT COUNT(*) as count FROM items WHERE user_id = ?').get(userId).count;

      // 30% password health (% scoring 3+)
      let passwordHealthPercent = 100;
      if (passwordFields.length > 0) {
        const strongCount = passwordFields.filter(f => (f.strength_score || 0) >= 3).length;
        passwordHealthPercent = (strongCount / passwordFields.length) * 100;
      }

      // 25% encryption coverage
      let encryptionPercent = 100;
      if (totalItems > 0) {
        const encrypted = db.prepare(
          'SELECT COUNT(*) as count FROM items WHERE user_id = ? AND (title_encrypted IS NOT NULL OR client_encrypted = 1)'
        ).get(userId).count;
        encryptionPercent = (encrypted / totalItems) * 100;
      }

      // 20% sharing hygiene (no over-shared items — items shared with >3 users)
      let sharingPercent = 100;
      if (totalItems > 0) {
        const overSharedRows = db.prepare(
          'SELECT item_id, COUNT(*) as share_count FROM item_shares WHERE shared_by = ? GROUP BY item_id HAVING share_count > 3'
        ).all(userId);
        if (overSharedRows.length > 0) {
          sharingPercent = Math.max(0, 100 - (overSharedRows.length / totalItems) * 100);
        }
      }

      // 15% unique passwords
      let uniquePercent = 100;
      if (passwordFields.length > 1) {
        const valueSet = new Set();
        const duplicates = new Set();
        for (const f of passwordFields) {
          const key = f.value_encrypted || '';
          if (valueSet.has(key) && key) {
            duplicates.add(key);
          }
          valueSet.add(key);
        }
        const duplicateCount = passwordFields.filter(f => duplicates.has(f.value_encrypted || '')).length;
        uniquePercent = ((passwordFields.length - duplicateCount) / passwordFields.length) * 100;
      }

      // 10% backup status
      let backupPercent = 0;
      const lastBackup = db.prepare(
        "SELECT created_at FROM audit_log WHERE user_id = ? AND action IN ('backup.create', 'data.export') ORDER BY created_at DESC LIMIT 1"
      ).get(userId);
      if (lastBackup) {
        const backupAge = Date.now() - new Date(lastBackup.created_at).getTime();
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        if (backupAge < thirtyDaysMs) backupPercent = 100;
        else if (backupAge < 90 * 24 * 60 * 60 * 1000) backupPercent = 50;
      }

      const score = Math.round(
        passwordHealthPercent * 0.30 +
        encryptionPercent * 0.25 +
        sharingPercent * 0.20 +
        uniquePercent * 0.15 +
        backupPercent * 0.10
      );

      return {
        score: Math.min(100, Math.max(0, score)),
        breakdown: {
          password_health: Math.round(passwordHealthPercent),
          encryption_coverage: Math.round(encryptionPercent),
          sharing_hygiene: Math.round(sharingPercent),
          unique_passwords: Math.round(uniquePercent),
          backup_status: Math.round(backupPercent),
        },
        weights: {
          password_health: 30,
          encryption_coverage: 25,
          sharing_hygiene: 20,
          unique_passwords: 15,
          backup_status: 10,
        },
      };
    },

    detectReusedPasswords(userId, vaultKey) {
      const passwordFields = getPasswordFields(userId);
      if (!vaultKey || passwordFields.length === 0) return [];

      const hashGroups = new Map();

      for (const f of passwordFields) {
        if (!f.value_encrypted || f.client_encrypted) continue;
        try {
          const plaintext = decrypt(f.value_encrypted, f.value_iv, f.value_tag, vaultKey);
          const hash = crypto.createHmac('sha256', vaultKey).update(plaintext).digest('hex');

          if (!hashGroups.has(hash)) {
            hashGroups.set(hash, []);
          }

          // Get title
          let title = 'Item #' + f.item_id;
          try {
            title = decrypt(f.title_encrypted, f.title_iv, f.title_tag, vaultKey);
          } catch { /* use fallback */ }

          hashGroups.get(hash).push({
            id: f.item_id,
            title,
            field_id: f.id,
          });
        } catch { /* skip fields that can't be decrypted */ }
      }

      return Array.from(hashGroups.entries())
        .filter(([, items]) => items.length > 1)
        .map(([hash, items]) => ({ hash, count: items.length, items }));
    },

    getPasswordHealth(userId) {
      const passwordFields = getPasswordFields(userId);

      const byScore = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
      let oldCount = 0;
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      for (const f of passwordFields) {
        const score = f.strength_score != null ? f.strength_score : 2;
        byScore[score] = (byScore[score] || 0) + 1;

        const lastChanged = f.password_last_changed || f.created_at;
        if (lastChanged && lastChanged < ninetyDaysAgo) {
          oldCount++;
        }
      }

      return {
        total: passwordFields.length,
        by_score: byScore,
        weak: byScore[0] + byScore[1],
        old: oldCount,
      };
    },

    getHealthReport(userId) {
      const totalItems = db.prepare('SELECT COUNT(*) as count FROM items WHERE user_id = ?').get(userId).count;
      const totalCategories = db.prepare('SELECT COUNT(*) as count FROM categories WHERE user_id = ?').get(userId).count;
      const totalTags = db.prepare('SELECT COUNT(*) as count FROM tags WHERE user_id = ?').get(userId).count;

      // Password age distribution
      const passwordFields = getPasswordFields(userId);
      const now = Date.now();
      const ageBuckets = { under_30d: 0, '30_90d': 0, '90_180d': 0, over_180d: 0 };
      for (const f of passwordFields) {
        const lastChanged = f.password_last_changed || f.created_at;
        const ageMs = lastChanged ? now - new Date(lastChanged).getTime() : now;
        const ageDays = ageMs / (24 * 60 * 60 * 1000);
        if (ageDays < 30) ageBuckets.under_30d++;
        else if (ageDays < 90) ageBuckets['30_90d']++;
        else if (ageDays < 180) ageBuckets['90_180d']++;
        else ageBuckets.over_180d++;
      }

      // Sharing summary
      const sharedByMe = db.prepare('SELECT COUNT(*) as count FROM item_shares WHERE shared_by = ?').get(userId).count;
      const sharedWithMe = db.prepare('SELECT COUNT(*) as count FROM item_shares WHERE shared_with = ?').get(userId).count;

      // Category utilization
      const categoryUtilization = db.prepare(
        'SELECT c.name, COUNT(i.id) as item_count FROM categories c LEFT JOIN items i ON i.category_id = c.id WHERE c.user_id = ? GROUP BY c.id ORDER BY item_count DESC'
      ).all(userId);

      // Recommendations
      const recommendations = [];
      const passwordHealth = this.getPasswordHealth(userId);
      if (passwordHealth.weak > 0) {
        recommendations.push(`${passwordHealth.weak} password(s) have weak strength. Consider updating them.`);
      }
      if (passwordHealth.old > 0) {
        recommendations.push(`${passwordHealth.old} password(s) haven't been changed in over 90 days.`);
      }
      const unencrypted = db.prepare(
        'SELECT COUNT(*) as count FROM items WHERE user_id = ? AND client_encrypted = 0 AND title_encrypted IS NULL'
      ).get(userId).count;
      if (unencrypted > 0) {
        recommendations.push(`${unencrypted} item(s) are not encrypted. Enable encryption for better security.`);
      }
      if (totalCategories === 0) {
        recommendations.push('Create categories to organize your vault items.');
      }
      if (totalItems > 0 && totalTags === 0) {
        recommendations.push('Use tags to better organize and find your items.');
      }

      return {
        total_items: totalItems,
        total_categories: totalCategories,
        total_tags: totalTags,
        password_age_distribution: ageBuckets,
        sharing: {
          shared_by_me: sharedByMe,
          shared_with_me: sharedWithMe,
        },
        category_utilization: categoryUtilization,
        recommendations,
      };
    },
  };
}

module.exports = createSecurityService;
