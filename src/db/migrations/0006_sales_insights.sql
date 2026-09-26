DO $$ BEGIN
  CREATE TYPE insight_severity AS ENUM ('INFO', 'ATTENTION', 'HIGH_RISK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE insight_status AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE insight_source AS ENUM ('RULE', 'PLAYBOOK', 'MODEL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_tenant_id_id_unique'
      AND conrelid = 'tasks'::regclass
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_tenant_id_id_unique UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sales_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  lead_id uuid,
  opportunity_id uuid,
  code text NOT NULL,
  severity insight_severity NOT NULL,
  status insight_status NOT NULL DEFAULT 'OPEN',
  title text NOT NULL,
  summary text NOT NULL,
  suggested_action text NOT NULL,
  suggested_due_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_type insight_source NOT NULL DEFAULT 'RULE',
  source_version text NOT NULL,
  dismiss_reason text,
  accepted_task_id uuid,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_insights_single_subject CHECK (num_nonnulls(lead_id, opportunity_id) = 1),
  CONSTRAINT sales_insights_evidence_array CHECK (jsonb_typeof(evidence) = 'array'),
  CONSTRAINT sales_insights_status_fields CHECK (
    (status = 'DISMISSED' AND dismiss_reason IS NOT NULL AND accepted_task_id IS NULL)
    OR (status = 'ACCEPTED' AND dismiss_reason IS NULL AND accepted_task_id IS NOT NULL)
    OR (status IN ('OPEN', 'EXPIRED') AND dismiss_reason IS NULL AND accepted_task_id IS NULL)
  ),
  CONSTRAINT sales_insights_lead_tenant_fk FOREIGN KEY (tenant_id, lead_id) REFERENCES leads (tenant_id, id),
  CONSTRAINT sales_insights_opportunity_tenant_fk FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities (tenant_id, id),
  CONSTRAINT sales_insights_accepted_task_tenant_fk FOREIGN KEY (tenant_id, accepted_task_id) REFERENCES tasks (tenant_id, id),
  CONSTRAINT sales_insights_code_length CHECK (char_length(code) BETWEEN 1 AND 100),
  CONSTRAINT sales_insights_title_length CHECK (char_length(title) BETWEEN 1 AND 100),
  CONSTRAINT sales_insights_summary_length CHECK (char_length(summary) BETWEEN 1 AND 500),
  CONSTRAINT sales_insights_action_length CHECK (char_length(suggested_action) BETWEEN 1 AND 500),
  CONSTRAINT sales_insights_source_version_length CHECK (char_length(source_version) BETWEEN 1 AND 100),
  CONSTRAINT sales_insights_dismiss_reason_length CHECK (dismiss_reason IS NULL OR char_length(dismiss_reason) BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_insights_open_lead_code_unique
  ON sales_insights (tenant_id, lead_id, code)
  WHERE status = 'OPEN' AND lead_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_insights_open_opportunity_code_unique
  ON sales_insights (tenant_id, opportunity_id, code)
  WHERE status = 'OPEN' AND opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_insights_tenant_status_created_idx
  ON sales_insights (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_insights_tenant_lead_idx
  ON sales_insights (tenant_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_insights_tenant_opportunity_idx
  ON sales_insights (tenant_id, opportunity_id, created_at DESC);

ALTER TABLE sales_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_insights FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_insights_tenant_isolation ON sales_insights;
CREATE POLICY sales_insights_tenant_isolation ON sales_insights
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT USAGE ON TYPE insight_severity, insight_status, insight_source TO salescrm;
GRANT SELECT, INSERT, UPDATE ON sales_insights TO salescrm;
REVOKE DELETE ON sales_insights FROM salescrm;
