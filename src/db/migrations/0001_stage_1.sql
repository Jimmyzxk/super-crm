DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'DISCARDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE discard_reason AS ENUM ('NO_NEED', 'NO_BUDGET', 'WRONG_CONTACT', 'INVALID_INFO', 'COMPETITOR', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE activity_type AS ENUM ('CALL', 'MEETING', 'VISIT', 'MESSAGE', 'NOTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE activity_outcome AS ENUM ('CONNECTED', 'NO_ANSWER', 'REFUSED', 'INTERESTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE task_type AS ENUM ('FIRST_RESPONSE', 'FOLLOW_UP', 'STAGE_PUSH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('OPEN', 'DONE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  owner_user_id uuid REFERENCES users(id),
  customer_id uuid,
  contact_name text NOT NULL,
  contact_phone text NOT NULL,
  contact_email text,
  company_name text,
  title text,
  note text,
  source text NOT NULL DEFAULT 'manual',
  status lead_status NOT NULL DEFAULT 'NEW',
  score integer,
  score_reason text,
  scored_at timestamptz,
  is_possible_duplicate boolean NOT NULL DEFAULT false,
  discard_reason discard_reason,
  discard_note text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_contact_name_length CHECK (char_length(contact_name) BETWEEN 1 AND 50),
  CONSTRAINT leads_contact_phone_format CHECK (contact_phone ~ '^1[3-9][0-9]{9}$'),
  CONSTRAINT leads_contact_email_length CHECK (contact_email IS NULL OR char_length(contact_email) <= 100),
  CONSTRAINT leads_contact_email_format CHECK (contact_email IS NULL OR contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT leads_company_name_length CHECK (company_name IS NULL OR char_length(company_name) <= 100),
  CONSTRAINT leads_title_length CHECK (title IS NULL OR char_length(title) <= 50),
  CONSTRAINT leads_note_length CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT leads_source_format CHECK (source IN ('manual', 'import') OR source ~ '^form:.+$'),
  CONSTRAINT leads_score_range CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  CONSTRAINT leads_score_reason_length CHECK (score_reason IS NULL OR char_length(score_reason) <= 500),
  CONSTRAINT leads_score_timestamp CHECK ((score IS NULL) = (scored_at IS NULL)),
  CONSTRAINT leads_discard_fields CHECK (
    (status = 'DISCARDED' AND discard_reason IS NOT NULL)
    OR (status <> 'DISCARDED' AND discard_reason IS NULL AND discard_note IS NULL)
  ),
  CONSTRAINT leads_discard_note_length CHECK (discard_note IS NULL OR char_length(discard_note) <= 200),
  CONSTRAINT leads_other_discard_note CHECK (discard_reason <> 'OTHER' OR (discard_note IS NOT NULL AND char_length(btrim(discard_note)) > 0))
);

CREATE INDEX IF NOT EXISTS leads_tenant_owner_status_idx ON leads (tenant_id, owner_user_id, status);
CREATE INDEX IF NOT EXISTS leads_tenant_phone_idx ON leads (tenant_id, contact_phone);
CREATE INDEX IF NOT EXISTS leads_tenant_score_idx ON leads (tenant_id, score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS leads_tenant_created_idx ON leads (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  lead_id uuid REFERENCES leads(id),
  customer_id uuid,
  opportunity_id uuid,
  user_id uuid NOT NULL REFERENCES users(id),
  type activity_type NOT NULL,
  outcome activity_outcome,
  summary text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activities_single_subject CHECK (num_nonnulls(lead_id, customer_id, opportunity_id) = 1),
  CONSTRAINT activities_summary_length CHECK (char_length(summary) BETWEEN 1 AND 200),
  CONSTRAINT activities_outcome_required CHECK (
    (type = 'NOTE' AND outcome IS NULL) OR (type <> 'NOTE' AND outcome IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS activities_tenant_lead_occurred_idx ON activities (tenant_id, lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activities_tenant_customer_occurred_idx ON activities (tenant_id, customer_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  lead_id uuid REFERENCES leads(id),
  customer_id uuid,
  opportunity_id uuid,
  assignee_user_id uuid NOT NULL REFERENCES users(id),
  type task_type NOT NULL,
  due_at timestamptz NOT NULL,
  status task_status NOT NULL DEFAULT 'OPEN',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_single_subject CHECK (num_nonnulls(lead_id, customer_id, opportunity_id) = 1),
  CONSTRAINT tasks_completed_timestamp CHECK (
    (status = 'DONE' AND completed_at IS NOT NULL) OR (status <> 'DONE' AND completed_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS tasks_open_lead_unique
  ON tasks (lead_id) WHERE status = 'OPEN' AND lead_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_open_customer_unique
  ON tasks (customer_id) WHERE status = 'OPEN' AND customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_open_opportunity_unique
  ON tasks (opportunity_id) WHERE status = 'OPEN' AND opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_tenant_assignee_status_due_idx
  ON tasks (tenant_id, assignee_user_id, status, due_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_action_length CHECK (char_length(action) BETWEEN 1 AND 100),
  CONSTRAINT audit_logs_subject_type_length CHECK (char_length(subject_type) BETWEEN 1 AND 50)
);

CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_idx ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_subject_idx ON audit_logs (tenant_id, subject_type, subject_id);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['leads', 'activities', 'tasks', 'audit_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END
$$;

GRANT USAGE ON TYPE lead_status, discard_reason, activity_type, activity_outcome, task_type, task_status TO salescrm;
GRANT SELECT, INSERT, UPDATE ON leads TO salescrm;
GRANT SELECT, INSERT ON activities TO salescrm;
GRANT SELECT, INSERT, UPDATE ON tasks TO salescrm;
REVOKE ALL ON audit_logs FROM salescrm;
GRANT SELECT, INSERT ON audit_logs TO salescrm;
REVOKE UPDATE, DELETE ON audit_logs FROM salescrm;
GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO salescrm;
