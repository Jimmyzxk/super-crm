-- Migration: 0048_enterprise_ai_agent_hub
-- Description: Tables for Enterprise AI Agent Hub (Prompt Pool, Quality Inspections, Learning Logs)

create table if not exists public.ai_prompt_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scene text not null,
  name text not null,
  description text,
  system_prompt text not null,
  user_prompt_template text not null,
  variables jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists ai_prompt_tenant_scene_idx on public.ai_prompt_templates (tenant_id, scene, is_active);

create table if not exists public.ai_quality_inspections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  inspector_agent text not null default 'DEAL_QUALITY_AGENT',
  score integer not null default 80,
  verdict text not null default 'PASSED',
  dimensions jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  action_recommendations jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now()
);

create index if not exists ai_quality_tenant_opp_idx on public.ai_quality_inspections (tenant_id, opportunity_id, created_at desc);

create table if not exists public.ai_agent_learning_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_type text not null default 'WIN_REVIEW',
  source_id uuid,
  topic text not null,
  extracted_strategy text not null,
  sample_dialogue text,
  effectiveness_score numeric(5, 2) not null default 95.00,
  is_promoted_to_pool boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create index if not exists ai_learning_tenant_src_idx on public.ai_agent_learning_logs (tenant_id, source_type, created_at desc);

-- RLS Policies
alter table public.ai_prompt_templates enable row level security;
alter table public.ai_prompt_templates force row level security;
drop policy if exists ai_prompt_templates_tenant_isolation on public.ai_prompt_templates;
create policy ai_prompt_templates_tenant_isolation on public.ai_prompt_templates
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

alter table public.ai_quality_inspections enable row level security;
alter table public.ai_quality_inspections force row level security;
drop policy if exists ai_quality_inspections_tenant_isolation on public.ai_quality_inspections;
create policy ai_quality_inspections_tenant_isolation on public.ai_quality_inspections
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

alter table public.ai_agent_learning_logs enable row level security;
alter table public.ai_agent_learning_logs force row level security;
drop policy if exists ai_agent_learning_logs_tenant_isolation on public.ai_agent_learning_logs;
create policy ai_agent_learning_logs_tenant_isolation on public.ai_agent_learning_logs
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

grant select, insert, update, delete on public.ai_prompt_templates to salescrm;
grant select, insert, update, delete on public.ai_quality_inspections to salescrm;
grant select, insert, update, delete on public.ai_agent_learning_logs to salescrm;
