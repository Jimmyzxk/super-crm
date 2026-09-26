-- 0040_cascade_schedules_and_interventions.sql

ALTER TABLE deal_interventions
  DROP CONSTRAINT IF EXISTS deal_interventions_opportunity_id_fkey,
  ADD CONSTRAINT deal_interventions_opportunity_id_fkey
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE;

ALTER TABLE sales_schedules
  DROP CONSTRAINT IF EXISTS sales_schedules_opportunity_id_fkey,
  ADD CONSTRAINT sales_schedules_opportunity_id_fkey
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE;

ALTER TABLE sales_schedules
  DROP CONSTRAINT IF EXISTS sales_schedules_lead_id_fkey,
  ADD CONSTRAINT sales_schedules_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE sales_schedules
  DROP CONSTRAINT IF EXISTS sales_schedules_customer_id_fkey,
  ADD CONSTRAINT sales_schedules_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
