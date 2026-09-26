-- Migration: 0061_sales_quotas
-- Description: Table for sales quota allocation, department targets, and attainment tracking

create table if not exists public.sales_quotas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  year integer not null,
  period_type text not null default 'MONTHLY',
  period_key text not null,
  target_amount_cents bigint not null default 0,
  target_deals_count integer not null default 0,
  target_leads_count integer not null default 0,
  note text,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint sales_quotas_tenant_user_period_unique unique (tenant_id, user_id, period_type, period_key)
);

create index if not exists sales_quotas_tenant_period_idx on public.sales_quotas (tenant_id, period_type, period_key);
create index if not exists sales_quotas_tenant_user_year_idx on public.sales_quotas (tenant_id, user_id, year);

-- RLS Policies
alter table public.sales_quotas enable row level security;
alter table public.sales_quotas force row level security;

drop policy if exists sales_quotas_tenant_isolation on public.sales_quotas;
create policy sales_quotas_tenant_isolation on public.sales_quotas
  using (tenant_id::text = current_setting('app.tenant_id', true))
  with check (tenant_id::text = current_setting('app.tenant_id', true));

grant select, insert, update, delete on public.sales_quotas to salescrm;
