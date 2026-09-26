-- Keep the time-driven insight scan bounded to overdue tasks and active opportunity stages.
CREATE INDEX IF NOT EXISTS tasks_tenant_followup_due_scan_idx
  ON tasks (tenant_id, due_at, id)
  INCLUDE (lead_id, customer_id, opportunity_id, assignee_user_id)
  WHERE status = 'OPEN' AND type = 'FOLLOW_UP';

CREATE INDEX IF NOT EXISTS opportunities_tenant_stage_due_scan_idx
  ON opportunities (tenant_id, stage, stage_entered_at, id)
  INCLUDE (owner_user_id)
  WHERE deleted_at IS NULL AND stage IN ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION');
