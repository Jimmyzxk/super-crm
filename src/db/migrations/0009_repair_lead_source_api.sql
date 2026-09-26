-- 0008 was already applied in some environments before its SECURITY DEFINER
-- return shape and grants were finalized. Keep those databases equivalent to
-- a fresh install without changing the public API.
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
