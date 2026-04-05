'use strict';

function parse(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error('Invalid JSON: unable to parse Bitwarden export');
  }

  if (!data.items || !Array.isArray(data.items)) {
    throw new Error('Invalid Bitwarden export: missing items array');
  }

  const folderMap = {};
  if (data.folders && Array.isArray(data.folders)) {
    for (const f of data.folders) {
      folderMap[f.id] = f.name;
    }
  }

  return data.items.map(item => {
    const record = {
      title: item.name || '',
      category: item.folderId ? (folderMap[item.folderId] || null) : null,
      record_type: 'secure_note',
      fields: [],
      notes: item.notes || '',
      favorite: item.favorite || false,
      tags: [],
    };

    switch (item.type) {
      case 1: { // Login
        record.record_type = 'login';
        const login = item.login || {};
        if (login.uris && login.uris.length > 0) {
          record.fields.push({ name: 'url', value: login.uris[0].uri || '', field_type: 'url' });
        }
        if (login.username !== undefined) {
          record.fields.push({ name: 'username', value: login.username || '', field_type: 'text' });
        }
        if (login.password !== undefined) {
          record.fields.push({ name: 'password', value: login.password || '', field_type: 'password' });
        }
        if (login.totp) {
          record.fields.push({ name: 'totp', value: login.totp, field_type: 'text' });
        }
        break;
      }
      case 2: // Secure Note
        record.record_type = 'secure_note';
        break;
      case 3: { // Card
        record.record_type = 'card';
        const card = item.card || {};
        if (card.cardholderName) record.fields.push({ name: 'cardholder_name', value: card.cardholderName, field_type: 'text' });
        if (card.number) record.fields.push({ name: 'number', value: card.number, field_type: 'password' });
        if (card.expMonth || card.expYear) {
          record.fields.push({ name: 'expiry', value: `${card.expMonth || ''}/${card.expYear || ''}`, field_type: 'text' });
        }
        if (card.code) record.fields.push({ name: 'cvv', value: card.code, field_type: 'password' });
        if (card.brand) record.fields.push({ name: 'brand', value: card.brand, field_type: 'text' });
        break;
      }
      case 4: { // Identity
        record.record_type = 'identity';
        const id = item.identity || {};
        if (id.firstName) record.fields.push({ name: 'first_name', value: id.firstName, field_type: 'text' });
        if (id.lastName) record.fields.push({ name: 'last_name', value: id.lastName, field_type: 'text' });
        if (id.email) record.fields.push({ name: 'email', value: id.email, field_type: 'email' });
        if (id.phone) record.fields.push({ name: 'phone', value: id.phone, field_type: 'phone' });
        break;
      }
      default:
        record.record_type = 'secure_note';
        break;
    }

    return record;
  });
}

module.exports = { parse };
