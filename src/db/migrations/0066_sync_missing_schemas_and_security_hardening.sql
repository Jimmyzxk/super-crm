-- Migration 0065: Sync missing RLS hardening and claimed_at indexes
-- 开源版（AGPL-3.0）手术说明：
--   企业知识库插件（knowledge_base_*，闭源）与线索智能分发插件
--   （lead_routing_*，闭源）的 FORCE RLS 段已移除。
--   保留 sales_quotas / ai_* 核心表的 FORCE RLS 与 claimed_at 扫描索引。

DO $$
BEGIN
  -- 1. 强制 Sales Quotas 表启用 FORCE RLS
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_quotas') THEN
    ALTER TABLE public.sales_quotas FORCE ROW LEVEL SECURITY;
  END IF;

  -- 2. 强制 AI Agent Hub 表启用 FORCE RLS
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_prompt_templates') THEN
    ALTER TABLE public.ai_prompt_templates FORCE ROW LEVEL SECURITY;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_quality_inspections') THEN
    ALTER TABLE public.ai_quality_inspections FORCE ROW LEVEL SECURITY;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_agent_learning_logs') THEN
    ALTER TABLE public.ai_agent_learning_logs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- 3. 创建 claimed_at 索引加速公海回收扫描
CREATE INDEX IF NOT EXISTS leads_tenant_claimed_at_idx ON public.leads(tenant_id, claimed_at);
CREATE INDEX IF NOT EXISTS customers_tenant_claimed_at_idx ON public.customers(tenant_id, claimed_at);
