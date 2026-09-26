-- 0039_deal_interventions_and_sales_schedules.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'intervention_type') THEN
    CREATE TYPE intervention_type AS ENUM (
      'EXECUTIVE_SPONSOR',
      'DISCOUNT_APPROVAL',
      'SOLUTION_SUPPORT',
      'STRATEGY_COACHING'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'intervention_status') THEN
    CREATE TYPE intervention_status AS ENUM (
      'REQUESTED',
      'IN_PROGRESS',
      'RESOLVED',
      'REJECTED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_type') THEN
    CREATE TYPE schedule_type AS ENUM (
      'CALL',
      'MEETING',
      'VISIT',
      'PROPOSAL_DEMO',
      'FOLLOW_UP'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_status') THEN
    CREATE TYPE schedule_status AS ENUM (
      'PENDING',
      'COMPLETED',
      'CANCELLED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS deal_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  intervention_type intervention_type NOT NULL DEFAULT 'STRATEGY_COACHING',
  status intervention_status NOT NULL DEFAULT 'REQUESTED',
  request_note text NOT NULL,
  manager_feedback text,
  coaching_notes text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deal_interventions_request_note_len CHECK (char_length(request_note) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS deal_interventions_tenant_opp_idx
  ON deal_interventions (tenant_id, opportunity_id);

CREATE INDEX IF NOT EXISTS deal_interventions_tenant_status_idx
  ON deal_interventions (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS deal_interventions_tenant_manager_idx
  ON deal_interventions (tenant_id, assigned_manager_id, status);

CREATE TABLE IF NOT EXISTS sales_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  schedule_type schedule_type NOT NULL DEFAULT 'FOLLOW_UP',
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  note text,
  status schedule_status NOT NULL DEFAULT 'PENDING',
  source text NOT NULL DEFAULT 'MANUAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_schedules_title_len CHECK (char_length(title) BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS sales_schedules_tenant_user_time_idx
  ON sales_schedules (tenant_id, user_id, start_at ASC);

CREATE INDEX IF NOT EXISTS sales_schedules_tenant_status_idx
  ON sales_schedules (tenant_id, status, start_at ASC);

-- 调整外键级联约束确保兼容
ALTER TABLE deal_interventions
  DROP CONSTRAINT IF EXISTS deal_interventions_opportunity_id_fkey,
  ADD CONSTRAINT deal_interventions_opportunity_id_fkey
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE;

ALTER TABLE sales_schedules
  DROP CONSTRAINT IF EXISTS sales_schedules_opportunity_id_fkey,
  ADD CONSTRAINT sales_schedules_opportunity_id_fkey
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE;

ALTER TABLE sales_schedules
  DROP CONSTRAINT IF EXISTS sales_schedules_lead_id_fkey,
  ADD CONSTRAINT sales_schedules_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE sales_schedules
  DROP CONSTRAINT IF EXISTS sales_schedules_customer_id_fkey,
  ADD CONSTRAINT sales_schedules_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['deal_interventions', 'sales_schedules'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_isolation', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
      tbl || '_tenant_isolation', tbl
    );
  END LOOP;
END $$;

GRANT USAGE ON TYPE intervention_type, intervention_status, schedule_type, schedule_status TO salescrm;
GRANT SELECT, INSERT, UPDATE, DELETE ON deal_interventions, sales_schedules TO salescrm;
