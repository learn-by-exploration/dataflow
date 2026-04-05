'use strict';

function parseCSV(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current);
        current = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(current);
        current = '';
        if (ch === '\r') i++;
        rows.push(row);
        row = [];
      } else {
        current += ch;
      }
    }
  }
  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }
  return rows;
}

function parse(content) {
  if (!content || !content.trim()) return [];

  const rows = parseCSV(content.trim());
  if (rows.length <= 1) return [];

  const headers = rows[0];
  return rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h.trim()] = (cols[i] || '').trim();
    });

    const fields = [
      { name: 'url', value: obj.url || '', field_type: 'url' },
      { name: 'username', value: obj.username || '', field_type: 'text' },
      { name: 'password', value: obj.password || '', field_type: 'password' },
    ];

    if (obj.totp) {
      fields.push({ name: 'totp', value: obj.totp, field_type: 'text' });
    }

    return {
      title: obj.name || '',
      category: obj.grouping || null,
      record_type: 'login',
      fields,
      notes: obj.extra || '',
      favorite: obj.fav === '1',
      tags: [],
    };
  });
}

module.exports = { parse };
