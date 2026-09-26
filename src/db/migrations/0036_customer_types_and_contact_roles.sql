DO $$ BEGIN
  CREATE TYPE customer_type AS ENUM ('ENTERPRISE', 'INDIVIDUAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE contact_role_tag AS ENUM ('DECISION_MAKER', 'TECH_EVALUATOR', 'PROCUREMENT', 'USER', 'FINANCE', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type customer_type NOT NULL DEFAULT 'ENTERPRISE';
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_type_check;
ALTER TABLE customers ADD CONSTRAINT customers_type_check CHECK (customer_type IN ('ENTERPRISE', 'INDIVIDUAL'));

CREATE INDEX IF NOT EXISTS customers_tenant_type_idx ON customers (tenant_id, customer_type);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS role_tag contact_role_tag NOT NULL DEFAULT 'OTHER';
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_role_tag_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_role_tag_check CHECK (role_tag IN ('DECISION_MAKER', 'TECH_EVALUATOR', 'PROCUREMENT', 'USER', 'FINANCE', 'OTHER'));

CREATE INDEX IF NOT EXISTS contacts_tenant_customer_role_idx ON contacts (tenant_id, customer_id, role_tag);
