-- Notification cleanup is an operational capability, not a capability that
-- the application role should have on the table itself.
GRANT DELETE ON notifications TO salescrm_migration;
GRANT SELECT (tenant_id, created_at) ON notifications TO salescrm_migration;

CREATE OR REPLACE FUNCTION public.cleanup_notifications_before(p_before timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.notifications
   WHERE tenant_id::text = current_setting('app.tenant_id', true)
     AND created_at < p_before;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

ALTER FUNCTION public.cleanup_notifications_before(timestamptz) OWNER TO salescrm_migration;
REVOKE ALL ON FUNCTION public.cleanup_notifications_before(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_notifications_before(timestamptz) TO salescrm;

REVOKE DELETE ON notifications FROM salescrm;
