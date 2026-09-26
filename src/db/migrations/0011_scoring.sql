DO $$ BEGIN
  CREATE TYPE score_operator AS ENUM ('EXISTS', 'NOT_EXISTS', 'EQUALS', 'CONTAINS', 'STARTS_WITH', 'GT', 'GTE', 'IN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE score_feedback_verdict AS ENUM ('ACCURATE', 'INACCURATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS score_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label text NOT NULL,
  field text NOT NULL,
  operator score_operator NOT NULL,
  value text,
  weight integer NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT score_rules_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT score_rules_label_length CHECK (char_length(label) BETWEEN 1 AND 30),
  CONSTRAINT score_rules_field_allowed CHECK (field IN ('company_name', 'contact_email', 'title', 'source', 'created_hour', 'activity_count', 'last_activity_outcome')),
  CONSTRAINT score_rules_value_by_operator CHECK (
    (operator IN ('EXISTS', 'NOT_EXISTS') AND value IS NULL)
    OR (operator NOT IN ('EXISTS', 'NOT_EXISTS') AND value IS NOT NULL AND char_length(btrim(value)) BETWEEN 1 AND 200)
  ),
  CONSTRAINT score_rules_numeric_operator_field CHECK (operator NOT IN ('GT', 'GTE') OR field IN ('created_hour', 'activity_count')),
  CONSTRAINT score_rules_weight_range CHECK (weight BETWEEN -100 AND 100),
  CONSTRAINT score_rules_sort_order_nonnegative CHECK (sort_order >= 0)
);
CREATE INDEX IF NOT EXISTS score_rules_tenant_enabled_order_idx ON score_rules (tenant_id, enabled, sort_order);

CREATE TABLE IF NOT EXISTS score_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  user_id uuid NOT NULL,
  score_at_feedback integer NOT NULL,
  verdict score_feedback_verdict NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT score_feedback_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT score_feedback_lead_user_unique UNIQUE (lead_id, user_id),
  CONSTRAINT score_feedback_lead_tenant_fk FOREIGN KEY (tenant_id, lead_id) REFERENCES leads (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT score_feedback_user_tenant_fk FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT score_feedback_score_range CHECK (score_at_feedback BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS score_feedback_tenant_lead_idx ON score_feedback (tenant_id, lead_id, created_at DESC);

ALTER TABLE score_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS score_rules_tenant_isolation ON score_rules;
CREATE POLICY score_rules_tenant_isolation ON score_rules
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE score_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS score_feedback_tenant_isolation ON score_feedback;
CREATE POLICY score_feedback_tenant_isolation ON score_feedback
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT USAGE ON TYPE score_operator, score_feedback_verdict TO salescrm;
GRANT SELECT ON score_rules TO salescrm;
GRANT USAGE ON SCHEMA public TO salescrm_scoring;
GRANT USAGE ON TYPE score_operator TO salescrm_scoring;
GRANT INSERT ON score_rules TO salescrm_scoring;

CREATE OR REPLACE FUNCTION public.initialize_tenant_score_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  INSERT INTO public.score_rules (tenant_id, label, field, operator, value, weight, sort_order)
  VALUES
    (NEW.id, '填了公司名', 'company_name', 'EXISTS', NULL, 20, 10),
    (NEW.id, '填了邮箱', 'contact_email', 'EXISTS', NULL, 10, 20),
    (NEW.id, '有职位信息', 'title', 'EXISTS', NULL, 5, 30),
    (NEW.id, '来自表单', 'source', 'STARTS_WITH', 'form:', 15, 40),
    (NEW.id, '已联系过', 'activity_count', 'GTE', '1', 10, 50),
    (NEW.id, '明确有意向', 'last_activity_outcome', 'EQUALS', 'INTERESTED', 25, 60),
    (NEW.id, '明确拒绝', 'last_activity_outcome', 'EQUALS', 'REFUSED', -40, 70);
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.initialize_tenant_score_rules() OWNER TO salescrm_scoring;
REVOKE ALL ON FUNCTION public.initialize_tenant_score_rules() FROM PUBLIC;

DROP TRIGGER IF EXISTS tenants_initialize_score_rules ON tenants;
CREATE TRIGGER tenants_initialize_score_rules
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION public.initialize_tenant_score_rules();

INSERT INTO score_rules (tenant_id, label, field, operator, value, weight, sort_order)
SELECT tenant.id, rules.label, rules.field, rules.operator::score_operator, rules.value, rules.weight, rules.sort_order
FROM tenants tenant
CROSS JOIN (
  VALUES
    ('填了公司名', 'company_name', 'EXISTS', NULL::text, 20, 10),
    ('填了邮箱', 'contact_email', 'EXISTS', NULL::text, 10, 20),
    ('有职位信息', 'title', 'EXISTS', NULL::text, 5, 30),
    ('来自表单', 'source', 'STARTS_WITH', 'form:', 15, 40),
    ('已联系过', 'activity_count', 'GTE', '1', 10, 50),
    ('明确有意向', 'last_activity_outcome', 'EQUALS', 'INTERESTED', 25, 60),
    ('明确拒绝', 'last_activity_outcome', 'EQUALS', 'REFUSED', -40, 70)
) AS rules(label, field, operator, value, weight, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM score_rules existing WHERE existing.tenant_id = tenant.id);
