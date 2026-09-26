-- migrate:no-transaction
-- The sales workbench first scopes an assignee's open tasks, then resolves
-- display details only for the selected page. Keep the candidate scan covered
-- and ordered by its stable due-date cursor.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_tenant_assignee_open_due_cursor_idx
  ON tasks (tenant_id, assignee_user_id, due_at, id)
  INCLUDE (lead_id, customer_id, opportunity_id, type)
  WHERE status = 'OPEN';

-- migrate:statement-breakpoint
-- Customer and opportunity tasks do not need lead_id during candidate scans.
-- This narrower partial index avoids carrying lead-task entries for those two
-- validity branches.
CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_tenant_assignee_open_non_lead_due_cursor_idx
  ON tasks (tenant_id, assignee_user_id, due_at, id)
  INCLUDE (customer_id, opportunity_id, type)
  WHERE status = 'OPEN' AND lead_id IS NULL;
