-- Create item_templates table for user-defined templates
CREATE TABLE IF NOT EXISTS item_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  record_type_id INTEGER REFERENCES record_types(id) ON DELETE SET NULL,
  default_fields TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_item_templates_user ON item_templates(user_id);
