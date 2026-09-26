DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'users'
      AND i.indisunique
      AND array_length(i.indkey, 1) = 2
      AND (
        SELECT array_agg(a.attname::text ORDER BY k.ordinality)
        FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      ) = ARRAY['tenant_id', 'id']::text[]
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_tenant_id_id_unique UNIQUE (tenant_id, id);
  END IF;
END $$;

-- 开源版（AGPL-3.0）手术说明：plugin_contracts.owner_user_id 复合外键段
--   随合同插件（闭源）移除；上方 users(tenant_id, id) 唯一约束为核心复合外键基座，保留。
