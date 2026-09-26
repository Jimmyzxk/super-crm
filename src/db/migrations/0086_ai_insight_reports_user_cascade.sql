-- 0086_ai_insight_reports_user_cascade.sql
-- 确保 ai_insight_reports.created_by 外键支持 ON DELETE CASCADE

ALTER TABLE ai_insight_reports DROP CONSTRAINT IF EXISTS ai_insight_reports_created_by_fkey;
ALTER TABLE ai_insight_reports ADD CONSTRAINT ai_insight_reports_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;
