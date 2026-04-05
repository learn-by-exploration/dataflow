'use strict';

/**
 * Seed built-in record types for DataFlow.
 * 14 record types: Login, Identity, Credit Card, Bank Account, Address,
 * Emergency Contact, Medical, Vehicle, WiFi, Software License,
 * Secure Note, Key-Value, Document, Subscription.
 *
 * Can be run standalone: node src/db/seed.js
 * Or imported: seedRecordTypes(db)
 */

const BUILTIN_RECORD_TYPES = [
  {
    name: 'Login',
    icon: '🔑',
    description: 'Website or app login credentials',
    fields: [
      { name: 'Username', field_type: 'text', required: 1 },
      { name: 'Password', field_type: 'password', required: 1 },
      { name: 'URL', field_type: 'url', required: 0 },
      { name: 'TOTP Secret', field_type: 'hidden', required: 0 },
    ],
  },
  {
    name: 'Identity',
    icon: '🪪',
    description: 'Personal identification document',
    fields: [
      { name: 'Full Name', field_type: 'text', required: 1 },
      { name: 'ID Number', field_type: 'text', required: 1 },
      { name: 'ID Type', field_type: 'select', required: 0, options: '["Passport","Driver License","National ID","Social Security","Tax ID","Other"]' },
      { name: 'Issue Date', field_type: 'date', required: 0 },
      { name: 'Expiry Date', field_type: 'date', required: 0 },
      { name: 'Issuing Authority', field_type: 'text', required: 0 },
    ],
  },
  {
    name: 'Credit Card',
    icon: '💳',
    description: 'Credit or debit card details',
    fields: [
      { name: 'Cardholder Name', field_type: 'text', required: 1 },
      { name: 'Card Number', field_type: 'password', required: 1 },
      { name: 'Expiry Date', field_type: 'text', required: 1 },
      { name: 'CVV', field_type: 'password', required: 1 },
      { name: 'PIN', field_type: 'password', required: 0 },
      { name: 'Issuing Bank', field_type: 'text', required: 0 },
    ],
  },
  {
    name: 'Bank Account',
    icon: '🏦',
    description: 'Bank account details',
    fields: [
      { name: 'Bank Name', field_type: 'text', required: 1 },
      { name: 'Account Number', field_type: 'password', required: 1 },
      { name: 'Routing Number', field_type: 'text', required: 0 },
      { name: 'SWIFT/BIC', field_type: 'text', required: 0 },
      { name: 'IBAN', field_type: 'text', required: 0 },
      { name: 'Account Type', field_type: 'select', required: 0, options: '["Checking","Savings","Business","Other"]' },
    ],
  },
  {
    name: 'Address',
    icon: '🏠',
    description: 'Physical address',
    fields: [
      { name: 'Street', field_type: 'text', required: 1 },
      { name: 'City', field_type: 'text', required: 1 },
      { name: 'State/Province', field_type: 'text', required: 0 },
      { name: 'ZIP/Postal Code', field_type: 'text', required: 0 },
      { name: 'Country', field_type: 'text', required: 0 },
    ],
  },
  {
    name: 'Emergency Contact',
    icon: '🆘',
    description: 'Emergency contact information',
    fields: [
      { name: 'Name', field_type: 'text', required: 1 },
      { name: 'Relationship', field_type: 'text', required: 0 },
      { name: 'Phone', field_type: 'phone', required: 1 },
      { name: 'Email', field_type: 'email', required: 0 },
      { name: 'Address', field_type: 'textarea', required: 0 },
    ],
  },
  {
    name: 'Medical',
    icon: '🏥',
    description: 'Medical information and records',
    fields: [
      { name: 'Provider Name', field_type: 'text', required: 1 },
      { name: 'Policy Number', field_type: 'text', required: 0 },
      { name: 'Group Number', field_type: 'text', required: 0 },
      { name: 'Phone', field_type: 'phone', required: 0 },
      { name: 'Blood Type', field_type: 'select', required: 0, options: '["A+","A-","B+","B-","AB+","AB-","O+","O-"]' },
      { name: 'Allergies', field_type: 'textarea', required: 0 },
      { name: 'Medications', field_type: 'textarea', required: 0 },
    ],
  },
  {
    name: 'Vehicle',
    icon: '🚗',
    description: 'Vehicle registration and details',
    fields: [
      { name: 'Make', field_type: 'text', required: 1 },
      { name: 'Model', field_type: 'text', required: 1 },
      { name: 'Year', field_type: 'number', required: 0 },
      { name: 'VIN', field_type: 'text', required: 0 },
      { name: 'License Plate', field_type: 'text', required: 0 },
      { name: 'Insurance Policy', field_type: 'text', required: 0 },
    ],
  },
  {
    name: 'WiFi',
    icon: '📶',
    description: 'WiFi network credentials',
    fields: [
      { name: 'Network Name (SSID)', field_type: 'text', required: 1 },
      { name: 'Password', field_type: 'password', required: 1 },
      { name: 'Security Type', field_type: 'select', required: 0, options: '["WPA2","WPA3","WEP","Open","Other"]' },
      { name: 'Hidden Network', field_type: 'toggle', required: 0 },
    ],
  },
  {
    name: 'Software License',
    icon: '💿',
    description: 'Software license keys',
    fields: [
      { name: 'Software Name', field_type: 'text', required: 1 },
      { name: 'License Key', field_type: 'password', required: 1 },
      { name: 'Version', field_type: 'text', required: 0 },
      { name: 'Purchase Date', field_type: 'date', required: 0 },
      { name: 'Expiry Date', field_type: 'date', required: 0 },
      { name: 'Seats', field_type: 'number', required: 0 },
    ],
  },
  {
    name: 'Secure Note',
    icon: '📝',
    description: 'Free-form encrypted note',
    fields: [
      { name: 'Content', field_type: 'textarea', required: 1 },
    ],
  },
  {
    name: 'Key-Value',
    icon: '🔐',
    description: 'Arbitrary key-value pairs',
    fields: [
      { name: 'Key', field_type: 'text', required: 1 },
      { name: 'Value', field_type: 'password', required: 1 },
    ],
  },
  {
    name: 'Document',
    icon: '📄',
    description: 'Document with optional file attachments',
    fields: [
      { name: 'Document Type', field_type: 'text', required: 1 },
      { name: 'Description', field_type: 'textarea', required: 0 },
      { name: 'Expiry Date', field_type: 'date', required: 0 },
    ],
  },
  {
    name: 'Subscription',
    icon: '🔄',
    description: 'Recurring service subscription',
    fields: [
      { name: 'Service Name', field_type: 'text', required: 1 },
      { name: 'Username/Email', field_type: 'text', required: 0 },
      { name: 'Password', field_type: 'password', required: 0 },
      { name: 'URL', field_type: 'url', required: 0 },
      { name: 'Cost', field_type: 'number', required: 0 },
      { name: 'Billing Cycle', field_type: 'select', required: 0, options: '["Monthly","Yearly","Weekly","Other"]' },
      { name: 'Renewal Date', field_type: 'date', required: 0 },
    ],
  },
];

function seedRecordTypes(db) {
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM record_types WHERE is_builtin = 1').get().cnt;
  if (existing > 0) return { skipped: true, count: existing };

  const insertType = db.prepare(
    'INSERT INTO record_types (user_id, name, icon, description, is_builtin) VALUES (NULL, ?, ?, ?, 1)'
  );
  const insertField = db.prepare(
    'INSERT INTO record_type_fields (record_type_id, name, field_type, options, position, required) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const seedAll = db.transaction(() => {
    for (const type of BUILTIN_RECORD_TYPES) {
      const result = insertType.run(type.name, type.icon, type.description);
      const typeId = result.lastInsertRowid;
      for (let i = 0; i < type.fields.length; i++) {
        const f = type.fields[i];
        insertField.run(typeId, f.name, f.field_type, f.options || null, i, f.required);
      }
    }
  });

  seedAll();
  return { seeded: true, count: BUILTIN_RECORD_TYPES.length };
}

// Run standalone
if (require.main === module) {
  const config = require('../config');
  const initDatabase = require('./index');
  const db = initDatabase(config.dbDir);
  const result = seedRecordTypes(db);
  console.log('Seed result:', result);
  db.close();
}

module.exports = { seedRecordTypes, BUILTIN_RECORD_TYPES };
