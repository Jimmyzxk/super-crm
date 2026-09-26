CREATE TYPE sales_playbook_status AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE sales_playbook_feedback_verdict AS ENUM ('HELPFUL', 'NOT_HELPFUL', 'NOT_APPLICABLE');

CREATE TABLE sales_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  family_key text NOT NULL,
  version integer NOT NULL,
  status sales_playbook_status NOT NULL DEFAULT 'DRAFT',
  name text NOT NULL,
  target_stage opportunity_stage NOT NULL,
  applicable_industries jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_industries jsonb NOT NULL DEFAULT '[]'::jsonb,
  applicable_regions jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_regions jsonb NOT NULL DEFAULT '[]'::jsonb,
  applicable_customer_sizes jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_customer_sizes jsonb NOT NULL DEFAULT '[]'::jsonb,
  checkpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_cadence jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  common_risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  claim_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid NOT NULL,
  published_by_user_id uuid,
  publish_reason text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_playbooks_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT sales_playbooks_tenant_family_version_unique UNIQUE (tenant_id, family_key, version),
  CONSTRAINT sales_playbooks_creator_tenant_fk FOREIGN KEY (tenant_id, created_by_user_id)
    REFERENCES users (tenant_id, id),
  CONSTRAINT sales_playbooks_publisher_tenant_fk FOREIGN KEY (tenant_id, published_by_user_id)
    REFERENCES users (tenant_id, id),
  CONSTRAINT sales_playbooks_family_key_format CHECK (family_key ~ '^[a-z][a-z0-9-]{2,49}$'),
  CONSTRAINT sales_playbooks_version_positive CHECK (version >= 1),
  CONSTRAINT sales_playbooks_name_length CHECK (char_length(btrim(name)) between 1 and 100),
  CONSTRAINT sales_playbooks_target_stage CHECK (target_stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')),
  CONSTRAINT sales_playbooks_json_shapes CHECK (
    jsonb_typeof(applicable_industries) = 'array'
    AND jsonb_typeof(excluded_industries) = 'array'
    AND jsonb_typeof(applicable_regions) = 'array'
    AND jsonb_typeof(excluded_regions) = 'array'
    AND jsonb_typeof(applicable_customer_sizes) = 'array'
    AND jsonb_typeof(excluded_customer_sizes) = 'array'
    AND jsonb_typeof(checkpoints) = 'array'
    AND jsonb_typeof(recommended_cadence) = 'array'
    AND jsonb_typeof(effective_actions) = 'array'
    AND jsonb_typeof(common_risks) = 'array'
    AND jsonb_typeof(claim_evidence) = 'object'
  ),
  CONSTRAINT sales_playbooks_customer_size_scope CHECK (
    applicable_customer_sizes <@ '["1-20", "21-100", "101-500", "501-1000", "1000+"]'::jsonb
    AND excluded_customer_sizes <@ '["1-20", "21-100", "101-500", "501-1000", "1000+"]'::jsonb
  ),
  CONSTRAINT sales_playbooks_claim_evidence_shape CHECK (
    claim_evidence ?& ARRAY['checkpoints', 'recommendedCadence', 'effectiveActions', 'commonRisks']
    AND jsonb_typeof(claim_evidence -> 'checkpoints') = 'array'
    AND jsonb_typeof(claim_evidence -> 'recommendedCadence') = 'array'
    AND jsonb_typeof(claim_evidence -> 'effectiveActions') = 'array'
    AND jsonb_typeof(claim_evidence -> 'commonRisks') = 'array'
    AND jsonb_array_length(claim_evidence -> 'checkpoints') > 0
    AND jsonb_array_length(claim_evidence -> 'recommendedCadence') > 0
    AND jsonb_array_length(claim_evidence -> 'effectiveActions') > 0
    AND jsonb_array_length(claim_evidence -> 'commonRisks') > 0
  ),
  CONSTRAINT sales_playbooks_content_nonempty CHECK (
    jsonb_array_length(checkpoints) > 0
    AND jsonb_array_length(recommended_cadence) > 0
    AND jsonb_array_length(effective_actions) > 0
    AND jsonb_array_length(common_risks) > 0
  ),
  CONSTRAINT sales_playbooks_publish_fields CHECK (
    (status = 'DRAFT' AND published_by_user_id IS NULL AND publish_reason IS NULL AND published_at IS NULL)
    OR (status in ('PUBLISHED', 'RETIRED') AND published_by_user_id IS NOT NULL
      AND publish_reason IS NOT NULL AND char_length(btrim(publish_reason)) between 1 and 500 AND published_at IS NOT NULL)
  )
);

CREATE TABLE sales_playbook_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  playbook_id uuid NOT NULL,
  win_review_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_playbook_samples_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT sales_playbook_samples_playbook_review_unique UNIQUE (tenant_id, playbook_id, win_review_id),
  CONSTRAINT sales_playbook_samples_playbook_tenant_fk FOREIGN KEY (tenant_id, playbook_id)
    REFERENCES sales_playbooks (tenant_id, id),
  CONSTRAINT sales_playbook_samples_review_tenant_fk FOREIGN KEY (tenant_id, win_review_id)
    REFERENCES win_reviews (tenant_id, id)
);

CREATE TABLE sales_playbook_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  playbook_id uuid NOT NULL,
  playbook_family_key text NOT NULL,
  playbook_version integer NOT NULL,
  user_id uuid NOT NULL,
  verdict sales_playbook_feedback_verdict NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_playbook_feedback_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT sales_playbook_feedback_subject_user_unique UNIQUE (tenant_id, opportunity_id, playbook_id, user_id),
  CONSTRAINT sales_playbook_feedback_opportunity_tenant_fk FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES opportunities (tenant_id, id),
  CONSTRAINT sales_playbook_feedback_playbook_tenant_fk FOREIGN KEY (tenant_id, playbook_id)
    REFERENCES sales_playbooks (tenant_id, id),
  CONSTRAINT sales_playbook_feedback_user_tenant_fk FOREIGN KEY (tenant_id, user_id)
    REFERENCES users (tenant_id, id),
  CONSTRAINT sales_playbook_feedback_version_positive CHECK (playbook_version >= 1),
  CONSTRAINT sales_playbook_feedback_reason CHECK (
    (verdict = 'HELPFUL' AND (reason IS NULL OR char_length(btrim(reason)) between 1 and 500))
    OR (verdict in ('NOT_HELPFUL', 'NOT_APPLICABLE') AND reason IS NOT NULL AND char_length(btrim(reason)) between 1 and 500)
  )
);

CREATE INDEX sales_playbooks_tenant_stage_published_idx
  ON sales_playbooks (tenant_id, target_stage, published_at DESC, id DESC)
  WHERE status = 'PUBLISHED';
CREATE INDEX sales_playbooks_tenant_family_version_idx
  ON sales_playbooks (tenant_id, family_key, version DESC);
CREATE INDEX sales_playbook_samples_tenant_playbook_idx
  ON sales_playbook_samples (tenant_id, playbook_id);
CREATE INDEX sales_playbook_feedback_tenant_opportunity_idx
  ON sales_playbook_feedback (tenant_id, opportunity_id, updated_at DESC);

CREATE FUNCTION prevent_sales_playbook_terminal_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'published or retired sales playbook is immutable' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_playbooks_terminal_immutable
  BEFORE UPDATE ON sales_playbooks
  FOR EACH ROW EXECUTE FUNCTION prevent_sales_playbook_terminal_mutation();

ALTER TABLE sales_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_playbooks FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_playbooks_tenant_isolation ON sales_playbooks
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE sales_playbook_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_playbook_samples FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_playbook_samples_tenant_isolation ON sales_playbook_samples
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE sales_playbook_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_playbook_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_playbook_feedback_tenant_isolation ON sales_playbook_feedback
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

REVOKE ALL ON sales_playbooks, sales_playbook_samples, sales_playbook_feedback FROM PUBLIC;
GRANT USAGE ON TYPE sales_playbook_status, sales_playbook_feedback_verdict TO salescrm;
GRANT SELECT, INSERT ON sales_playbooks TO salescrm;
GRANT UPDATE (status, published_by_user_id, publish_reason, published_at, updated_at) ON sales_playbooks TO salescrm;
GRANT SELECT, INSERT ON sales_playbook_samples TO salescrm;
GRANT SELECT, INSERT ON sales_playbook_feedback TO salescrm;
GRANT UPDATE (verdict, reason, updated_at) ON sales_playbook_feedback TO salescrm;
