-- 0068_harden_ledger_constraints_and_lead_channel.sql
-- 开源版（AGPL-3.0）手术说明：
--   订单/合同/BI 插件（闭源）的账本约束段（plugin_order_payment_transactions、
--   plugin_order_payment_schedules、plugin_orders、plugin_ai_bi_reports 及其
--   plugin_report_trigger_type ENUM）已整体移除。
--   本文件仅保留 leads 结构化渠道与 UTM 归因（核心）。

-- 1. 扩展 leads 表支持结构化渠道与 UTM 归因
ALTER TABLE leads ADD COLUMN IF NOT EXISTS channel varchar(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_source varchar(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_medium varchar(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_campaign varchar(50);
CREATE INDEX IF NOT EXISTS leads_channel_idx ON leads (tenant_id, channel) WHERE deleted_at IS NULL;
