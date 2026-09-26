-- Migration: 0079_plugin_rate_limits.sql
-- Description: Create multi-replica atomic rate limiting table for plugin API calls

CREATE TABLE IF NOT EXISTS public.plugin_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subject text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_plugin_rate_limits_tenant_subject UNIQUE (tenant_id, subject)
);

CREATE INDEX IF NOT EXISTS idx_plugin_rate_limits_tenant_subj ON public.plugin_rate_limits (tenant_id, subject);

ALTER TABLE public.plugin_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plugin_rate_limits FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plugin_rate_limits_tenant_isolation ON public.plugin_rate_limits;
CREATE POLICY plugin_rate_limits_tenant_isolation ON public.plugin_rate_limits
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON public.plugin_rate_limits TO salescrm;
