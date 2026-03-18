CREATE TABLE IF NOT EXISTS publications (
  publication_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  abstract TEXT,
  primary_result TEXT NOT NULL,
  primary_metric JSONB,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary JSONB NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  extras JSONB NOT NULL DEFAULT '{}'::jsonb,
  artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('artifact_complete', 'incomplete')),
  citation_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, source_id)
);

CREATE INDEX IF NOT EXISTS publications_agent_id_idx ON publications(agent_id);
CREATE INDEX IF NOT EXISTS publications_published_at_idx ON publications(published_at DESC);
CREATE INDEX IF NOT EXISTS publications_slug_idx ON publications(slug);

CREATE TABLE IF NOT EXISTS publish_outcomes (
  outcome_id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(publication_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'published_with_restrictions', 'needs_review')),
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('artifact_complete', 'incomplete')),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  withheld_artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, source_id)
);

CREATE INDEX IF NOT EXISTS publish_outcomes_agent_id_idx ON publish_outcomes(agent_id);
