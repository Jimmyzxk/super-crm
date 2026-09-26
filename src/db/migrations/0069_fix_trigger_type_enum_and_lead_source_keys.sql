-- 0069_fix_trigger_type_enum_and_lead_source_keys.sql
-- 开源版（AGPL-3.0）手术说明：
--   BI 插件 trigger_type ENUM 修复段（plugin_ai_bi_reports / plugin_report_trigger_type）
--   已整体移除（BI 插件为闭源组件，其表与 ENUM 不在本仓库迁移中）。
--   保留 lead_source_keys 结构化列补齐与授权（核心 OpenAPI 鉴权）。

-- 1. 确保 lead_source_keys 结构化列补齐
ALTER TABLE lead_source_keys ADD COLUMN IF NOT EXISTS scopes jsonb NOT NULL DEFAULT '["leads:write"]'::jsonb;
ALTER TABLE lead_source_keys ADD COLUMN IF NOT EXISTS rate_limit_per_minute int NOT NULL DEFAULT 60;
ALTER TABLE lead_source_keys ADD COLUMN IF NOT EXISTS allowed_ip_ranges text;

GRANT SELECT (scopes, rate_limit_per_minute, allowed_ip_ranges),
      INSERT (scopes, rate_limit_per_minute, allowed_ip_ranges),
      UPDATE (scopes, rate_limit_per_minute, allowed_ip_ranges)
  ON lead_source_keys TO salescrm;
GRANT SELECT ON lead_source_keys TO salescrm_auth;
