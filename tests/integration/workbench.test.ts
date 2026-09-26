import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("工作台集成测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("工作台集成测试不得使用开发数据库");
}
process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
let tenantA: string;
let tenantB: string;
let salesA: string;
let salesB: string;
let managerA: string;
let adminA: string;
let leadTaskId: string;
let customerTaskId: string;
let opportunityTaskId: string;
let highScoreTaskId: string;

async function createUser(tenantId: string, suffix: string, role: "SALES" | "MANAGER" | "ADMIN" = "SALES") {
  const name = role === "SALES" ? `销售 ${suffix}` : role === "MANAGER" ? `主管 ${suffix}` : `管理员 ${suffix}`;
  const result = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
    values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', $3, $4) returning id`,
  [tenantId, `workbench-${suffix}-${Date.now()}@example.com`, name, role]);
  return result.rows[0].id;
}

beforeAll(async () => {
  await owner.connect();
  const tenants = await owner.query<{ id: string }>("insert into tenants (name) values ('工作台 A'), ('工作台 B') returning id");
  tenantA = tenants.rows[0].id;
  tenantB = tenants.rows[1].id;
  salesA = await createUser(tenantA, "a");
  salesB = await createUser(tenantA, "b");
  managerA = await createUser(tenantA, "manager", "MANAGER");
  adminA = await createUser(tenantA, "admin", "ADMIN");
  const otherTenantSales = await createUser(tenantB, "cross-tenant");

  const lead = await owner.query<{ id: string }>(`insert into leads
    (tenant_id, owner_user_id, contact_name, contact_phone, company_name, status, score, score_reason, scored_at)
    values ($1, $2, '优先联系人', '13810001001', '优先公司', 'CONTACTED', 82, '明确公司与需求', now()) returning id`, [tenantA, salesA]);
  const customer = await owner.query<{ id: string }>(`insert into customers (tenant_id, owner_user_id, name)
    values ($1, $2, '工作台客户') returning id`, [tenantA, salesA]);
  const opportunity = await owner.query<{ id: string }>(`insert into opportunities
    (tenant_id, customer_id, owner_user_id, name, stage) values ($1, $2, $3, '工作台商机', 'PROPOSAL') returning id`,
  [tenantA, customer.rows[0].id, salesA]);

  leadTaskId = (await owner.query<{ id: string }>(`insert into tasks
    (tenant_id, lead_id, assignee_user_id, type, due_at) values ($1, $2, $3, 'FOLLOW_UP', now() - interval '1 hour') returning id`,
  [tenantA, lead.rows[0].id, salesA])).rows[0].id;
  customerTaskId = (await owner.query<{ id: string }>(`insert into tasks
    (tenant_id, customer_id, assignee_user_id, type, due_at) values ($1, $2, $3, 'FOLLOW_UP', (date_trunc('day', now() at time zone 'Asia/Shanghai') + interval '23 hours 59 minutes') at time zone 'Asia/Shanghai') returning id`,
  [tenantA, customer.rows[0].id, salesA])).rows[0].id;
  opportunityTaskId = (await owner.query<{ id: string }>(`insert into tasks
    (tenant_id, opportunity_id, assignee_user_id, type, due_at) values ($1, $2, $3, 'STAGE_PUSH', now() + interval '2 days') returning id`,
  [tenantA, opportunity.rows[0].id, salesA])).rows[0].id;

  const highScoreLead = await owner.query<{ id: string }>(`insert into leads
    (tenant_id, owner_user_id, contact_name, contact_phone, company_name, status, score, score_reason, scored_at)
    values ($1, $2, '高分联系人', '13810001005', '高分公司', 'CONTACTED', 75, '高意向来源', now()) returning id`, [tenantA, salesA]);
  highScoreTaskId = (await owner.query<{ id: string }>(`insert into tasks
    (tenant_id, lead_id, assignee_user_id, type, due_at) values ($1, $2, $3, 'FOLLOW_UP', now() + interval '5 days') returning id`,
  [tenantA, highScoreLead.rows[0].id, salesA])).rows[0].id;

  const hiddenLead = await owner.query<{ id: string }>(`insert into leads
    (tenant_id, owner_user_id, contact_name, contact_phone) values ($1, $2, '其他销售', '13810001002') returning id`, [tenantA, salesB]);
  await owner.query(`insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
    values ($1, $2, $3, 'FIRST_RESPONSE', now() - interval '2 hours')`, [tenantA, hiddenLead.rows[0].id, salesB]);
  const crossTenantLead = await owner.query<{ id: string }>(`insert into leads
    (tenant_id, owner_user_id, contact_name, contact_phone) values ($1, $2, '跨租户', '13810001003') returning id`, [tenantB, otherTenantSales]);
  await owner.query(`insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
    values ($1, $2, $3, 'FIRST_RESPONSE', now() - interval '3 hours')`, [tenantB, crossTenantLead.rows[0].id, otherTenantSales]);
  const deletedLead = await owner.query<{ id: string }>(`insert into leads
    (tenant_id, owner_user_id, contact_name, contact_phone, deleted_at) values ($1, $2, '已删除', '13810001004', now()) returning id`, [tenantA, salesA]);
  await owner.query(`insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
    values ($1, $2, $3, 'FIRST_RESPONSE', now() - interval '4 hours')`, [tenantA, deletedLead.rows[0].id, salesA]);

  await owner.query(`insert into leads
    (tenant_id, contact_name, contact_phone, is_possible_duplicate)
    values ($1, '待分配重复线索', '13810001006', true)`, [tenantA]);
  const stalledOpportunity = await owner.query<{ id: string }>(`insert into opportunities
    (tenant_id, customer_id, owner_user_id, name, stage)
    values ($1, $2, $3, '停滞商机', 'DISCOVERY') returning id`, [tenantA, customer.rows[0].id, salesB]);
  await owner.query(`insert into tasks
    (tenant_id, opportunity_id, assignee_user_id, type, due_at)
    values ($1, $2, $3, 'STAGE_PUSH', now() - interval '1 day')`, [tenantA, stalledOpportunity.rows[0].id, salesB]);

  await owner.query(`insert into lead_source_keys
    (tenant_id, name, source_key, token_hash, created_by_user_id, revoked_at)
    values ($1, '启用来源', 'workbench_active', $2, $3, null),
           ($1, '已撤销来源', 'workbench_revoked', $4, $3, now())`,
  [tenantA, "a".repeat(64), adminA, "b".repeat(64)]);
  await owner.query(`update score_rules set enabled = false
    where id = (select id from score_rules where tenant_id = $1 order by sort_order, id limit 1)`, [tenantA]);
  await owner.query(`insert into sales_insights
    (tenant_id, lead_id, code, severity, title, summary, suggested_action, source_version, refresh_failed_at)
    values ($1, $2, 'WORKBENCH_REFRESH_FAILURE', 'ATTENTION', '刷新失败', '测试刷新失败', '检查数据', 'test-v1', now())`,
  [tenantA, lead.rows[0].id]);
});

afterAll(async () => {
  await owner.query("delete from sales_insights where tenant_id in ($1, $2)", [tenantA, tenantB]);
  await owner.query("delete from tasks where tenant_id in ($1, $2)", [tenantA, tenantB]);
  await owner.query("delete from opportunities where tenant_id in ($1, $2)", [tenantA, tenantB]);
  await owner.query("delete from customers where tenant_id in ($1, $2)", [tenantA, tenantB]);
  await owner.query("delete from leads where tenant_id in ($1, $2)", [tenantA, tenantB]);
  await owner.query("delete from lead_source_keys where tenant_id in ($1, $2)", [tenantA, tenantB]);
  await owner.query("delete from users where tenant_id in ($1, $2)", [tenantA, tenantB]);
  await owner.query("delete from tenants where id in ($1, $2)", [tenantA, tenantB]);
  const { closeDb } = await import("@/db/client");
  await closeDb();
  await owner.end();
});

describe("销售工作台任务队列", () => {
  it("只返回当前销售的三类开放任务并按时效排序", async () => {
    const { listSalesWorkItemsService } = await import("@/core/workbench/service");
    const items = await listSalesWorkItemsService({ tenantId: tenantA, userId: salesA, role: "SALES" });
    expect(items.map((item) => item.taskId)).toEqual([leadTaskId, customerTaskId, highScoreTaskId, opportunityTaskId]);
    expect(items.map((item) => item.subjectType)).toEqual(["lead", "customer", "lead", "opportunity"]);
    expect(items[0]).toMatchObject({ subjectName: "优先联系人", subjectContext: "优先公司", score: 82, isOverdue: true });
    expect(items[1]).toMatchObject({ subjectName: "工作台客户", ownerName: "销售 a" });
    expect(items[2]).toMatchObject({ subjectName: "高分联系人", score: 75 });
    expect(items[3]).toMatchObject({ subjectName: "工作台商机", subjectContext: "工作台客户", stage: "PROPOSAL" });
  });

  it("遵守数量上限且拒绝非 SALES 角色", async () => {
    const { listSalesWorkItemsService } = await import("@/core/workbench/service");
    const limited = await listSalesWorkItemsService({ tenantId: tenantA, userId: salesA, role: "SALES" }, 1);
    expect(limited).toMatchObject([{ taskId: leadTaskId }]);
    expect(limited).toHaveLength(1);
    await expect(listSalesWorkItemsService({ tenantId: tenantA, userId: salesA, role: "MANAGER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listSalesWorkItemsService({ tenantId: tenantA, userId: salesA, role: "ADMIN" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("四档内按线索评分、截止时间和任务 ID 稳定排序", async () => {
    const sameDueAt = "date_trunc('minute', now()) + interval '3 days'";
    const createHighScoreTask = async (suffix: string, score: number, dueAt: string) => {
      const lead = await owner.query<{ id: string }>(`insert into leads
        (tenant_id, owner_user_id, contact_name, contact_phone, score, scored_at)
        values ($1, $2, $3, $4, $5, now()) returning id`,
      [tenantA, salesA, `稳定排序-${suffix}`, `1390000${suffix}`, score]);
      const task = await owner.query<{ id: string }>(`insert into tasks
        (tenant_id, lead_id, assignee_user_id, type, due_at)
        values ($1, $2, $3, 'FOLLOW_UP', ${dueAt}) returning id`, [tenantA, lead.rows[0].id, salesA]);
      return task.rows[0].id;
    };

    const highestScoreTaskId = await createHighScoreTask("0001", 95, "now() + interval '5 days'");
    const sameScoreTaskIds = await Promise.all([
      createHighScoreTask("0002", 90, sameDueAt),
      createHighScoreTask("0003", 90, sameDueAt),
    ]);

    try {
      const { listSalesWorkItemsService } = await import("@/core/workbench/service");
      const items = await listSalesWorkItemsService({ tenantId: tenantA, userId: salesA, role: "SALES" });
      const orderedHighScoreTasks = items
        .map((item) => item.taskId)
        .filter((taskId) => [highestScoreTaskId, ...sameScoreTaskIds].includes(taskId));

      expect(orderedHighScoreTasks).toEqual([highestScoreTaskId, ...sameScoreTaskIds.sort()]);
    } finally {
      await owner.query(`delete from tasks where tenant_id = $1 and lead_id in (
        select id from leads where tenant_id = $1 and contact_name like '稳定排序-%'
      )`, [tenantA]);
      await owner.query("delete from leads where tenant_id = $1 and contact_name like '稳定排序-%'", [tenantA]);
    }
  });

  it("已删除主体的任务不会挤占候选数量上限", async () => {
    await owner.query(`insert into leads
      (tenant_id, owner_user_id, contact_name, contact_phone, deleted_at)
      select $1, $2, '无效候选-' || n, '137' || lpad(n::text, 8, '0'), now()
      from generate_series(1, 25) as rows(n)`, [tenantA, salesA]);
    await owner.query(`insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
      select $1, l.id, $2, 'FIRST_RESPONSE', now() - interval '8 hours'
      from leads l where l.tenant_id = $1 and l.contact_name like '无效候选-%'`, [tenantA, salesA]);

    const { listSalesWorkItemsService } = await import("@/core/workbench/service");
    const limited = await listSalesWorkItemsService({ tenantId: tenantA, userId: salesA, role: "SALES" }, 1);
    expect(limited).toMatchObject([{ taskId: leadTaskId }]);
    expect(limited).toHaveLength(1);
  });
});

describe("角色工作台摘要", () => {
  it("主管摘要与团队池口径一致，并排除跨租户及已删除对象任务", async () => {
    const { getManagerWorkbenchService } = await import("@/core/workbench/service");
    const summary = await getManagerWorkbenchService({ tenantId: tenantA, userId: managerA, role: "MANAGER" });

    expect(summary).toMatchObject({
      unassignedLeads: 1,
      overdueLeads: 2,
      stalledOpportunities: 1,
      activeOpportunityStages: [
        { stage: "DISCOVERY", count: 1 },
        { stage: "PROPOSAL", count: 1 },
        { stage: "NEGOTIATION", count: 0 },
      ],
    });
    expect(summary.ownerLoad.map(({ userName, openTaskCount }) => ({ userName, openTaskCount }))).toEqual([
      { userName: "销售 a", openTaskCount: 4 },
      { userName: "销售 b", openTaskCount: 2 },
      { userName: "主管 manager", openTaskCount: 0 },
    ]);
  });

  it("管理员摘要只统计当前租户治理数据", async () => {
    const { getAdminWorkbenchService } = await import("@/core/workbench/service");
    const summary = await getAdminWorkbenchService({ tenantId: tenantA, userId: adminA, role: "ADMIN" });

    expect(summary).toEqual({
      sourceKeys: { enabled: 1, total: 2 },
      scoreRules: { enabled: 6, total: 7 },
      duplicateLeads: 1,
      unassignedLeads: 1,
      insightRefreshFailures: 1,
      countCeiling: 1000,
    });
  });

  it("服务端拒绝角色越权调用", async () => {
    const { getAdminWorkbenchService, getManagerWorkbenchService } = await import("@/core/workbench/service");
    await expect(getManagerWorkbenchService({ tenantId: tenantA, userId: salesA, role: "SALES" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getAdminWorkbenchService({ tenantId: tenantA, userId: managerA, role: "MANAGER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("线索池固定数量超过 ceiling 时有界返回并暴露截断口径", async () => {
    await owner.query(`insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, score, scored_at)
      select $1, $2, '容量线索-' || n, ('1382000' || lpad(n::text, 4, '0')), 75, now()
      from generate_series(1, 1005) as rows(n)`, [tenantA, salesA]);

    const { LEAD_COUNT_CEILING, listLeadsService } = await import("@/core/leads/service");
    const page = await listLeadsService({ tenantId: tenantA, userId: managerA, role: "MANAGER" });
    expect(page.items).toHaveLength(20);
    expect(page.countCeiling).toBe(LEAD_COUNT_CEILING);
    expect(page.counts.all).toBe(LEAD_COUNT_CEILING + 1);
    expect(page.counts["high-score"]).toBe(LEAD_COUNT_CEILING + 1);

    const indexes = await owner.query<{ indexname: string }>(`select indexname from pg_indexes
      where schemaname = 'public' and indexname in (
        'leads_tenant_active_created_cursor_idx', 'leads_tenant_active_score_cursor_idx',
        'tasks_tenant_lead_status_due_idx'
      ) order by indexname`);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'leads_tenant_active_created_cursor_idx',
      'leads_tenant_active_score_cursor_idx',
      'tasks_tenant_lead_status_due_idx',
    ]);
  });
});
