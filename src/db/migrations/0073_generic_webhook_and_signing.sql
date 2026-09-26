-- Migration: 0073_generic_webhook_and_signing.sql
-- Description: Expand workplace_integrations with GENERIC_WEBHOOK platform and HMAC secret_key

alter table public.workplace_integrations
  add column if not exists secret_key text;

alter table public.workplace_integrations
  drop constraint if exists workplace_integrations_platform_check;

alter table public.workplace_integrations
  add constraint workplace_integrations_platform_check
  check (platform in ('WECOM', 'DINGTALK', 'FEISHU', 'GENERIC_WEBHOOK'));

grant select, insert, update, delete on public.workplace_integrations to salescrm;
