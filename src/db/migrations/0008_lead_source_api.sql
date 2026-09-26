-- External lead intake is tenant-scoped. Token lookup is the only operation
-- that crosses tenant context, and it is exposed through a narrow definer function.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS source_label text,
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_format;
ALTER TABLE leads ADD CONSTRAINT leads_source_format
  CHECK (source IN ('manual', 'import') OR source ~ '^(form|api):.+$');
ALTER TABLE leads ADD CONSTRAINT leads_external_id_length
  CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 200);
ALTER TABLE leads ADD CONSTRAINT leads_source_label_length
  CHECK (source_label IS NULL OR char_length(source_label) BETWEEN 1 AND 100);

CREATE TABLE IF NOT EXISTS lead_source_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  source_key text NOT NULL CHECK (source_key ~ '^[a-z0-9][a-z0-9_-]{1,48}[a-z0-9]$'),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid NOT NULL,
  rate_window_started_at timestamptz,
  rate_window_count integer NOT NULL DEFAULT 0 CHECK (rate_window_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_source_keys_tenant_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT lead_source_keys_tenant_source_unique UNIQUE (tenant_id, source_key),
  CONSTRAINT lead_source_keys_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT lead_source_keys_creator_tenant_fk
    FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS lead_source_keys_tenant_idx ON lead_source_keys (tenant_id, created_at DESC);
ALTER TABLE lead_source_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_source_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_source_keys_tenant_isolation ON lead_source_keys;
CREATE POLICY lead_source_keys_tenant_isolation ON lead_source_keys
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

CREATE TABLE IF NOT EXISTS lead_intake_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_key_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 100),
  external_id text,
  lead_id uuid NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_intake_requests_source_tenant_fk
    FOREIGN KEY (tenant_id, source_key_id) REFERENCES lead_source_keys (tenant_id, id),
  CONSTRAINT lead_intake_requests_lead_tenant_fk
    FOREIGN KEY (tenant_id, lead_id) REFERENCES leads (tenant_id, id),
  CONSTRAINT lead_intake_requests_source_key_unique UNIQUE (source_key_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS lead_intake_requests_tenant_created_idx
  ON lead_intake_requests (tenant_id, created_at DESC);
ALTER TABLE lead_intake_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_intake_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_intake_requests_tenant_isolation ON lead_intake_requests;
CREATE POLICY lead_intake_requests_tenant_isolation ON lead_intake_requests
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT (
  id, tenant_id, source_key, revoked_at, created_by_user_id,
  last_used_at, rate_window_started_at, rate_window_count
) ON lead_source_keys TO salescrm;
GRANT INSERT (tenant_id, name, source_key, token_hash, created_by_user_id)
  ON lead_source_keys TO salescrm;
GRANT UPDATE (revoked_at, last_used_at, rate_window_started_at, rate_window_count)
  ON lead_source_keys TO salescrm;
GRANT SELECT, INSERT ON lead_intake_requests TO salescrm;
GRANT SELECT ON lead_source_keys TO salescrm_auth;
GRANT SELECT ON tenants TO salescrm_auth;

DROP FUNCTION IF EXISTS public.lookup_lead_source_token(text);
CREATE FUNCTION public.lookup_lead_source_token(p_token_hash text)
RETURNS TABLE (
  source_key_id uuid,
  tenant_id uuid,
  source_key text,
  created_by_user_id uuid,
  revoked_at timestamptz,
  tenant_status public.tenant_status,
  actor_role public.user_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT s.id, s.tenant_id, s.source_key, s.created_by_user_id, s.revoked_at, t.status, u.role
  FROM public.lead_source_keys s
  JOIN public.tenants t ON t.id = s.tenant_id
  JOIN public.users u ON u.tenant_id = s.tenant_id AND u.id = s.created_by_user_id
  WHERE s.token_hash = p_token_hash
$$;
ALTER FUNCTION public.lookup_lead_source_token(text) OWNER TO salescrm_auth;
REVOKE ALL ON FUNCTION public.lookup_lead_source_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_lead_source_token(text) TO salescrm;
