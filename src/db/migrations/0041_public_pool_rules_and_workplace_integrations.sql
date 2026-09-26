-- 0041_public_pool_rules_and_workplace_integrations.sql

CREATE TABLE IF NOT EXISTS public_pool_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_type text NOT NULL,
  threshold_days integer NOT NULL DEFAULT 7,
  protect_window_days integer NOT NULL DEFAULT 3,
  notify_before_hours integer NOT NULL DEFAULT 24,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_pool_rules_tenant_rule_type_unique UNIQUE (tenant_id, rule_type),
  CONSTRAINT public_pool_rules_threshold_days_check CHECK (threshold_days >= 1 AND threshold_days <= 365),
  CONSTRAINT public_pool_rules_protect_days_check CHECK (protect_window_days >= 0 AND protect_window_days <= 90),
  CONSTRAINT public_pool_rules_notify_hours_check CHECK (notify_before_hours >= 0 AND notify_before_hours <= 168)
);

CREATE INDEX IF NOT EXISTS public_pool_rules_tenant_idx
  ON public_pool_rules (tenant_id, is_enabled);

CREATE TABLE IF NOT EXISTS workplace_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform text NOT NULL,
  name text NOT NULL,
  webhook_url text NOT NULL,
  events jsonb NOT NULL DEFAULT '["DEAL_WON", "INTERVENTION_REQUESTED", "OPPORTUNITY_CREATED"]'::jsonb,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workplace_integrations_name_len CHECK (char_length(name) BETWEEN 1 AND 50),
  CONSTRAINT workplace_integrations_platform_check CHECK (platform IN ('WECOM', 'DINGTALK', 'FEISHU'))
);

CREATE INDEX IF NOT EXISTS workplace_integrations_tenant_idx
  ON workplace_integrations (tenant_id, is_enabled);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['public_pool_rules', 'workplace_integrations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_isolation', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
      tbl || '_tenant_isolation', tbl
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public_pool_rules, workplace_integrations TO salescrm;
