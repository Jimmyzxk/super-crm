-- Wave8 R02: reports public summary column for SALES-safe rendering
alter table public.ai_insight_reports add column if not exists public_summary text;
