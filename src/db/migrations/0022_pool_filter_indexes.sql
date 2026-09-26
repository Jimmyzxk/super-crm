-- migrate:no-transaction
-- Keep pool filters and cursor order on tenant-scoped, live rows without blocking writes on existing large tables.
CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_tenant_active_created_cursor_idx
  ON leads (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- migrate:statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_tenant_active_score_cursor_idx
  ON leads (tenant_id, score DESC NULLS LAST, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- migrate:statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_tenant_owner_active_created_cursor_idx
  ON leads (tenant_id, owner_user_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- migrate:statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_tenant_owner_active_score_cursor_idx
  ON leads (tenant_id, owner_user_id, score DESC NULLS LAST, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- migrate:statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_tenant_lead_status_due_idx
  ON tasks (tenant_id, lead_id, status, due_at);
