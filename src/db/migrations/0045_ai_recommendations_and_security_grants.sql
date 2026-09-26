-- 0045_ai_recommendations_and_security_grants.sql
-- 确保 ai_recommendations 与 security_compliance_configs 表权限与 RLS 策略完备

ALTER TABLE IF EXISTS ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ai_recommendations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_recommendations_tenant_isolation ON ai_recommendations;
CREATE POLICY ai_recommendations_tenant_isolation ON ai_recommendations
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE IF EXISTS security_compliance_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS security_compliance_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_compliance_configs_tenant_isolation ON security_compliance_configs;
CREATE POLICY security_compliance_configs_tenant_isolation ON security_compliance_configs
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_recommendations TO salescrm;
GRANT SELECT, INSERT, UPDATE, DELETE ON security_compliance_configs TO salescrm;
