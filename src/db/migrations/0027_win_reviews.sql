CREATE TYPE win_review_status AS ENUM ('DRAFT', 'REVIEWED', 'REJECTED');

CREATE TABLE win_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  status win_review_status NOT NULL DEFAULT 'DRAFT',
  summary text NOT NULL DEFAULT '',
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  generation_failed_at timestamptz,
  generation_attempts integer NOT NULL DEFAULT 0 CHECK (generation_attempts >= 0),
  reviewed_by_user_id uuid,
  review_reason text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT win_reviews_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT win_reviews_tenant_opportunity_unique UNIQUE (tenant_id, opportunity_id),
  CONSTRAINT win_reviews_opportunity_tenant_fk FOREIGN KEY (tenant_id, opportunity_id)
    REFERENCES opportunities (tenant_id, id),
  CONSTRAINT win_reviews_reviewer_tenant_fk FOREIGN KEY (tenant_id, reviewed_by_user_id)
    REFERENCES users (tenant_id, id),
  CONSTRAINT win_reviews_json_shapes CHECK (
    jsonb_typeof(metrics) = 'object' AND jsonb_typeof(evidence) = 'array' AND jsonb_typeof(data_gaps) = 'array'
  ),
  CONSTRAINT win_reviews_review_fields CHECK (
    (status = 'DRAFT' AND reviewed_by_user_id IS NULL AND review_reason IS NULL AND reviewed_at IS NULL)
    OR (status IN ('REVIEWED', 'REJECTED') AND reviewed_by_user_id IS NOT NULL
      AND review_reason IS NOT NULL AND char_length(btrim(review_reason)) > 0 AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX win_reviews_tenant_status_idx ON win_reviews (tenant_id, status, updated_at DESC);
CREATE INDEX win_reviews_tenant_reviewer_idx ON win_reviews (tenant_id, reviewed_by_user_id, reviewed_at DESC);

CREATE FUNCTION prevent_win_review_terminal_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('REVIEWED', 'REJECTED') THEN
    RAISE EXCEPTION 'reviewed win review is immutable' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER win_reviews_terminal_immutable
  BEFORE UPDATE ON win_reviews
  FOR EACH ROW EXECUTE FUNCTION prevent_win_review_terminal_mutation();

ALTER TABLE win_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE win_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY win_reviews_tenant_isolation ON win_reviews
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT USAGE ON TYPE win_review_status TO salescrm;
GRANT SELECT, INSERT ON win_reviews TO salescrm;
GRANT UPDATE (
  summary, metrics, evidence, data_gaps, generation_failed_at, generation_attempts,
  status, reviewed_by_user_id, review_reason, reviewed_at, updated_at
) ON win_reviews TO salescrm;
