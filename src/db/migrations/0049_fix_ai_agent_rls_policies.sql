-- Migration: 0049_fix_ai_agent_rls_policies
-- Description: Standardize RLS policies for AI Agent Hub tables to use app.tenant_id

alter table public.ai_prompt_templates enable row level security;
alter table public.ai_prompt_templates force row level security;
drop policy if exists ai_prompt_templates_tenant_policy on public.ai_prompt_templates;
drop policy if exists ai_prompt_templates_tenant_isolation on public.ai_prompt_templates;
create policy ai_prompt_templates_tenant_isolation on public.ai_prompt_templates
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

alter table public.ai_quality_inspections enable row level security;
alter table public.ai_quality_inspections force row level security;
drop policy if exists ai_quality_inspections_tenant_policy on public.ai_quality_inspections;
drop policy if exists ai_quality_inspections_tenant_isolation on public.ai_quality_inspections;
create policy ai_quality_inspections_tenant_isolation on public.ai_quality_inspections
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

alter table public.ai_agent_learning_logs enable row level security;
alter table public.ai_agent_learning_logs force row level security;
drop policy if exists ai_agent_learning_logs_tenant_policy on public.ai_agent_learning_logs;
drop policy if exists ai_agent_learning_logs_tenant_isolation on public.ai_agent_learning_logs;
create policy ai_agent_learning_logs_tenant_isolation on public.ai_agent_learning_logs
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

grant select, insert, update, delete on public.ai_prompt_templates to salescrm;
grant select, insert, update, delete on public.ai_quality_inspections to salescrm;
grant select, insert, update, delete on public.ai_agent_learning_logs to salescrm;
