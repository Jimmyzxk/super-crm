-- 0070_grant_lead_source_keys_columns.sql
GRANT SELECT (scopes, rate_limit_per_minute, allowed_ip_ranges),
      INSERT (scopes, rate_limit_per_minute, allowed_ip_ranges),
      UPDATE (scopes, rate_limit_per_minute, allowed_ip_ranges)
  ON lead_source_keys TO salescrm;
GRANT SELECT ON lead_source_keys TO salescrm_auth;
