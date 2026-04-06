-- Add expires_at column to sharing tables
ALTER TABLE item_shares ADD COLUMN expires_at TEXT;
ALTER TABLE category_shares ADD COLUMN expires_at TEXT;
