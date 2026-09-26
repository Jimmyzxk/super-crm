-- 0085_ai_insight_reports.sql
-- 认知报告持久化、历史归档与销冠打法反哺通知

-- 1. 创建认知报告类型与置信度枚举
DO $$ BEGIN
  CREATE TYPE ai_insight_report_kind AS ENUM ('CHAMPION_ANALYSIS', 'COMPANY_PROFILE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ai_insight_confidence AS ENUM ('HIGH', 'MEDIUM', 'LOW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. 扩展通知类型枚举支持销冠打法反哺
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'CHAMPION_PRACTICE';

-- 3. 创建认知报告持久化表
CREATE TABLE IF NOT EXISTS ai_insight_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind ai_insight_report_kind NOT NULL,
  period varchar(10) NOT NULL,
  content text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_size integer NOT NULL DEFAULT 0,
  confidence ai_insight_confidence NOT NULL DEFAULT 'MEDIUM',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_insight_reports_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT ai_insight_reports_tenant_kind_period_unique UNIQUE (tenant_id, kind, period)
);

-- 4. 索引
CREATE INDEX IF NOT EXISTS ai_insight_reports_tenant_kind_period_idx
  ON ai_insight_reports (tenant_id, kind, period);
CREATE INDEX IF NOT EXISTS ai_insight_reports_tenant_created_idx
  ON ai_insight_reports (tenant_id, created_at DESC);

-- 5. RLS 与权限控制
ALTER TABLE ai_insight_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_insight_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_insight_reports_tenant_isolation ON ai_insight_reports;
CREATE POLICY ai_insight_reports_tenant_isolation ON ai_insight_reports
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

REVOKE ALL ON ai_insight_reports FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_insight_reports TO salescrm;
