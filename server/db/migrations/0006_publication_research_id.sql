ALTER TABLE publications
  ADD COLUMN IF NOT EXISTS research_id TEXT;

UPDATE publications
SET research_id = source_id
WHERE research_id IS NULL OR research_id = '';

ALTER TABLE publications
  ALTER COLUMN research_id SET NOT NULL;

ALTER TABLE publications
  DROP CONSTRAINT IF EXISTS publications_agent_id_source_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS publications_agent_id_research_id_idx
  ON publications(agent_id, research_id);

