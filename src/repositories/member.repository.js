'use strict';

const { NotFoundError } = require('../errors');

function createMemberRepo(db) {
  return {
    findAll() {
      return db.prepare(
        'SELECT id, email, display_name, role, active, created_at FROM users ORDER BY id ASC'
      ).all();
    },

    findAllBasic() {
      return db.prepare(
        'SELECT id, display_name, role FROM users ORDER BY id ASC'
      ).all();
    },

    findById(id) {
      const row = db.prepare(
        'SELECT id, email, display_name, role, active, created_at FROM users WHERE id = ?'
      ).get(id);
      if (!row) throw new NotFoundError('Member', id);
      return row;
    },

    findByIdMinimal(id) {
      const row = db.prepare(
        'SELECT id, role FROM users WHERE id = ?'
      ).get(id);
      if (!row) throw new NotFoundError('Member', id);
      return row;
    },

    update(id, fields) {
      const ALLOWED_COLUMNS = ['display_name', 'email', 'role', 'active'];
      const keys = Object.keys(fields).filter(k => ALLOWED_COLUMNS.includes(k));
      if (keys.length === 0) return this.findById(id);

      const setClauses = keys.map(k => `${k} = ?`);
      setClauses.push("updated_at = datetime('now')");
      const values = keys.map(k => fields[k]);
      values.push(id);

      db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
      return this.findById(id);
    },

    deactivate(id) {
      db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
    },

    activate(id) {
      db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(id);
    },

    hardDelete(id) {
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    },
  };
}

module.exports = createMemberRepo;
