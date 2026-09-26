-- DELETE predicates require SELECT on every referenced column.
GRANT SELECT (tenant_id, created_at) ON notifications TO salescrm_migration;
