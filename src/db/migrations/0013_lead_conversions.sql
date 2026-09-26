-- Cross-pool provenance is append-only. The legacy source columns remain in
-- place for this migration window, but are not part of the new write path.
ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_tenant_id_id_customer_id_unique
  UNIQUE (tenant_id, id, customer_id);

CREATE TABLE lead_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  lead_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  converted_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_conversions_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT lead_conversions_tenant_lead_unique UNIQUE (tenant_id, lead_id),
  CONSTRAINT lead_conversions_tenant_opportunity_unique UNIQUE (tenant_id, opportunity_id),
  CONSTRAINT lead_conversions_lead_tenant_fk
    FOREIGN KEY (tenant_id, lead_id) REFERENCES leads (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT lead_conversions_customer_tenant_fk
    FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT lead_conversions_opportunity_customer_tenant_fk
    FOREIGN KEY (tenant_id, opportunity_id, customer_id)
    REFERENCES opportunities (tenant_id, id, customer_id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT lead_conversions_user_tenant_fk
    FOREIGN KEY (tenant_id, converted_by_user_id) REFERENCES users (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX lead_conversions_tenant_customer_created_idx
  ON lead_conversions (tenant_id, customer_id, created_at DESC, id DESC);
CREATE INDEX lead_conversions_tenant_lead_created_idx
  ON lead_conversions (tenant_id, lead_id, created_at DESC, id DESC);

CREATE TABLE lead_conversion_backfill_issues (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issue_key text NOT NULL UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  lead_id uuid NOT NULL,
  reason_code text NOT NULL,
  legacy_customer_id uuid,
  legacy_opportunity_ids uuid[],
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_conversion_backfill_issues_tenant_lead_idx
  ON lead_conversion_backfill_issues (tenant_id, lead_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.validate_lead_conversion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  current_status text;
BEGIN
  SELECT status::text INTO current_status
  FROM leads
  WHERE tenant_id = NEW.tenant_id AND id = NEW.lead_id;

  IF current_status IS DISTINCT FROM 'CONVERTED' THEN
    RAISE EXCEPTION 'lead conversion requires CONVERTED lead: tenant_id=%, lead_id=%', NEW.tenant_id, NEW.lead_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER lead_conversions_consistency_ct
AFTER INSERT ON lead_conversions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_lead_conversion();

-- The backfill is intentionally evidence-driven. It is retained for an
-- operator-led migration/retry, but no application role may execute it.
CREATE OR REPLACE FUNCTION public.backfill_lead_conversions(p_batch_size integer DEFAULT 500)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  candidate record;
  status_evidence record;
  audit_evidence record;
  opportunity_customer uuid;
  evidence_actor uuid;
  evidence_time timestamptz;
  reason text;
  migrated_count bigint := 0;
  affected_count bigint;
  computed_issue_key text;
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'backfill batch size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  FOR candidate IN
    SELECT l.tenant_id, l.id AS lead_id, l.status::text AS lead_status,
      l.customer_id AS legacy_customer_id,
      ARRAY(
        SELECT DISTINCT source.customer_id
        FROM (
          SELECT l.customer_id
          WHERE l.customer_id IS NOT NULL
          UNION ALL
          SELECT c.id
          FROM customers c
          WHERE c.tenant_id = l.tenant_id AND c.from_lead_id = l.id
          UNION ALL
          SELECT o.customer_id
          FROM opportunities o
          WHERE o.tenant_id = l.tenant_id AND o.from_lead_id = l.id
        ) source
        ORDER BY source.customer_id
      ) AS customer_ids,
      (SELECT array_agg(o.id ORDER BY o.id)
       FROM opportunities o
       WHERE o.tenant_id = l.tenant_id AND o.from_lead_id = l.id) AS opportunity_ids
    FROM leads l
    WHERE (
      l.customer_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM customers c WHERE c.tenant_id = l.tenant_id AND c.from_lead_id = l.id)
      OR EXISTS (SELECT 1 FROM opportunities o WHERE o.tenant_id = l.tenant_id AND o.from_lead_id = l.id)
    )
      AND NOT EXISTS (
        SELECT 1 FROM lead_conversions existing
        WHERE existing.tenant_id = l.tenant_id AND existing.lead_id = l.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM lead_conversion_backfill_issues existing_issue
        WHERE existing_issue.tenant_id = l.tenant_id AND existing_issue.lead_id = l.id
      )
    ORDER BY l.tenant_id, l.id
    LIMIT p_batch_size
    FOR UPDATE OF l
  LOOP
    reason := NULL;
    evidence_actor := NULL;
    evidence_time := NULL;

    SELECT count(*)::int AS evidence_count,
      (array_agg(h.actor_user_id ORDER BY h.created_at, h.id))[1] AS actor_user_id,
      min(h.created_at) AS evidence_time
    INTO status_evidence
    FROM lead_status_history h
    WHERE h.tenant_id = candidate.tenant_id
      AND h.lead_id = candidate.lead_id
      AND h.to_status = 'CONVERTED';

    SELECT count(*)::int AS evidence_count,
      (array_agg(a.actor_user_id ORDER BY a.created_at, a.id))[1] AS actor_user_id,
      min(a.created_at) AS evidence_time
    INTO audit_evidence
    FROM audit_logs a
    WHERE a.tenant_id = candidate.tenant_id
      AND a.subject_type = 'lead'
      AND a.subject_id = candidate.lead_id
      AND a.action = 'lead.convert';

    IF candidate.lead_status <> 'CONVERTED' THEN
      reason := 'LEAD_NOT_CONVERTED';
    ELSIF coalesce(cardinality(candidate.customer_ids), 0) <> 1 THEN
      reason := 'CUSTOMER_MAPPING_NOT_UNIQUE';
    ELSIF coalesce(cardinality(candidate.opportunity_ids), 0) <> 1 THEN
      reason := 'OPPORTUNITY_MAPPING_NOT_UNIQUE';
    ELSE
      SELECT o.customer_id INTO opportunity_customer
      FROM opportunities o
      WHERE o.tenant_id = candidate.tenant_id
        AND o.id = candidate.opportunity_ids[1];

      IF opportunity_customer IS DISTINCT FROM candidate.customer_ids[1] THEN
        reason := 'OPPORTUNITY_CUSTOMER_MISMATCH';
      ELSIF EXISTS (
        SELECT 1 FROM lead_conversions existing
        WHERE existing.tenant_id = candidate.tenant_id
          AND existing.opportunity_id = candidate.opportunity_ids[1]
          AND existing.lead_id <> candidate.lead_id
      ) THEN
        reason := 'OPPORTUNITY_ALREADY_CONVERTED';
      ELSIF status_evidence.evidence_count <> 1 AND audit_evidence.evidence_count <> 1 THEN
        reason := 'CONVERSION_EVIDENCE_NOT_UNIQUE';
      ELSIF status_evidence.evidence_count = 1 AND audit_evidence.evidence_count = 1
        AND (status_evidence.actor_user_id IS DISTINCT FROM audit_evidence.actor_user_id
          OR status_evidence.evidence_time IS DISTINCT FROM audit_evidence.evidence_time) THEN
        reason := 'CONVERSION_EVIDENCE_CONFLICT';
      ELSE
        IF status_evidence.evidence_count = 1 THEN
          evidence_actor := status_evidence.actor_user_id;
          evidence_time := status_evidence.evidence_time;
        ELSE
          evidence_actor := audit_evidence.actor_user_id;
          evidence_time := audit_evidence.evidence_time;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.tenant_id = candidate.tenant_id AND u.id = evidence_actor
        ) THEN
          reason := 'CONVERSION_ACTOR_NOT_IN_TENANT';
        END IF;
      END IF;
    END IF;

    IF reason IS NOT NULL THEN
      computed_issue_key := md5(concat_ws('|', candidate.tenant_id::text, candidate.lead_id::text, reason,
        coalesce(candidate.legacy_customer_id::text, ''), coalesce(array_to_string(candidate.opportunity_ids, ','), '')));
      INSERT INTO lead_conversion_backfill_issues
        (issue_key, tenant_id, lead_id, reason_code, legacy_customer_id, legacy_opportunity_ids, evidence)
      VALUES
        (computed_issue_key, candidate.tenant_id, candidate.lead_id, reason, candidate.legacy_customer_id,
         candidate.opportunity_ids,
         jsonb_build_object('leadStatus', candidate.lead_status, 'customerIds', candidate.customer_ids,
           'opportunityIds', candidate.opportunity_ids, 'statusEvidenceCount', status_evidence.evidence_count,
           'auditEvidenceCount', audit_evidence.evidence_count))
      ON CONFLICT (issue_key) DO NOTHING;
      CONTINUE;
    END IF;

    INSERT INTO lead_conversions
      (tenant_id, lead_id, customer_id, opportunity_id, converted_by_user_id, created_at)
    VALUES
      (candidate.tenant_id, candidate.lead_id, candidate.customer_ids[1], candidate.opportunity_ids[1], evidence_actor, evidence_time)
    ON CONFLICT (tenant_id, lead_id) DO NOTHING;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    migrated_count := migrated_count + affected_count;
  END LOOP;

  RETURN migrated_count;
END;
$$;

-- This migration deliberately does not invoke the backfill. Production data
-- must be assessed in a maintenance window, in batches, with the issue table
-- reviewed before any read-path switch. The function is an operator-only,
-- evidence-driven step for that controlled window.
GRANT CREATE ON SCHEMA public TO salescrm_migration;
ALTER FUNCTION public.backfill_lead_conversions(integer) OWNER TO salescrm_migration;
REVOKE CREATE ON SCHEMA public FROM salescrm_migration;

-- The migration role is deliberately separate from the authentication role.
-- It is only usable through an explicit SET ROLE from the owner connection.
GRANT USAGE ON SCHEMA public TO salescrm_migration;
GRANT SELECT ON leads, customers, opportunities, users, lead_status_history, audit_logs TO salescrm_migration;
GRANT UPDATE (id) ON leads TO salescrm_migration;
GRANT SELECT, INSERT ON lead_conversions, lead_conversion_backfill_issues TO salescrm_migration;
GRANT USAGE, SELECT ON SEQUENCE lead_conversion_backfill_issues_id_seq TO salescrm_migration;

ALTER TABLE lead_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_conversions FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_conversions_tenant_isolation ON lead_conversions
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE lead_conversion_backfill_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_conversion_backfill_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_conversion_backfill_issues_tenant_isolation ON lead_conversion_backfill_issues
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

REVOKE ALL ON lead_conversions FROM PUBLIC;
GRANT SELECT, INSERT ON lead_conversions TO salescrm;
REVOKE UPDATE, DELETE ON lead_conversions FROM salescrm;
REVOKE ALL ON lead_conversion_backfill_issues FROM PUBLIC, salescrm;
REVOKE ALL ON FUNCTION public.backfill_lead_conversions(integer) FROM PUBLIC, salescrm, salescrm_auth;
REVOKE ALL ON FUNCTION public.validate_lead_conversion() FROM PUBLIC, salescrm;
