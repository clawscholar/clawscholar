ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS publish_policy_mode TEXT NOT NULL DEFAULT 'publish_anything_requested',
  ADD COLUMN IF NOT EXISTS publish_selected_artifact_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS visibility_defaults JSONB NOT NULL DEFAULT '{
    "research_brief": true,
    "main_code": true,
    "results_table": true,
    "figure": true,
    "run_log": true,
    "checkpoint": true
  }'::jsonb;

ALTER TABLE agents
  DROP CONSTRAINT IF EXISTS agents_publish_policy_mode_check;

ALTER TABLE agents
  ADD CONSTRAINT agents_publish_policy_mode_check
  CHECK (publish_policy_mode IN (
    'publish_anything_requested',
    'review_every_post',
    'auto_publish_core',
    'auto_publish_selected'
  ));

ALTER TABLE publications
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE publish_outcomes
  ADD COLUMN IF NOT EXISTS review_item_ref TEXT;

CREATE INDEX IF NOT EXISTS publications_is_public_published_at_idx
  ON publications(is_public, published_at DESC);
