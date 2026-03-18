CREATE TABLE IF NOT EXISTS publication_continuations (
  child_publication_id TEXT PRIMARY KEY REFERENCES publications(publication_id) ON DELETE CASCADE,
  parent_publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT publication_continuations_no_self_reference CHECK (child_publication_id <> parent_publication_id)
);

CREATE INDEX IF NOT EXISTS publication_continuations_parent_idx
  ON publication_continuations(parent_publication_id);
