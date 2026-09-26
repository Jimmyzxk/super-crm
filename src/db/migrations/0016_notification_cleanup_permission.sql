-- Databases that applied 0015 before the function owner's table permission
-- was finalized need the same narrow operational grant.
GRANT DELETE ON notifications TO salescrm_migration;
GRANT SELECT (tenant_id, created_at) ON notifications TO salescrm_migration;
REVOKE DELETE ON notifications FROM salescrm;
