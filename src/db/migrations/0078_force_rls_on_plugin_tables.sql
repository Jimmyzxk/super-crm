-- Migration: 0078_force_rls_on_plugin_tables.sql
-- Description: Enable and FORCE Row Level Security on all plugin tables for tenant-level defense-in-depth
-- 开源版（AGPL-3.0）手术说明：数组中仅剩插件框架自身的两张基础设施表
--   （plugin_registry 启停开关 / plugin_rate_limits API 限流）。
--   业务插件表（合同/订单/项目/表单采集/BI，闭源组件）已随插件实现一并移除。

DO $$
DECLARE
  tbl text;
  plugin_tables text[] := ARRAY[
    'plugin_registry',
    'plugin_rate_limits'
  ];
BEGIN
  FOREACH tbl IN ARRAY plugin_tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);
    END IF;
  END LOOP;
END $$;
