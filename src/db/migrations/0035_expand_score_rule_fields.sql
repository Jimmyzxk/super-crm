ALTER TABLE score_rules DROP CONSTRAINT IF EXISTS score_rules_field_allowed;
ALTER TABLE score_rules ADD CONSTRAINT score_rules_field_allowed CHECK (
  field IN (
    'company_name', 'contact_email', 'title', 'source', 'created_hour', 'activity_count', 'last_activity_outcome',
    'customer_size', 'customer_industry', 'customer_region', 'days_since_activity', 'won_deal_count', 'active_deal_count'
  )
);

ALTER TABLE score_rules DROP CONSTRAINT IF EXISTS score_rules_numeric_operator_field;
ALTER TABLE score_rules ADD CONSTRAINT score_rules_numeric_operator_field CHECK (
  operator NOT IN ('GT', 'GTE') OR field IN ('created_hour', 'activity_count', 'days_since_activity', 'won_deal_count', 'active_deal_count')
);
