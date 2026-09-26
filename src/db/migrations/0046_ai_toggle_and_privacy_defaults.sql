-- 0046_ai_toggle_and_privacy_defaults.sql
-- 增加 AI 销冠副驾驶功能开关，并将电话脱敏默认设为 false（按需开启）

ALTER TABLE security_compliance_configs
  ADD COLUMN IF NOT EXISTS is_ai_copilot_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE security_compliance_configs
  ALTER COLUMN is_phone_masking_enabled SET DEFAULT false;

-- 将已存在的旧记录重置为默认关闭（避免未经配置直接隐藏）
UPDATE security_compliance_configs
  SET is_phone_masking_enabled = false
  WHERE is_phone_masking_enabled = true;
