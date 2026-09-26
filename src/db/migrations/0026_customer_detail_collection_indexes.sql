-- migrate:no-transaction
-- Keep customer-detail cursor reads bounded by the relationship key and the
-- exact display order. These partial indexes avoid sorting large soft-deleted
-- collections as customer and opportunity populations grow.
CREATE INDEX CONCURRENTLY IF NOT EXISTS contacts_tenant_customer_detail_cursor_idx
  ON contacts (tenant_id, customer_id, is_primary DESC, created_at, id)
  WHERE deleted_at IS NULL;

-- migrate:statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS opportunities_tenant_customer_created_cursor_idx
  ON opportunities (tenant_id, customer_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- migrate:statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_tenant_customer_open_due_cursor_idx
  ON tasks (tenant_id, customer_id, due_at, id)
  WHERE status = 'OPEN' AND customer_id IS NOT NULL;

-- migrate:statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_tenant_opportunity_open_due_cursor_idx
  ON tasks (tenant_id, opportunity_id, due_at, id)
  WHERE status = 'OPEN' AND opportunity_id IS NOT NULL;
