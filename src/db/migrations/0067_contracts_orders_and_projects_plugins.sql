-- 0067_contracts_orders_and_projects_plugins.sql
-- 开源版（AGPL-3.0）手术说明：
--   合同 / 订单 / 交付项目 / BI 报告四大业务插件为闭源组件，其 15 个 PG ENUM、
--   11 张表、RLS 策略与表级授权、以及向 plugin_registry 写入 contracts/orders/projects
--   启用记录的语句已整体移除。
--   本文件仅保留两段**核心**结构：
--     1. lead_source_keys 扩展（插件 API Token 鉴权 Scope / 限流 / IP 白名单）
--     2. leads 结构化渠道与 UTM 归因

-- 1. 扩展 lead_source_keys 支持外部 API Token 鉴权与 Scope
ALTER TABLE lead_source_keys ADD COLUMN IF NOT EXISTS scopes jsonb NOT NULL DEFAULT '["leads:write"]'::jsonb;
ALTER TABLE lead_source_keys ADD COLUMN IF NOT EXISTS rate_limit_per_minute int NOT NULL DEFAULT 60;
ALTER TABLE lead_source_keys ADD COLUMN IF NOT EXISTS allowed_ip_ranges text;

-- 2. 扩展 leads 表支持结构化渠道与 UTM 归因
ALTER TABLE leads ADD COLUMN IF NOT EXISTS channel varchar(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_source varchar(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_medium varchar(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_campaign varchar(50);
CREATE INDEX IF NOT EXISTS leads_channel_idx ON leads (tenant_id, channel) WHERE deleted_at IS NULL;
