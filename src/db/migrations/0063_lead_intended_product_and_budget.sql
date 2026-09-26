-- 增加线索初始意向产品（外键关联产品库配置）与预估预算字段
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS intended_product_id uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS intended_product text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS budget text;

-- 外键关联（跨租户约束由业务层与租户 ID 保证，支持软删除关联）
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_intended_product_fk;
ALTER TABLE public.leads ADD CONSTRAINT leads_intended_product_fk
  FOREIGN KEY (intended_product_id) REFERENCES public.products(id) ON DELETE SET NULL;

-- 长度与格式检查约束
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_intended_product_length;
ALTER TABLE public.leads ADD CONSTRAINT leads_intended_product_length
  CHECK (intended_product IS NULL OR char_length(intended_product) <= 100);

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_budget_length;
ALTER TABLE public.leads ADD CONSTRAINT leads_budget_length
  CHECK (budget IS NULL OR char_length(budget) <= 50);
