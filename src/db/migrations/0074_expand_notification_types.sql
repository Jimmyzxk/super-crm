-- 1. 扩充 notification_type 枚举值
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'PAYMENT_RECEIVED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'INVOICE_REMINDER';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'CONTRACT_SIGNED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'ORDER_CONFIRMED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'PROJECT_DELIVERED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'DEAL_WON';

-- 2. 存量线索渠道归因智能回填
UPDATE leads
SET channel = CASE
  WHEN source LIKE '%form:%' OR source = 'FORM_CAPTURE' THEN '官网公开表单'
  WHEN source LIKE '%plugin:lead_routing%' THEN '智能分配渠道'
  WHEN source = 'MANUAL' OR source IS NULL OR source = '' THEN '销售自拓'
  WHEN source = 'IMPORT' THEN '批量导入'
  WHEN source LIKE '%api:%' OR source = 'OPEN_API' THEN 'OpenAPI对接'
  ELSE COALESCE(NULLIF(source, ''), '直接进线')
END
WHERE channel IS NULL OR channel = '';
