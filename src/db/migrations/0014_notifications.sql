DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM ('TASK_OVERDUE', 'TASK_DUE_SOON', 'LEAD_ASSIGNED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  type notification_type NOT NULL,
  task_id uuid,
  lead_id uuid,
  opportunity_id uuid,
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT notifications_user_tenant_fk
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  CONSTRAINT notifications_task_tenant_fk
    FOREIGN KEY (tenant_id, task_id) REFERENCES tasks (tenant_id, id),
  CONSTRAINT notifications_lead_tenant_fk
    FOREIGN KEY (tenant_id, lead_id) REFERENCES leads (tenant_id, id),
  CONSTRAINT notifications_opportunity_tenant_fk
    FOREIGN KEY (tenant_id, opportunity_id) REFERENCES opportunities (tenant_id, id),
  CONSTRAINT notifications_title_length CHECK (char_length(title) BETWEEN 1 AND 100),
  CONSTRAINT notifications_body_length CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 200),
  CONSTRAINT notifications_link_length CHECK (link IS NULL OR char_length(link) BETWEEN 1 AND 300)
);

CREATE UNIQUE INDEX notifications_task_type_unique
  ON notifications (task_id, type) WHERE task_id IS NOT NULL;
CREATE INDEX notifications_tenant_user_read_created_idx
  ON notifications (tenant_id, user_id, read_at, created_at DESC, id DESC);
CREATE INDEX notifications_tenant_task_idx
  ON notifications (tenant_id, task_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant_isolation ON notifications
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

REVOKE ALL ON notifications FROM PUBLIC;
GRANT SELECT, INSERT ON notifications TO salescrm;
GRANT UPDATE (read_at) ON notifications TO salescrm;
