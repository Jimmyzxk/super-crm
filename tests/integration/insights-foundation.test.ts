import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("Insight 集成测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("Insight 集成测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
const app = new pg.Client({ connectionString: appUrl });
let tenantA: string;
let tenantB: string;
let userA: string;
let leadA: string;
let leadB: string;
let opportunityA: string;
let tenantBInsightId: string;

async function setTenant(tenantId: string): Promise<void> {
  await app.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
}

async function insertInsight(subject: "lead" | "opportunity", subjectId: string, code: string, fields = ""): Promise<string> {
  const column = subject === "lead" ? "lead_id" : "opportunity_id";
  const result = await app.query<{ id: string }>(`insert into sales_insights (tenant_id, ${column}, code, severity, title, summary, suggested_action, source_version, evidence${fields ? `, ${fields.split(" values ")[0]}` : ""})
    values ($1, $2, $3, 'ATTENTION', '测试建议', '测试摘要', '测试动作', 'rules-v1', '[]'::jsonb${fields ? `, ${fields.split(" values ")[1]}` : ""}) returning id`, [tenantA, subjectId, code]);
  return result.rows[0].id;
}

beforeAll(async () => {
  await owner.connect();
  await app.connect();
  const tenants = await owner.query<{ id: string }>("insert into tenants (name) values ('insights 测试 A'), ('insights 测试 B') returning id");
  tenantA = tenants.rows[0].id;
  tenantB = tenants.rows[1].id;
  const users = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name)
    values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', 'insights A'),
           ($3, $4, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', 'insights B') returning id`, [tenantA, `insights-a-${Date.now()}@example.com`, tenantB, `insights-b-${Date.now()}@example.com`]);
  userA = users.rows[0].id;
  const leads = await owner.query<{ id: string }>(`insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, status)
    values ($1, $2, '线索 A', '13812345001', 'QUALIFIED'), ($3, $4, '线索 B', '13812345002', 'QUALIFIED') returning id`, [tenantA, userA, tenantB, users.rows[1].id]);
  leadA = leads.rows[0].id;
  leadB = leads.rows[1].id;
  const tenantBInsight = await owner.query<{ id: string }>(`insert into sales_insights
    (tenant_id, lead_id, code, severity, title, summary, suggested_action, source_version, evidence)
    values ($1, $2, 'TENANT_B_SEED', 'INFO', '租户 B 建议', '租户 B 摘要', '租户 B 动作', 'rules-v1', '[]'::jsonb)
    returning id`, [tenantB, leadB]);
  tenantBInsightId = tenantBInsight.rows[0].id;
  const customer = await owner.query<{ id: string }>("insert into customers (tenant_id, owner_user_id, name) values ($1, $2, '客户 A') returning id", [tenantA, userA]);
  const contact = await owner.query<{ id: string }>("insert into contacts (tenant_id, customer_id, name, phone, is_primary) values ($1, $2, '联系人 A', '13912345001', true) returning id", [tenantA, customer.rows[0].id]);
  const opportunity = await owner.query<{ id: string }>(`insert into opportunities (tenant_id, customer_id, owner_user_id, primary_contact_id, name)
    values ($1, $2, $3, $4, '商机 A') returning id`, [tenantA, customer.rows[0].id, userA, contact.rows[0].id]);
  opportunityA = opportunity.rows[0].id;
  await setTenant(tenantA);
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

describe("sales insights 基础约束", () => {
  it("跨租户不可读、不可写", async () => {
    await setTenant(tenantA);
    await insertInsight("lead", leadA, "RLS_READ");
    const hiddenById = await app.query("select id from sales_insights where id = $1", [tenantBInsightId]);
    expect(hiddenById.rows).toHaveLength(0);
    const hiddenByUnfilteredRead = await app.query("select id from sales_insights");
    expect(hiddenByUnfilteredRead.rows.some((row) => row.id === tenantBInsightId)).toBe(false);
    const security = await owner.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean; owner: string }>(`select c.relrowsecurity, c.relforcerowsecurity, r.rolname as owner
      from pg_class c join pg_roles r on r.oid = c.relowner where c.relname = 'sales_insights'`);
    expect(security.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true, owner: expect.not.stringMatching(/^salescrm$/) }]);
    await expect(app.query(`insert into sales_insights (tenant_id, lead_id, code, severity, title, summary, suggested_action, source_version, evidence)
      values ($1, $2, 'RLS_WRITE', 'ATTENTION', '越权', '越权', '越权', 'rules-v1', '[]'::jsonb)`, [tenantB, leadB])).rejects.toMatchObject({ code: "42501" });
  });

  it("合法 lead 和 opportunity insight 可写，且 subject 必须恰一", async () => {
    await setTenant(tenantA);
    expect(await insertInsight("lead", leadA, "VALID_LEAD")).toBeTruthy();
    expect(await insertInsight("opportunity", opportunityA, "VALID_OPPORTUNITY")).toBeTruthy();
    await expect(app.query(`insert into sales_insights (tenant_id, code, severity, title, summary, suggested_action, source_version, evidence)
      values ($1, 'NO_SUBJECT', 'INFO', '无对象', '无对象', '无对象', 'rules-v1', '[]'::jsonb)`, [tenantA])).rejects.toMatchObject({ code: "23514" });
    await expect(app.query(`insert into sales_insights (tenant_id, lead_id, opportunity_id, code, severity, title, summary, suggested_action, source_version, evidence)
      values ($1, $2, $3, 'TWO_SUBJECTS', 'INFO', '双对象', '双对象', '双对象', 'rules-v1', '[]'::jsonb)`, [tenantA, leadA, opportunityA])).rejects.toMatchObject({ code: "23514" });
  });

  it("同一对象和 code 只允许一条 OPEN", async () => {
    await setTenant(tenantA);
    await insertInsight("lead", leadA, "DUPLICATE_OPEN");
    await expect(insertInsight("lead", leadA, "DUPLICATE_OPEN")).rejects.toMatchObject({ code: "23505" });
  });

  it("状态字段必须与状态一致", async () => {
    await setTenant(tenantA);
    await expect(app.query(`insert into sales_insights (tenant_id, lead_id, code, severity, status, title, summary, suggested_action, source_version, evidence)
      values ($1, $2, 'DISMISSED_NO_REASON', 'INFO', 'DISMISSED', 'x', 'x', 'x', 'rules-v1', '[]'::jsonb)`, [tenantA, leadA])).rejects.toMatchObject({ code: "23514" });
    await expect(app.query(`insert into sales_insights (tenant_id, lead_id, code, severity, status, title, summary, suggested_action, source_version, evidence)
      values ($1, $2, 'ACCEPTED_NO_TASK', 'INFO', 'ACCEPTED', 'x', 'x', 'x', 'rules-v1', '[]'::jsonb)`, [tenantA, leadA])).rejects.toMatchObject({ code: "23514" });
    await expect(app.query(`insert into sales_insights (tenant_id, lead_id, code, severity, status, dismiss_reason, title, summary, suggested_action, source_version, evidence)
      values ($1, $2, 'OPEN_WITH_REASON', 'INFO', 'OPEN', '已处理', 'x', 'x', 'x', 'rules-v1', '[]'::jsonb)`, [tenantA, leadA])).rejects.toMatchObject({ code: "23514" });
  });

  it("evidence 必须是 JSON 数组", async () => {
    await setTenant(tenantA);
    await expect(app.query(`insert into sales_insights (tenant_id, lead_id, code, severity, title, summary, suggested_action, source_version, evidence)
      values ($1, $2, 'BAD_EVIDENCE', 'INFO', 'x', 'x', 'x', 'rules-v1', '{"not":"array"}'::jsonb)`, [tenantA, leadA])).rejects.toMatchObject({ code: "23514" });
  });
});
