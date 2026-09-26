-- 0032_form_capture_hardening.sql
-- 开源版（AGPL-3.0）手术说明：
--   表单采集插件（闭源）相关的 GRANT 与防篡改触发器已移除。
--   保留 plugin_registry 自身的 config 列、plugin_key 格式收紧与列级授权。

ALTER TABLE plugin_registry
  ADD COLUMN config jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE plugin_registry
  ADD CONSTRAINT plugin_registry_config_object CHECK (jsonb_typeof(config) = 'object');

ALTER TABLE plugin_registry DROP CONSTRAINT plugin_registry_key_format;
ALTER TABLE plugin_registry ADD CONSTRAINT plugin_registry_key_format
  CHECK (plugin_key ~ '^[a-z][a-z0-9-]{2,49}$');

REVOKE UPDATE ON plugin_registry FROM salescrm;
GRANT UPDATE (enabled, config, updated_at) ON plugin_registry TO salescrm;
