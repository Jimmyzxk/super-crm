create table if not exists ai_agent_traces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  task text not null,
  tools_used jsonb default '[]'::jsonb not null,
  rounds integer not null,
  token_usage jsonb default '{}'::jsonb not null,
  outcome text not null,
  created_at timestamp with time zone default now() not null
);

alter table ai_agent_traces enable row level security;

create policy "tenant_isolation"
  on ai_agent_traces
  for all
  using (tenant_id::text = current_setting('app.tenant_id', true));

grant select, insert on ai_agent_traces to salescrm;
