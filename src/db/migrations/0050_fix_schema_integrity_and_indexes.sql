-- 0050_fix_schema_integrity_and_indexes.sql

-- 1. 修复 deal_interventions 中可能由于历史迁移存在的 coachingnotes 列名
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deal_interventions' AND column_name = 'coachingnotes'
  ) THEN
    ALTER TABLE deal_interventions RENAME COLUMN coachingnotes TO coaching_notes;
  END IF;
END $$;

-- 2. 补齐高频外键复合索引（租户级隔离与关联查询性能优化）
CREATE INDEX IF NOT EXISTS tasks_tenant_lead_idx
  ON tasks (tenant_id, lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_tenant_lead_idx
  ON notifications (tenant_id, lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_tenant_opp_idx
  ON notifications (tenant_id, opportunity_id)
  WHERE opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_schedules_tenant_lead_idx
  ON sales_schedules (tenant_id, lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_schedules_tenant_customer_idx
  ON sales_schedules (tenant_id, customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_schedules_tenant_opp_idx
  ON sales_schedules (tenant_id, opportunity_id)
  WHERE opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_recommendations_tenant_customer_idx
  ON ai_recommendations (tenant_id, customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS deal_interventions_tenant_requester_idx
  ON deal_interventions (tenant_id, requester_user_id);
