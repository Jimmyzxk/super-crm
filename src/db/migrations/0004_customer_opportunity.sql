DO $$ BEGIN
  CREATE TYPE customer_size AS ENUM ('1-20', '21-100', '101-500', '501-1000', '1000+');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE opportunity_stage AS ENUM ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE lost_reason AS ENUM ('PRICE', 'COMPETITOR', 'NO_BUDGET', 'NO_DECISION', 'TIMING', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  owner_user_id uuid NOT NULL,
  name text NOT NULL,
  industry text,
  region text,
  size customer_size,
  from_lead_id uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT customers_name_length CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT customers_industry_length CHECK (industry IS NULL OR char_length(industry) <= 50),
  CONSTRAINT customers_region_length CHECK (region IS NULL OR char_length(region) <= 50)
);
CREATE INDEX IF NOT EXISTS customers_tenant_owner_idx ON customers (tenant_id, owner_user_id);
CREATE INDEX IF NOT EXISTS customers_tenant_name_idx ON customers (tenant_id, name);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  customer_id uuid NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  title text,
  is_primary boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT contacts_tenant_customer_id_unique UNIQUE (tenant_id, customer_id, id),
  CONSTRAINT contacts_name_length CHECK (char_length(name) BETWEEN 1 AND 50),
  CONSTRAINT contacts_phone_format CHECK (phone ~ '^1[3-9][0-9]{9}$'),
  CONSTRAINT contacts_email_length CHECK (email IS NULL OR char_length(email) <= 100),
  CONSTRAINT contacts_email_format CHECK (email IS NULL OR email ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'),
  CONSTRAINT contacts_title_length CHECK (title IS NULL OR char_length(title) <= 50)
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_phone_unique
  ON contacts (tenant_id, phone) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_customer_primary_unique
  ON contacts (customer_id) WHERE is_primary = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contacts_tenant_customer_idx ON contacts (tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  customer_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  primary_contact_id uuid,
  from_lead_id uuid,
  name text NOT NULL,
  stage opportunity_stage NOT NULL DEFAULT 'DISCOVERY',
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  expected_amount bigint,
  expected_close_at date,
  actual_amount bigint,
  actual_close_at date,
  demand_note text,
  lost_reason lost_reason,
  lost_note text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunities_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT opportunities_name_length CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT opportunities_expected_amount_nonnegative CHECK (expected_amount IS NULL OR expected_amount >= 0),
  CONSTRAINT opportunities_actual_amount_nonnegative CHECK (actual_amount IS NULL OR actual_amount >= 0),
  CONSTRAINT opportunities_demand_note_length CHECK (demand_note IS NULL OR char_length(demand_note) <= 500),
  CONSTRAINT opportunities_lost_note_length CHECK (lost_note IS NULL OR char_length(lost_note) <= 200),
  CONSTRAINT opportunities_lost_fields CHECK ((stage = 'LOST' AND lost_reason IS NOT NULL AND (lost_reason <> 'OTHER' OR (lost_note IS NOT NULL AND char_length(btrim(lost_note)) > 0))) OR (stage <> 'LOST' AND lost_reason IS NULL AND lost_note IS NULL)),
  CONSTRAINT opportunities_won_fields CHECK ((stage = 'WON' AND actual_amount IS NOT NULL AND actual_close_at IS NOT NULL) OR (stage <> 'WON' AND actual_amount IS NULL AND actual_close_at IS NULL))
);
CREATE INDEX IF NOT EXISTS opportunities_tenant_owner_stage_idx ON opportunities (tenant_id, owner_user_id, stage);
CREATE INDEX IF NOT EXISTS opportunities_tenant_customer_idx ON opportunities (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS opportunities_tenant_expected_close_idx ON opportunities (tenant_id, expected_close_at);

CREATE TABLE IF NOT EXISTS opportunity_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  opportunity_id uuid NOT NULL,
  from_stage opportunity_stage,
  to_stage opportunity_stage NOT NULL,
  note text,
  operator_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_stage_history_transition_check CHECK (from_stage IS NULL OR from_stage <> to_stage),
  CONSTRAINT opportunity_stage_history_note_length CHECK (note IS NULL OR char_length(note) <= 200),
  CONSTRAINT opportunity_stage_history_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS opportunity_stage_history_tenant_opportunity_idx
  ON opportunity_stage_history (tenant_id, opportunity_id, created_at DESC);

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT 'leads'::text AS table_name, 'customer_id'::text AS column_name, l.tenant_id, l.customer_id::text AS value
    FROM leads l LEFT JOIN customers c ON c.tenant_id = l.tenant_id AND c.id = l.customer_id
    WHERE l.customer_id IS NOT NULL AND c.id IS NULL
    UNION ALL
    SELECT 'tasks', 'customer_id', t.tenant_id, t.customer_id::text
    FROM tasks t LEFT JOIN customers c ON c.tenant_id = t.tenant_id AND c.id = t.customer_id
    WHERE t.customer_id IS NOT NULL AND c.id IS NULL
    UNION ALL
    SELECT 'tasks', 'opportunity_id', t.tenant_id, t.opportunity_id::text
    FROM tasks t LEFT JOIN opportunities o ON o.tenant_id = t.tenant_id AND o.id = t.opportunity_id
    WHERE t.opportunity_id IS NOT NULL AND o.id IS NULL
    UNION ALL
    SELECT 'activities', 'customer_id', a.tenant_id, a.customer_id::text
    FROM activities a LEFT JOIN customers c ON c.tenant_id = a.tenant_id AND c.id = a.customer_id
    WHERE a.customer_id IS NOT NULL AND c.id IS NULL
    UNION ALL
    SELECT 'activities', 'opportunity_id', a.tenant_id, a.opportunity_id::text
    FROM activities a LEFT JOIN opportunities o ON o.tenant_id = a.tenant_id AND o.id = a.opportunity_id
    WHERE a.opportunity_id IS NOT NULL AND o.id IS NULL
  LOOP
    RAISE EXCEPTION 'stage 4 migration blocked: table=%, column=%, tenant_id=%, dangling_uuid=%', r.table_name, r.column_name, r.tenant_id, r.value;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_owner_user_tenant_fk') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_owner_user_tenant_fk FOREIGN KEY (tenant_id, owner_user_id) REFERENCES users (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_from_lead_tenant_fk') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_from_lead_tenant_fk FOREIGN KEY (tenant_id, from_lead_id) REFERENCES leads (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_customer_tenant_fk') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_customer_tenant_fk FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_customer_tenant_fk') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_customer_tenant_fk FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_owner_user_tenant_fk') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_owner_user_tenant_fk FOREIGN KEY (tenant_id, owner_user_id) REFERENCES users (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_contact_tenant_fk') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_contact_tenant_fk FOREIGN KEY (tenant_id, customer_id, primary_contact_id) REFERENCES contacts (tenant_id, customer_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_from_lead_tenant_fk') THEN
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_from_lead_tenant_fk FOREIGN KEY (tenant_id, from_lead_id) REFERENCES leads (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_history_opportunity_tenant_fk') THEN
    ALTER TABLE opportunity_stage_history ADD CONSTRAINT opportunity_history_opportunity_tenant_fk FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_history_operator_tenant_fk') THEN
    ALTER TABLE opportunity_stage_history ADD CONSTRAINT opportunity_history_operator_tenant_fk FOREIGN KEY (tenant_id, operator_user_id) REFERENCES users (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_customer_tenant_fk') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_customer_tenant_fk FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_customer_tenant_fk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_customer_tenant_fk FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_opportunity_tenant_fk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_opportunity_tenant_fk FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_customer_tenant_fk') THEN
    ALTER TABLE activities ADD CONSTRAINT activities_customer_tenant_fk FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_opportunity_tenant_fk') THEN
    ALTER TABLE activities ADD CONSTRAINT activities_opportunity_tenant_fk FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities (tenant_id, id);
  END IF;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['customers', 'contacts', 'opportunities', 'opportunity_stage_history'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))', table_name || '_tenant_isolation', table_name);
  END LOOP;
END $$;

GRANT USAGE ON TYPE customer_size, opportunity_stage, lost_reason TO salescrm;
GRANT SELECT, INSERT, UPDATE ON customers, contacts, opportunities TO salescrm;
GRANT SELECT, INSERT ON opportunity_stage_history TO salescrm;
REVOKE UPDATE, DELETE ON opportunity_stage_history FROM salescrm;
REVOKE DELETE ON contacts FROM salescrm;
