-- migrate:no-transaction
-- Drive the default active pool by overdue tasks or the stable close-date cursor.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_tenant_open_opportunity_due_idx
  ON tasks (tenant_id, due_at, opportunity_id)
  WHERE status = 'OPEN' AND opportunity_id IS NOT NULL;

-- migrate:statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS opportunities_tenant_active_close_cursor_idx
  ON opportunities (tenant_id, expected_close_at ASC NULLS LAST, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL AND stage NOT IN ('WON', 'LOST');

-- migrate:statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS opportunities_tenant_owner_active_close_cursor_idx
  ON opportunities (tenant_id, owner_user_id, expected_close_at ASC NULLS LAST, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL AND stage NOT IN ('WON', 'LOST');
