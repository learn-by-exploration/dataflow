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
      { name: 'url', value: obj.Website || '', field_type: 'url' },
      { name: 'username', value: obj.Username || '', field_type: 'text' },
      { name: 'password', value: obj.Password || '', field_type: 'password' },
    ];

    return {
      title: obj.Title || '',
      category: null,
      record_type: 'login',
      fields,
      notes: obj.Notes || '',
      favorite: false,
      tags: [],
    };
  });
}

module.exports = { parse };
