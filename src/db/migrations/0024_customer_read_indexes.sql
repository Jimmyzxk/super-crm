-- migrate:no-transaction
-- Direct legacy leads are the only remaining unbounded relationship entry in
-- the customer detail and timeline plans. The other entries start from a
-- customer/opportunity key and already use existing primary or pool indexes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_tenant_customer_created_cursor_idx
  ON leads (tenant_id, customer_id, created_at DESC, id DESC)
  WHERE customer_id IS NOT NULL;
