ALTER TABLE score_rules ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS score_rules_tenant_active_order_idx
  ON score_rules (tenant_id, sort_order, id)
  WHERE deleted_at IS NULL;
