-- Support bounded pool queries and customer operating-status aggregation.
CREATE INDEX IF NOT EXISTS customers_tenant_created_idx
  ON customers (tenant_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS opportunities_tenant_customer_stage_idx
  ON opportunities (tenant_id, customer_id, deleted_at, stage);

CREATE INDEX IF NOT EXISTS activities_tenant_opportunity_occurred_idx
  ON activities (tenant_id, opportunity_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS tasks_tenant_customer_status_due_idx
  ON tasks (tenant_id, customer_id, status, due_at);

CREATE INDEX IF NOT EXISTS tasks_tenant_opportunity_status_due_idx
  ON tasks (tenant_id, opportunity_id, status, due_at);
