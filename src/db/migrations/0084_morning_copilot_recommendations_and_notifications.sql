-- 0084_morning_copilot_recommendations_and_notifications.sql
-- 晨会副驾驶 v1：扩展 AI 推荐类型与通知枚举，关联销售用户及采纳闭环

-- 1. 扩展 AI 推荐类型枚举
ALTER TYPE ai_recommendation_type ADD VALUE IF NOT EXISTS 'MORNING_COPILOT';

-- 2. 扩展通知类型枚举
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'MORNING_COPILOT';

-- 3. 在 ai_recommendations 表增加 user_id 字段以支持面向具体销售代表的个性化推荐
ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS user_id uuid references users(id) on delete cascade;

-- 4. 创建租户与用户维度的推荐索引
CREATE INDEX IF NOT EXISTS ai_rec_tenant_user_idx ON ai_recommendations(tenant_id, user_id) WHERE user_id IS NOT NULL;

-- 5. 确保 salescrm 具备完全操作权限
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_recommendations TO salescrm;
