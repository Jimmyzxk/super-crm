DO $$ BEGIN
  CREATE ROLE salescrm_scoring NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER ROLE salescrm_scoring NOLOGIN NOINHERIT BYPASSRLS;
GRANT USAGE ON SCHEMA public TO salescrm_scoring;
GRANT USAGE ON TYPE score_operator TO salescrm_scoring;
GRANT INSERT ON score_rules TO salescrm_scoring;

REVOKE INSERT ON score_rules FROM salescrm_auth;
REVOKE USAGE ON TYPE score_operator, score_feedback_verdict FROM salescrm_auth;

ALTER FUNCTION public.initialize_tenant_score_rules() OWNER TO salescrm_scoring;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_auth_members membership
    JOIN pg_roles parent ON parent.oid = membership.roleid
    JOIN pg_roles member ON member.oid = membership.member
    WHERE parent.rolname = 'salescrm_scoring' AND member.rolname = 'salescrm'
  ) THEN
    RAISE EXCEPTION 'salescrm must not be a member of salescrm_scoring';
  END IF;
END
$$;
