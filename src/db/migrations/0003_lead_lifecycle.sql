CREATE TABLE lead_status_history (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  lead_id uuid NOT NULL,
  from_status lead_status,
  to_status lead_status NOT NULL,
  reason text,
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_status_history_lead_tenant_fk
    FOREIGN KEY (tenant_id, lead_id) REFERENCES leads (tenant_id, id),
  CONSTRAINT lead_status_history_actor_user_tenant_fk
    FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users (tenant_id, id),
  CONSTRAINT lead_status_history_transition_check
    CHECK (from_status IS NULL OR from_status <> to_status),
  CONSTRAINT lead_status_history_reason_length
    CHECK (reason IS NULL OR char_length(reason) <= 200)
);

CREATE INDEX lead_status_history_tenant_lead_created_idx
  ON lead_status_history (tenant_id, lead_id, created_at DESC, id DESC);

ALTER TABLE lead_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_status_history_tenant_isolation ON lead_status_history
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT ON lead_status_history TO salescrm;
REVOKE UPDATE, DELETE ON lead_status_history FROM salescrm;
GRANT USAGE, SELECT ON SEQUENCE lead_status_history_id_seq TO salescrm;

-- Existing Stage 1 data receives a truthful current-state baseline. Prefer the
-- original create/import actor; fall back to the owner or a tenant user.
INSERT INTO lead_status_history
  (tenant_id, lead_id, from_status, to_status, reason, actor_user_id, created_at)
SELECT l.tenant_id, l.id, NULL, l.status, '迁移时记录当前状态', actor.id, l.created_at
FROM leads l
CROSS JOIN LATERAL (
  SELECT coalesce(
    (
      SELECT a.actor_user_id
      FROM audit_logs a
      WHERE a.tenant_id = l.tenant_id
        AND a.subject_type = 'lead'
        AND a.subject_id = l.id
        AND a.action IN ('lead.create', 'lead.import')
      ORDER BY a.created_at
      LIMIT 1
    ),
    l.owner_user_id,
    (
      SELECT u.id
      FROM users u
      WHERE u.tenant_id = l.tenant_id
      ORDER BY u.created_at
      LIMIT 1
    )
  ) AS id
) actor
WHERE l.deleted_at IS NULL AND actor.id IS NOT NULL;
