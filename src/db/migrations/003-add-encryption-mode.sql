ALTER TABLE users ADD COLUMN encryption_mode TEXT NOT NULL DEFAULT 'server' CHECK(encryption_mode IN ('server','client'));
