-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN,
-- but this migration is only run on databases created before the column was added to the schema.
-- For new databases, the column is in the CREATE TABLE statement.
-- The migrate.js runner records applied migrations, so this won't run twice.
ALTER TABLE items ADD COLUMN title_sort_key TEXT;
