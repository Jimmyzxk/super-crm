-- 0038_departments_user_profiles_and_audit_logs.sql

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  parent_id uuid REFERENCES departments(id),
  leader_user_id uuid REFERENCES users(id),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT departments_name_length CHECK (char_length(name) BETWEEN 1 AND 50)
);

CREATE INDEX IF NOT EXISTS departments_tenant_parent_idx
  ON departments (tenant_id, parent_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS departments_tenant_sort_idx
  ON departments (tenant_id, sort_order ASC, name ASC)
  WHERE deleted_at IS NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id),
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS employee_no text,
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS max_lead_quota integer NOT NULL DEFAULT 100;

CREATE INDEX IF NOT EXISTS users_tenant_department_idx
  ON users (tenant_id, department_id);

DO $$
BEGIN
  ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE departments FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS departments_tenant_isolation ON departments;
  CREATE POLICY departments_tenant_isolation ON departments
    USING (tenant_id::text = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO salescrm;
