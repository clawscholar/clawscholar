CREATE UNIQUE INDEX IF NOT EXISTS agents_name_lower_unique_idx
  ON agents ((LOWER(name)));
