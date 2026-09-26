-- migrate:no-transaction
-- These indexes must not block customer writes while a large table is indexed.
-- The drops make a retry safe if a previous concurrent build left an invalid index.
DROP INDEX CONCURRENTLY IF EXISTS customers_tenant_last_activity_idx;
-- migrate:statement-breakpoint
CREATE INDEX CONCURRENTLY customers_tenant_last_activity_idx
  ON customers (tenant_id, last_activity_at DESC NULLS LAST, id DESC)
  WHERE deleted_at IS NULL;
-- migrate:statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS customers_tenant_owner_last_activity_idx;
-- migrate:statement-breakpoint
CREATE INDEX CONCURRENTLY customers_tenant_owner_last_activity_idx
  ON customers (tenant_id, owner_user_id, last_activity_at DESC NULLS LAST, id DESC)
  WHERE deleted_at IS NULL;
