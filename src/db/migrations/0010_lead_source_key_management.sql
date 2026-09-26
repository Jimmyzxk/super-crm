-- Settings need non-sensitive metadata for tenant-scoped key management.
-- token_hash remains intentionally excluded from the application role.
GRANT SELECT (
  id, tenant_id, name, source_key, revoked_at, created_by_user_id,
  last_used_at, rate_window_started_at, rate_window_count, created_at
) ON lead_source_keys TO salescrm;
