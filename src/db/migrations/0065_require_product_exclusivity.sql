-- 0065: 排他保护开关落库（此前仅 UI 幽灵开关：保存即丢，规则永远开启）
-- 默认 true 保持既有行为（排他保护默认开启）
ALTER TABLE public.customer_collaboration_settings
  ADD COLUMN IF NOT EXISTS require_product_exclusivity boolean NOT NULL DEFAULT true;
