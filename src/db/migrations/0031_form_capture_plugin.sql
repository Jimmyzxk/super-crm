-- 0031_form_capture_plugin.sql
-- 开源版（AGPL-3.0）手术说明：
--   本文件原为「表单采集插件 + 插件注册表」混合迁移。
--   表单采集插件（form-capture）为闭源组件，其三张表
--   （plugin_form_definitions / plugin_form_submissions / plugin_form_submission_links）
--   与 public_lookup_published_form() 函数已整体移除。
--   保留 plugin_registry（插件框架启停开关，core 基础设施）与
--   leads.source 的渠道格式约束（core 线索来源契约）。

-- ⚠ 开源版不再使用 salescrm_form_public 角色（仅公开表单插件需要），
--   故此处不再 grant 该角色；scripts/migrate.ts 也不再创建它。
-- 插件框架最小角色集合见 scripts/migrate.ts 的 bootstrap 段。

CREATE TABLE plugin_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  plugin_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plugin_registry_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT plugin_registry_tenant_key_unique UNIQUE (tenant_id, plugin_key),
  CONSTRAINT plugin_registry_key_format CHECK (plugin_key ~ '^[a-z][a-z0-9-]{1,49}$')
);

CREATE INDEX plugin_registry_tenant_enabled_idx ON plugin_registry (tenant_id, enabled, plugin_key);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['plugin_registry'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))', table_name || '_tenant_isolation', table_name);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE ON plugin_registry TO salescrm;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_format;
ALTER TABLE leads ADD CONSTRAINT leads_source_format
  CHECK (source IN ('manual', 'import') OR source ~ '^(form:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|api:.+|plugin:[a-z][a-z0-9-]{1,49})$');
