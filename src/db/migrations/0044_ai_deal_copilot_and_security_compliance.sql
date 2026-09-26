-- 0044_ai_deal_copilot_and_security_compliance.sql
-- 销冠 AI 决策推荐引擎与三级等保数据脱敏安全合规中枢

-- 1. 创建 AI 推荐类型枚举
create type ai_recommendation_type as enum (
  'NEXT_BEST_ACTION',
  'OBJECTION_KILLER',
  'LEAD_PITCH',
  'HEALTH_DIAGNOSTIC'
);

-- 2. 创建 AI 推荐与诊断表
create table if not exists ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  recommendation_type ai_recommendation_type not null,
  title text not null,
  content text not null,
  suggested_action jsonb,
  confidence_score numeric(5, 2) default 90.00 not null,
  is_applied boolean not null default false,
  feedback_verdict sales_playbook_feedback_verdict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_rec_tenant_opp_idx on ai_recommendations(tenant_id, opportunity_id) where opportunity_id is not null;
create index if not exists ai_rec_tenant_lead_idx on ai_recommendations(tenant_id, lead_id) where lead_id is not null;
create index if not exists ai_rec_tenant_type_idx on ai_recommendations(tenant_id, recommendation_type);

-- 3. 创建等保合规与安全脱敏配置表
create table if not exists security_compliance_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants(id) on delete cascade,
  is_phone_masking_enabled boolean not null default true,
  is_email_masking_enabled boolean not null default false,
  export_requires_approval boolean not null default false,
  session_timeout_minutes integer not null default 120,
  watermark_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists security_compliance_tenant_idx on security_compliance_configs(tenant_id);

-- 4. 启用 RLS 租户隔离策略
alter table ai_recommendations enable row level security;
alter table ai_recommendations force row level security;
drop policy if exists ai_recommendations_tenant_isolation on ai_recommendations;
create policy ai_recommendations_tenant_isolation on ai_recommendations
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

alter table security_compliance_configs enable row level security;
alter table security_compliance_configs force row level security;
drop policy if exists security_compliance_configs_tenant_isolation on security_compliance_configs;
create policy security_compliance_configs_tenant_isolation on security_compliance_configs
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

grant select, insert, update, delete on ai_recommendations to salescrm;
grant select, insert, update, delete on security_compliance_configs to salescrm;

