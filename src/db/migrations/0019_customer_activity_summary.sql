ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

GRANT SELECT ON customers, activities, opportunities TO salescrm_migration;
GRANT UPDATE (last_activity_at) ON customers TO salescrm_migration;

SET LOCAL ROLE salescrm_migration;

WITH customer_activity AS (
  SELECT a.tenant_id, a.customer_id, max(a.occurred_at) AS last_activity_at
  FROM activities a
  WHERE a.customer_id IS NOT NULL
  GROUP BY a.tenant_id, a.customer_id
  UNION ALL
  SELECT o.tenant_id, o.customer_id, max(a.occurred_at) AS last_activity_at
  FROM activities a
  JOIN opportunities o ON o.tenant_id = a.tenant_id AND o.id = a.opportunity_id
  WHERE a.opportunity_id IS NOT NULL
  GROUP BY o.tenant_id, o.customer_id
), latest_activity AS (
  SELECT tenant_id, customer_id, max(last_activity_at) AS last_activity_at
  FROM customer_activity
  GROUP BY tenant_id, customer_id
)
UPDATE customers c
SET last_activity_at = greatest(c.last_activity_at, latest_activity.last_activity_at)
FROM latest_activity
WHERE latest_activity.tenant_id = c.tenant_id
  AND latest_activity.customer_id = c.id;

RESET ROLE;
REVOKE UPDATE (last_activity_at) ON customers FROM salescrm_migration;
