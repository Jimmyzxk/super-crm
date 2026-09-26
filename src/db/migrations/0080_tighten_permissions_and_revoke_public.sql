-- Migration: 0080_tighten_permissions_and_revoke_public.sql
-- Description: Revoke broad permissions from PUBLIC and tighten salescrm access on plugin_rate_limits

REVOKE ALL ON TABLE public.plugin_rate_limits FROM PUBLIC;
REVOKE DELETE ON TABLE public.plugin_rate_limits FROM salescrm;
GRANT SELECT, INSERT, UPDATE ON TABLE public.plugin_rate_limits TO salescrm;
