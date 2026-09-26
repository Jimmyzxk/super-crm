ALTER TABLE sales_insights ADD COLUMN IF NOT EXISTS refresh_failed_at timestamptz;
