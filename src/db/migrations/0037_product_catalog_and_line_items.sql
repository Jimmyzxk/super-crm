-- 0037_product_catalog_and_line_items.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pricing_model') THEN
    CREATE TYPE pricing_model AS ENUM (
      'SUBSCRIPTION_YEARLY',
      'SUBSCRIPTION_MONTHLY',
      'ONE_TIME',
      'USAGE_BASED',
      'MAN_MONTH'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_status') THEN
    CREATE TYPE product_status AS ENUM ('ACTIVE', 'ARCHIVED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  pricing_model pricing_model NOT NULL DEFAULT 'ONE_TIME',
  unit_price integer NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT '套',
  description text,
  status product_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT products_name_length CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT products_code_length CHECK (char_length(code) BETWEEN 1 AND 50),
  CONSTRAINT products_unit_price_non_negative CHECK (unit_price >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_code_unique
  ON products (tenant_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_tenant_category_idx
  ON products (tenant_id, category)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_tenant_status_idx
  ON products (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS opportunity_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL DEFAULT 1,
  unit_price integer NOT NULL DEFAULT 0,
  discount_rate integer NOT NULL DEFAULT 100,
  subtotal_amount integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT line_items_quantity_positive CHECK (quantity >= 1),
  CONSTRAINT line_items_unit_price_non_negative CHECK (unit_price >= 0),
  CONSTRAINT line_items_discount_range CHECK (discount_rate BETWEEN 1 AND 100),
  CONSTRAINT line_items_subtotal_non_negative CHECK (subtotal_amount >= 0)
);

CREATE INDEX IF NOT EXISTS line_items_tenant_opp_idx
  ON opportunity_line_items (tenant_id, opportunity_id);

CREATE INDEX IF NOT EXISTS line_items_tenant_product_idx
  ON opportunity_line_items (tenant_id, product_id);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['products', 'opportunity_line_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_isolation', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
      tbl || '_tenant_isolation', tbl
    );
  END LOOP;
END $$;

GRANT USAGE ON TYPE pricing_model, product_status TO salescrm;
GRANT SELECT, INSERT, UPDATE, DELETE ON products, opportunity_line_items TO salescrm;
