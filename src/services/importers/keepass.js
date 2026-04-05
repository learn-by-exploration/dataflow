'use strict';

function parse(content) {
  if (!content || !content.trim()) return [];

  // Basic XML validation
  if (!content.includes('<KeePassFile>')) {
    throw new Error('Invalid KeePass XML: missing KeePassFile element');
  }

  const results = [];
  parseGroups(content, results);
  return results;
}

function parseGroups(xml, results) {
  // Find all Group elements and process them
  const rootMatch = xml.match(/<Root>([\s\S]*)<\/Root>/);
  if (!rootMatch) return;

  processGroup(rootMatch[1], results, null);
}

function processGroup(xml, results, parentCategory) {
  // Find groups at this level
  let pos = 0;
  while (pos < xml.length) {
    const groupStart = xml.indexOf('<Group>', pos);
    if (groupStart === -1) break;

    // Find the matching closing tag (handling nesting)
    const groupContent = findMatchingClose(xml, groupStart + 7, 'Group');
    if (!groupContent) break;

    // Extract the group name
    const nameMatch = groupContent.content.match(/<Name>([\s\S]*?)<\/Name>/);
    const groupName = nameMatch ? nameMatch[1].trim() : parentCategory;

    // Strip nested <Group>...</Group> blocks to only get direct entries
    let directContent = groupContent.content;
    let stripped = stripNestedGroups(directContent);

    // Process direct entries in this group
    extractEntries(stripped, results, groupName);

    // Process nested groups
    processGroup(groupContent.content, results, groupName);

    pos = groupContent.endPos;
  }
}

function stripNestedGroups(xml) {
  let result = xml;
  let changed = true;
  while (changed) {
    const before = result;
    result = result.replace(/<Group>[\s\S]*?<\/Group>/g, '');
    changed = result !== before;
  }
  return result;
}

function findMatchingClose(xml, startPos, tagName) {
  let depth = 1;
  let pos = startPos;
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;

  while (pos < xml.length && depth > 0) {
    const nextOpen = xml.indexOf(openTag, pos);
    const nextClose = xml.indexOf(closeTag, pos);

    if (nextClose === -1) return null;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth === 0) {
        return {
          content: xml.substring(startPos, nextClose),
          endPos: nextClose + closeTag.length,
        };
      }
      pos = nextClose + closeTag.length;
    }
  }
  return null;
}

function extractEntries(xml, results, category) {
  const entryRegex = /<Entry>([\s\S]*?)<\/Entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1];
    const entry = parseEntry(entryXml, category);
    results.push(entry);
  }
}

function parseEntry(entryXml, category) {
  const fields = {};
  const stringRegex = /<String>\s*<Key>([\s\S]*?)<\/Key>\s*<Value>([\s\S]*?)<\/Value>\s*<\/String>/g;
  let match;
  while ((match = stringRegex.exec(entryXml)) !== null) {
    fields[match[1].trim()] = match[2].trim();
  }

  const result = {
    title: fields.Title || '',
    category: category || null,
    record_type: 'login',
    fields: [],
    notes: fields.Notes || '',
    favorite: false,
    tags: [],
  };

  if (fields.URL) result.fields.push({ name: 'url', value: fields.URL, field_type: 'url' });
  if (fields.UserName) result.fields.push({ name: 'username', value: fields.UserName, field_type: 'text' });
  if (fields.Password) result.fields.push({ name: 'password', value: fields.Password, field_type: 'password' });

  return result;
}

module.exports = { parse };
