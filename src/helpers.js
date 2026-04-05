'use strict';

function getNextPosition(db, table, scopeCol, scopeVal) {
  const sql = scopeCol
    ? `SELECT COALESCE(MAX(position), -1) + 1 as p FROM ${table} WHERE ${scopeCol} = ?`
    : `SELECT COALESCE(MAX(position), -1) + 1 as p FROM ${table}`;
  return scopeCol ? db.prepare(sql).get(scopeVal).p : db.prepare(sql).get().p;
}

module.exports = { getNextPosition };
