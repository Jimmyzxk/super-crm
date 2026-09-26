-- 1. 逐租户设置 app.tenant_id 绕过 RLS 拦截，以 UI 标准英文 slug 回填存量线索渠道
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE leads
    SET channel = CASE
      WHEN source LIKE '%form:%' OR source = 'FORM_CAPTURE' THEN 'official_website'
      WHEN source LIKE '%plugin:lead_routing%' THEN 'other'
      WHEN lower(source) = 'manual' OR source IS NULL OR source = '' THEN 'direct'
      WHEN lower(source) = 'import' THEN 'other'
      WHEN source LIKE '%api:%' OR source = 'OPEN_API' THEN 'other'
      WHEN source = 'PUBLIC_POOL' THEN 'direct'
      ELSE 'direct'
    END
    WHERE tenant_id = t.id
      AND (
        channel IS NULL
        OR channel = ''
        OR channel IN ('manual', 'import', '官网公开表单', '销售自拓', '批量导入', '智能分配渠道', 'OpenAPI对接', '直接进线')
      );
  END LOOP;
END $$;
