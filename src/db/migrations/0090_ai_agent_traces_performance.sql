-- 0090_ai_agent_traces_performance.sql
-- 效能修复批 A1：ai_agent_traces 性能与可追溯性
-- 不可逆说明：新增列 opportunity_id 可空，无数据回填；索引新增均为幂等 create index if not exists。
-- 如需回滚，执行：drop index if exists ai_agent_traces_tenant_created_idx;
--              drop index if exists ai_agent_traces_tenant_opportunity_idx;
--              alter table ai_agent_traces drop column if exists opportunity_id;

-- 1. 新增 opportunity_id 正式列（可空，不回填历史，写入侧同步落列）
alter table ai_agent_traces add column if not exists opportunity_id uuid;

-- 2. FK 可选：仅当引用的商机存在时做约束，避免历史脏数据阻断；采用不校验外键或弱约束
--    为保持迁移幂等且不阻塞已有数据，不强制 add foreign key，仅加索引
--    如需强约束可在后续手工执行（需先清理孤儿数据）

-- 3. 索引：(tenant_id, created_at desc) 支撑按租户时间倒序拉取最新 trace
create index if not exists ai_agent_traces_tenant_created_idx
  on ai_agent_traces (tenant_id, created_at desc);

-- 4. 索引：(tenant_id, opportunity_id) 支撑按商机等值查询最新归因（替代 task like '%uuid%'）
create index if not exists ai_agent_traces_tenant_opportunity_idx
  on ai_agent_traces (tenant_id, opportunity_id)
  where opportunity_id is not null;
