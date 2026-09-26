-- Migration: 0047_ai_model_provider_configs
-- Description: Add enterprise AI LLM provider configuration fields to security_compliance_configs

alter table public.security_compliance_configs
  add column if not exists ai_provider text not null default 'BUILTIN',
  add column if not exists ai_api_key text,
  add column if not exists ai_api_endpoint text,
  add column if not exists ai_model_name text not null default 'deepseek-chat',
  add column if not exists ai_temperature numeric(3, 2) not null default '0.30';

-- Add check constraint for ai_provider
alter table public.security_compliance_configs
  drop constraint if exists security_ai_provider_check;

alter table public.security_compliance_configs
  add constraint security_ai_provider_check
  check (ai_provider in ('BUILTIN', 'OPENAI', 'DEEPSEEK', 'ZHIPU', 'QWEN', 'GEMINI', 'CUSTOM'));
