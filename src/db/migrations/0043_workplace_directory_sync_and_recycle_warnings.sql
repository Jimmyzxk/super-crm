-- 0043_workplace_directory_sync_and_recycle_warnings.sql

-- 1. 扩充 notification_type 枚举值
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'RECYCLE_WARNING';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'RECYCLE_EXECUTED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'DIRECTORY_SYNC_COMPLETED';

-- 2. 创建企业通讯录同步对接凭证配置表
CREATE TABLE IF NOT EXISTS workplace_directory_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform text NOT NULL, -- 'WECOM', 'DINGTALK', 'FEISHU'
  corp_id text NOT NULL, -- CorpId / AppKey / AppId
  secret text NOT NULL, -- Secret / AppSecret
  sync_mode text NOT NULL DEFAULT 'INCREMENTAL', -- 'FULL' | 'INCREMENTAL'
  default_role text NOT NULL DEFAULT 'SALES', -- 默认分配给新员工的角色
  last_synced_at timestamptz,
  last_sync_result jsonb,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workplace_directory_tenant_platform_unique UNIQUE (tenant_id, platform),
  CONSTRAINT workplace_directory_platform_check CHECK (platform IN ('WECOM', 'DINGTALK', 'FEISHU')),
  CONSTRAINT workplace_directory_sync_mode_check CHECK (sync_mode IN ('FULL', 'INCREMENTAL')),
  CONSTRAINT workplace_directory_default_role_check CHECK (default_role IN ('SALES', 'MANAGER', 'ADMIN'))
);

CREATE INDEX IF NOT EXISTS workplace_directory_tenant_idx
  ON workplace_directory_configs (tenant_id, is_enabled);

-- 3. 启用 RLS 多租户数据隔离
ALTER TABLE workplace_directory_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workplace_directory_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workplace_directory_configs_tenant_isolation ON workplace_directory_configs;
CREATE POLICY workplace_directory_configs_tenant_isolation ON workplace_directory_configs
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON workplace_directory_configs TO salescrm;
