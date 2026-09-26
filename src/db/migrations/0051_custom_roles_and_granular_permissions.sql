-- Migration 0051: Custom roles and granular permissions tables and constraints

CREATE TABLE IF NOT EXISTS custom_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  CONSTRAINT custom_roles_tenant_code_unique UNIQUE (tenant_id, code),
  CONSTRAINT custom_roles_name_len CHECK (char_length(name) BETWEEN 1 AND 50),
  CONSTRAINT custom_roles_code_len CHECK (char_length(code) BETWEEN 1 AND 50)
);

CREATE INDEX IF NOT EXISTS custom_roles_tenant_idx ON custom_roles(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_role_assignments_unique UNIQUE (tenant_id, user_id, role_id)
);

CREATE INDEX IF NOT EXISTS user_role_assignments_tenant_user_idx ON user_role_assignments(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS user_role_assignments_tenant_role_idx ON user_role_assignments(tenant_id, role_id);

ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS custom_roles_tenant_isolation ON custom_roles;
CREATE POLICY custom_roles_tenant_isolation ON custom_roles
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_role_assignments_tenant_isolation ON user_role_assignments;
CREATE POLICY user_role_assignments_tenant_isolation ON user_role_assignments
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON custom_roles, user_role_assignments TO salescrm;

