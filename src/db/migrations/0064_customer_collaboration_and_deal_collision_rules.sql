-- 0064_customer_collaboration_and_deal_collision_rules.sql

-- 1. 创建客户共享协同设置表（默认关闭多人跟进）
CREATE TABLE IF NOT EXISTS public.customer_collaboration_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  allow_multi_sales_followup boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_collaboration_settings_tenant_unique UNIQUE (tenant_id)
);

-- RLS 策略配置
ALTER TABLE public.customer_collaboration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_collaboration_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_collaboration_settings_tenant_isolation ON public.customer_collaboration_settings;
DROP POLICY IF EXISTS tenant_isolation_policy ON public.customer_collaboration_settings;

CREATE POLICY customer_collaboration_settings_tenant_isolation ON public.customer_collaboration_settings
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_collaboration_settings TO salescrm;

-- 2. 扩展商机意向产品字段（支持跨产品线排他防撞单）
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS intended_product_id uuid;
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS intended_product text;

ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_intended_product_fk;
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_intended_product_fk
  FOREIGN KEY (intended_product_id) REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS opportunities_tenant_customer_product_idx
  ON public.opportunities (tenant_id, customer_id, intended_product_id)
  WHERE deleted_at IS NULL;
