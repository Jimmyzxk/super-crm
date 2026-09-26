CREATE EXTENSION IF NOT EXISTS pgcrypto;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO salescrm, salescrm_auth;
DO $$ BEGIN CREATE TYPE tenant_status AS ENUM ('ACTIVE','SUSPENDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('ADMIN','MANAGER','SALES'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE user_status AS ENUM ('ACTIVE','DISABLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100), status tenant_status NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))), password_hash text NOT NULL, name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50), role user_role NOT NULL DEFAULT 'SALES', status user_status NOT NULL DEFAULT 'ACTIVE', session_version int NOT NULL DEFAULT 1, failed_login_count int NOT NULL DEFAULT 0, locked_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS users_tenant_role_idx ON users (tenant_id, role);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_tenant_isolation ON users;
CREATE POLICY users_tenant_isolation ON users USING (tenant_id::text = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT ON tenants TO salescrm;
GRANT SELECT, INSERT, UPDATE ON users TO salescrm;
GRANT USAGE ON TYPE tenant_status, user_role, user_status TO salescrm;
GRANT USAGE ON TYPE user_role, user_status TO salescrm_auth;
GRANT SELECT (id, tenant_id, email, password_hash, role, status, session_version, locked_until, failed_login_count) ON users TO salescrm_auth;
DROP FUNCTION IF EXISTS public.auth_lookup_user(text);
CREATE FUNCTION public.auth_lookup_user(p_email text) RETURNS TABLE (id uuid, tenant_id uuid, password_hash text, role public.user_role, status public.user_status, session_version int, locked_until timestamptz, failed_login_count int) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT u.id,u.tenant_id,u.password_hash,u.role,u.status,u.session_version,u.locked_until,u.failed_login_count FROM public.users u WHERE u.email = lower(btrim(p_email)) $$;
ALTER FUNCTION public.auth_lookup_user(text) OWNER TO salescrm_auth;
REVOKE ALL ON FUNCTION public.auth_lookup_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_lookup_user(text) TO salescrm;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles parent ON parent.oid = m.roleid
    JOIN pg_roles member ON member.oid = m.member
    WHERE parent.rolname = 'salescrm_auth' AND member.rolname = 'salescrm'
  ) THEN
    RAISE EXCEPTION 'salescrm must not be a member of salescrm_auth';
  END IF;
END
$$;
