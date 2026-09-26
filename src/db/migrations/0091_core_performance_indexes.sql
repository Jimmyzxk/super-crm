-- 0091_core_performance_indexes.sql
-- 效能修复批 A2-A4：核心表索引补齐
-- 不可逆说明：均为新增索引 create index if not exists，无数据变更。
-- 回滚：drop index if exists <index_name>;

-- 1. activities：(tenant_id, occurred_at) 支撑按租户时间范围拉取活动趋势
create index if not exists activities_tenant_occurred_idx
  on activities (tenant_id, occurred_at desc);

-- 2. activities：(tenant_id, user_id, occurred_at) 支撑按人+时间拉取活动及 SLA 统计
create index if not exists activities_tenant_user_occurred_idx
  on activities (tenant_id, user_id, occurred_at desc);

-- 3.（开源版：plugin_orders 索引随订单插件（闭源）移除）

-- 4. opportunities：(tenant_id, stage) 支撑按租户+阶段聚合/过滤
create index if not exists opportunities_tenant_stage_idx
  on opportunities (tenant_id, stage);

-- 5. lead_conversions：(tenant_id, opportunity_id) 支撑商机反查转化关系
create index if not exists lead_conversions_tenant_opportunity_idx
  on lead_conversions (tenant_id, opportunity_id);

-- 6. opportunities：from_lead_id 索引（历史遗留可空列，支撑回溯查询）
create index if not exists opportunities_from_lead_idx
  on opportunities (from_lead_id)
  where from_lead_id is not null;
