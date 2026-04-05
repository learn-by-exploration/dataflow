ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_shares_unique ON item_shares(item_id, shared_with);
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_shares_unique ON category_shares(category_id, shared_with);
