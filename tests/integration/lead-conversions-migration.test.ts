import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) {
  throw new Error("lead_conversions 集成测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
}
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("lead_conversions 集成测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
const app = new pg.Client({ connectionString: appUrl });

let tenantA: string;
let tenantB: string;
let userA: string;
let userB: string;
let convertedLeadA: string;
let convertedLeadForMismatchA: string;
let qualifiedLeadA: string;
let convertedLeadB: string;
let customerA: string;
let otherCustomerA: string;
let customerB: string;
let opportunityA: string;
let mismatchedOpportunityA: string;
let qualifiedOpportunityA: string;
let crossTenantOpportunityA: string;
let opportunityB: string;
let conversionA: string;
let conversionB: string;

async function setTenant(tenantId: string): Promise<void> {
  await app.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
}

async function expectCommitFailure(query: string, values: unknown[], code: string): Promise<void> {
  await app.query("begin");
  try {
    await app.query("select set_config('app.tenant_id', $1, true)", [tenantA]);
    await app.query(query, values);
    await expect(app.query("commit")).rejects.toMatchObject({ code });
  } finally {
    await app.query("rollback").catch(() => undefined);
  }
}

beforeAll(async () => {
  await owner.connect();
  await app.connect();

  const tenants = await owner.query<{ id: string }>(
    "insert into tenants (name) values ('conversion migration A'), ('conversion migration B') returning id",
  );
  tenantA = tenants.rows[0].id;
  tenantB = tenants.rows[1].id;

  const users = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name)
    values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', 'conversion A'),
           ($3, $4, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', 'conversion B')
    returning id`, [tenantA, `conversion-a-${Date.now()}@example.com`, tenantB, `conversion-b-${Date.now()}@example.com`]);
  userA = users.rows[0].id;
  userB = users.rows[1].id;

  const leads = await owner.query<{ id: string }>(`insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, status)
    values ($1, $2, '已转化 A', '13890100001', 'CONVERTED'),
           ($1, $2, '错配已转化 A', '13890100002', 'CONVERTED'),
           ($1, $2, '待确认 A', '13890100003', 'QUALIFIED'),
           ($3, $4, '已转化 B', '13890100004', 'CONVERTED')
    returning id`, [tenantA, userA, tenantB, userB]);
  convertedLeadA = leads.rows[0].id;
  convertedLeadForMismatchA = leads.rows[1].id;
  qualifiedLeadA = leads.rows[2].id;
  convertedLeadB = leads.rows[3].id;

  const customers = await owner.query<{ id: string }>(`insert into customers (tenant_id, owner_user_id, name)
    values ($1, $2, '客户 A'), ($1, $2, '另一客户 A'), ($3, $4, '客户 B') returning id`, [tenantA, userA, tenantB, userB]);
  customerA = customers.rows[0].id;
  otherCustomerA = customers.rows[1].id;
  customerB = customers.rows[2].id;

  const opportunities = await owner.query<{ id: string }>(`insert into opportunities (tenant_id, customer_id, owner_user_id, name)
    values ($1, $2, $3, '商机 A'), ($1, $4, $3, '错配商机 A'), ($1, $2, $3, '待确认商机 A'),
           ($1, $2, $3, '跨租户校验商机 A'), ($5, $6, $7, '商机 B') returning id`, [tenantA, customerA, userA, otherCustomerA, tenantB, customerB, userB]);
  opportunityA = opportunities.rows[0].id;
  mismatchedOpportunityA = opportunities.rows[1].id;
  qualifiedOpportunityA = opportunities.rows[2].id;
  crossTenantOpportunityA = opportunities.rows[3].id;
  opportunityB = opportunities.rows[4].id;

  await setTenant(tenantA);
  const conversion = await app.query<{ id: string }>(`insert into lead_conversions
    (tenant_id, lead_id, customer_id, opportunity_id, converted_by_user_id)
    values ($1, $2, $3, $4, $5) returning id`, [tenantA, convertedLeadA, customerA, opportunityA, userA]);
  conversionA = conversion.rows[0].id;

  const conversionBResult = await owner.query<{ id: string }>(`insert into lead_conversions
    (tenant_id, lead_id, customer_id, opportunity_id, converted_by_user_id)
    values ($1, $2, $3, $4, $5) returning id`, [tenantB, convertedLeadB, customerB, opportunityB, userB]);
  conversionB = conversionBResult.rows[0].id;
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

describe("0013 lead_conversions 迁移契约", () => {
  it("同租户的复合外键接受一致的线索、客户、商机与操作人", async () => {
    await setTenant(tenantA);
    const visible = await app.query<{ id: string }>("select id from lead_conversions where id = $1", [conversionA]);
    expect(visible.rows).toEqual([{ id: conversionA }]);

    const constraints = await owner.query<{ conname: string; condeferrable: boolean; condeferred: boolean }>(`select conname, condeferrable, condeferred
      from pg_constraint
      where conrelid = 'lead_conversions'::regclass and conname in (
        'lead_conversions_lead_tenant_fk',
        'lead_conversions_customer_tenant_fk',
        'lead_conversions_opportunity_customer_tenant_fk',
        'lead_conversions_user_tenant_fk'
      )`);
    expect(constraints.rows).toHaveLength(4);
    expect(constraints.rows.every((constraint) => constraint.condeferrable && constraint.condeferred)).toBe(true);
  });

  it("跨租户对象在事务提交时被复合外键拒绝", async () => {
    await expectCommitFailure(`insert into lead_conversions
      (tenant_id, lead_id, customer_id, opportunity_id, converted_by_user_id)
      values ($1, $2, $3, $4, $5)`, [tenantA, convertedLeadB, customerA, crossTenantOpportunityA, userA], "23503");
  });

  it("商机和客户不属于同一关系时在事务提交时被拒绝", async () => {
    await expectCommitFailure(`insert into lead_conversions
      (tenant_id, lead_id, customer_id, opportunity_id, converted_by_user_id)
      values ($1, $2, $3, $4, $5)`, [tenantA, convertedLeadForMismatchA, customerA, mismatchedOpportunityA, userA], "23503");
  });

  it("非 CONVERTED 线索会被延迟一致性约束在提交时拒绝", async () => {
    await expectCommitFailure(`insert into lead_conversions
      (tenant_id, lead_id, customer_id, opportunity_id, converted_by_user_id)
      values ($1, $2, $3, $4, $5)`, [tenantA, qualifiedLeadA, customerA, qualifiedOpportunityA, userA], "23514");
  });

  it("应用角色只有追加权限，不能 UPDATE 或 DELETE", async () => {
    const grants = await owner.query<{ can_update: boolean; can_delete: boolean }>(`select
      has_table_privilege('salescrm', 'lead_conversions', 'UPDATE') as can_update,
      has_table_privilege('salescrm', 'lead_conversions', 'DELETE') as can_delete`);
    expect(grants.rows).toEqual([{ can_update: false, can_delete: false }]);

    await setTenant(tenantA);
    await expect(app.query("update lead_conversions set created_at = now() where id = $1", [conversionA])).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("delete from lead_conversions where id = $1", [conversionA])).rejects.toMatchObject({ code: "42501" });
  });

  it("RLS 只暴露当前租户记录，并且表启用 FORCE RLS", async () => {
    await setTenant(tenantA);
    const tenantARecords = await app.query<{ id: string }>("select id from lead_conversions where id in ($1, $2) order by id", [conversionA, conversionB]);
    expect(tenantARecords.rows).toEqual([{ id: conversionA }]);

    await setTenant(tenantB);
    const tenantBRecords = await app.query<{ id: string }>("select id from lead_conversions where id in ($1, $2) order by id", [conversionA, conversionB]);
    expect(tenantBRecords.rows).toEqual([{ id: conversionB }]);

    const security = await owner.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean; owner: string }>(`select c.relrowsecurity, c.relforcerowsecurity, r.rolname as owner
      from pg_class c join pg_roles r on r.oid = c.relowner
      where c.oid = 'lead_conversions'::regclass`);
    expect(security.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true, owner: expect.not.stringMatching(/^salescrm$/) }]);
  });

  it("应用角色不能执行仅供迁移窗口使用的 backfill 函数", async () => {
    await setTenant(tenantA);
    await expect(app.query("select public.backfill_lead_conversions()")).rejects.toMatchObject({ code: "42501" });
  });

  it("backfill 由独立 NOLOGIN BYPASSRLS 角色持有，应用角色不能 SET ROLE", async () => {
    const role = await owner.query<{ rolcanlogin: boolean; rolbypassrls: boolean; rolsuper: boolean; is_bootstrap: boolean }>(
      "select rolcanlogin, rolbypassrls, rolsuper, oid = 10 as is_bootstrap from pg_roles where rolname = 'salescrm_migration'",
    );
    expect(role.rows).toHaveLength(1);
    expect(role.rows[0]).toMatchObject({ rolcanlogin: false, rolbypassrls: true });
    expect(role.rows[0].rolsuper && !role.rows[0].is_bootstrap).toBe(false);

    const fn = await owner.query<{ owner: string; prosecdef: boolean; safe_search_path: boolean }>(`select
      owner.rolname as owner, proc.prosecdef,
      proc.proconfig @> array['search_path=pg_catalog, public, pg_temp']::text[] as safe_search_path
      from pg_proc proc join pg_roles owner on owner.oid = proc.proowner
      where proc.oid = 'public.backfill_lead_conversions(integer)'::regprocedure`);
    expect(fn.rows).toEqual([{ owner: "salescrm_migration", prosecdef: true, safe_search_path: true }]);

    const membership = await owner.query<{ is_member: boolean }>(`select exists (
      select 1 from pg_auth_members membership
      join pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_roles member on member.oid = membership.member
      where granted_role.rolname = 'salescrm_migration' and member.rolname = 'salescrm'
    ) as is_member`);
    expect(membership.rows).toEqual([{ is_member: false }]);
    await expect(app.query("set role salescrm_migration")).rejects.toMatchObject({ code: "42501" });
  });

  it("backfill 支持关联已有客户，并把缺少转化商机的旧记录隔离", async () => {
    const leads = await owner.query<{ id: string }>(`insert into leads
      (tenant_id, owner_user_id, customer_id, contact_name, contact_phone, status)
      values ($1, $2, $3, '已有客户转化', '13890100005', 'CONVERTED'),
             ($1, $2, $3, '缺少商机转化', '13890100006', 'CONVERTED')
      returning id`, [tenantA, userA, customerA]);
    const validLegacyLead = leads.rows[0].id;
    const invalidLegacyLead = leads.rows[1].id;
    const legacyOpportunity = await owner.query<{ id: string }>(`insert into opportunities
      (tenant_id, customer_id, owner_user_id, from_lead_id, name)
      values ($1, $2, $3, $4, '已有客户的旧转化商机') returning id`,
    [tenantA, customerA, userA, validLegacyLead]);
    const evidenceAt = new Date("2026-01-02T03:04:05.000Z");
    await owner.query(`insert into lead_status_history
      (tenant_id, lead_id, from_status, to_status, reason, actor_user_id, created_at)
      values ($1, $2, 'QUALIFIED', 'CONVERTED', '旧转化证据', $3, $4)`,
    [tenantA, validLegacyLead, userA, evidenceAt]);
    await owner.query(`insert into audit_logs
      (tenant_id, actor_user_id, action, subject_type, subject_id, detail, created_at)
      values ($1, $2, 'lead.convert', 'lead', $3, '{}'::jsonb, $4)`,
    [tenantA, userA, validLegacyLead, evidenceAt]);

    try {
      await owner.query("set role salescrm_migration");
      await owner.query("select public.backfill_lead_conversions(5000)");
    } finally {
      await owner.query("reset role");
    }

    const converted = await owner.query<{ customer_id: string; opportunity_id: string; converted_by_user_id: string; created_epoch: string }>(`select
      customer_id, opportunity_id, converted_by_user_id, extract(epoch from created_at)::bigint::text as created_epoch
      from lead_conversions where tenant_id = $1 and lead_id = $2`, [tenantA, validLegacyLead]);
    expect(converted.rows).toEqual([{
      customer_id: customerA,
      opportunity_id: legacyOpportunity.rows[0].id,
      converted_by_user_id: userA,
      created_epoch: Math.floor(evidenceAt.getTime() / 1000).toString(),
    }]);
    const issue = await owner.query<{ reason_code: string }>(`select reason_code
      from lead_conversion_backfill_issues where tenant_id = $1 and lead_id = $2`, [tenantA, invalidLegacyLead]);
    expect(issue.rows).toEqual([{ reason_code: "OPPORTUNITY_MAPPING_NOT_UNIQUE" }]);
  });
});
