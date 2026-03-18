ALTER TABLE agent_claims
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

UPDATE agent_claims
SET expires_at = NOW() + INTERVAL '48 hours'
WHERE expires_at IS NULL;

ALTER TABLE agent_claims
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '48 hours'),
  ALTER COLUMN expires_at SET NOT NULL;
