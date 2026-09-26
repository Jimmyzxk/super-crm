-- Tenant-scoped foreign keys prevent accidental cross-tenant associations even
-- when an application query forgets an ownership check.
ALTER TABLE users
  ADD CONSTRAINT users_tenant_id_id_unique UNIQUE (tenant_id, id);

ALTER TABLE leads
  ADD CONSTRAINT leads_tenant_id_id_unique UNIQUE (tenant_id, id),
  DROP CONSTRAINT leads_owner_user_id_fkey,
  ADD CONSTRAINT leads_owner_user_tenant_fk
    FOREIGN KEY (tenant_id, owner_user_id) REFERENCES users (tenant_id, id);

ALTER TABLE activities
  DROP CONSTRAINT activities_lead_id_fkey,
  DROP CONSTRAINT activities_user_id_fkey,
  ADD CONSTRAINT activities_lead_tenant_fk
    FOREIGN KEY (tenant_id, lead_id) REFERENCES leads (tenant_id, id),
  ADD CONSTRAINT activities_user_tenant_fk
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id);

ALTER TABLE tasks
  DROP CONSTRAINT tasks_lead_id_fkey,
  DROP CONSTRAINT tasks_assignee_user_id_fkey,
  ADD CONSTRAINT tasks_lead_tenant_fk
    FOREIGN KEY (tenant_id, lead_id) REFERENCES leads (tenant_id, id),
  ADD CONSTRAINT tasks_assignee_user_tenant_fk
    FOREIGN KEY (tenant_id, assignee_user_id) REFERENCES users (tenant_id, id);

ALTER TABLE audit_logs
  DROP CONSTRAINT audit_logs_actor_user_id_fkey,
  ADD CONSTRAINT audit_logs_actor_user_tenant_fk
    FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users (tenant_id, id);

-- mergeLead moves existing activity rows to the selected target lead.
GRANT UPDATE ON activities TO salescrm;
