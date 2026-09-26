import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("Insight service 集成测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("Insight service 集成测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
let service: typeof import("@/core/insight/service");
let closeDb: typeof import("@/db/client").closeDb;
let tenantA: string;
let tenantB: string;
let ownerA: string;
let otherA: string;
let ownerB: string;
let phoneSuffix = 10;

const ownerContext = () => ({ tenantId: tenantA, userId: ownerA, role: "SALES" as const });
const otherContext = () => ({ tenantId: tenantA, userId: otherA, role: "SALES" as const });

async function createUser(tenantId: string, name: string, role: "SALES" | "MANAGER" = "SALES"): Promise<string> {
  const result = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
    values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', $3, $4) returning id`,
  [tenantId, `insight-service-${name}-${Date.now()}@example.com`, name, role]);
  return result.rows[0].id;
}

async function createLead(ownerId: string | null = ownerA): Promise<string> {
  phoneSuffix += 1;
  const result = await owner.query<{ id: string }>(`insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, status)
    values ($1, $2, '洞察测试联系人', $3, 'QUALIFIED') returning id`, [tenantA, ownerId, `1381234${String(phoneSuffix).padStart(4, "0")}`]);
  return result.rows[0].id;
}

async function createInsight(leadId: string, code: string, evidence: unknown[] = []): Promise<string> {
  const result = await owner.query<{ id: string }>(`insert into sales_insights
    (tenant_id, lead_id, code, severity, title, summary, suggested_action, source_version, evidence)
    values ($1, $2, $3, 'ATTENTION', '测试建议', '测试摘要', '测试动作', 'rules-v1', $4::jsonb) returning id`,
  [tenantA, leadId, code, JSON.stringify(evidence)]);
  return result.rows[0].id;
}

async function createFollowUp(leadId: string, dueAt: Date): Promise<string> {
  const result = await owner.query<{ id: string }>(`insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
    values ($1, $2, $3, 'FOLLOW_UP', $4) returning id`, [tenantA, leadId, ownerA, dueAt]);
  return result.rows[0].id;
}

async function createStalledOpportunity(): Promise<string> {
  phoneSuffix += 1;
  const customer = await owner.query<{ id: string }>(`insert into customers (tenant_id, owner_user_id, name)
    values ($1, $2, $3) returning id`, [tenantA, ownerA, `洞察测试客户 ${phoneSuffix}`]);
  const contact = await owner.query<{ id: string }>(`insert into contacts (tenant_id, customer_id, name, phone, is_primary)
    values ($1, $2, '洞察测试商机联系人', $3, true) returning id`, [tenantA, customer.rows[0].id, `1391234${String(phoneSuffix).padStart(4, "0")}`]);
  const opportunity = await owner.query<{ id: string }>(`insert into opportunities
    (tenant_id, customer_id, owner_user_id, primary_contact_id, name, stage, stage_entered_at)
    values ($1, $2, $3, $4, $5, 'DISCOVERY', now() - interval '8 days') returning id`,
  [tenantA, customer.rows[0].id, ownerA, contact.rows[0].id, `洞察测试商机 ${phoneSuffix}`]);
  return opportunity.rows[0].id;
}

async function addOpportunityActivity(opportunityId: string, type: "CALL" | "NOTE", summary: string): Promise<void> {
  await owner.query(`insert into activities (tenant_id, opportunity_id, user_id, type, outcome, summary, occurred_at)
    values ($1, $2, $3, $4::activity_type, $5::activity_outcome, $6, now())`,
  [tenantA, opportunityId, ownerA, type, type === "NOTE" ? null : "CONNECTED", summary]);
}

async function insightRows(leadId: string, code: string) {
  return owner.query<{ id: string; status: string; evidence: unknown[]; refresh_failed_at: string | null; updated_at: string }>(`select id, status, evidence, refresh_failed_at::text, updated_at::text
    from sales_insights where tenant_id = $1 and lead_id = $2 and code = $3 order by created_at`, [tenantA, leadId, code]);
}

async function opportunityInsightRows(opportunityId: string, code: string) {
  return owner.query<{ id: string; status: string; evidence: unknown[]; refresh_failed_at: string | null; updated_at: string }>(`select id, status, evidence, refresh_failed_at::text, updated_at::text
    from sales_insights where tenant_id = $1 and opportunity_id = $2 and code = $3 order by created_at`, [tenantA, opportunityId, code]);
}

beforeAll(async () => {
  await owner.connect();
  const tenants = await owner.query<{ id: string }>(`insert into tenants (name) values ('insight service A'), ('insight service B') returning id`);
  tenantA = tenants.rows[0].id;
  tenantB = tenants.rows[1].id;
  ownerA = await createUser(tenantA, "owner-a");
  otherA = await createUser(tenantA, "other-a");
  ownerB = await createUser(tenantB, "owner-b");
  service = await import("@/core/insight/service");
  ({ closeDb } = await import("@/db/client"));
});

afterAll(async () => {
  try {
    try {
      await owner.query("drop trigger if exists insight_service_block_rule_update on sales_insights");
    } finally {
      await owner.query("drop function if exists insight_service_block_rule_update()");
    }
  } finally {
    await closeDb();
    await owner.query(`delete from audit_logs where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]]);
    await owner.query(`delete from sales_insights where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]]);
    await owner.query(`delete from notifications where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]]);
    await owner.query(`delete from tasks where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]]);
    await owner.query(`delete from activities where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]]);
    await owner.query(`delete from opportunity_stage_history where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]]);
    await owner.query(`delete from opportunities where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]]);
    await owner.query(`delete from contacts where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]]);
    await owner.query(`delete from customers where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]]);
    await owner.query(`delete from leads where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]]);
    await owner.query(`delete from users where tenant_id = any($1::uuid[])`, [[tenantA, tenantB]]);
    await owner.query(`delete from tenants where id = any($1::uuid[])`, [[tenantA, tenantB]]);
    await owner.end();
  }
});

describe("sales insight service", () => {
  it("时间扫描使用专用索引，任务和阶段自然超时后无需其他写操作即可生成建议", async () => {
    const indexes = await owner.query<{ indexname: string; indexdef: string }>(`select indexname, indexdef from pg_indexes
      where schemaname = 'public' and indexname in ('tasks_tenant_followup_due_scan_idx', 'opportunities_tenant_stage_due_scan_idx')
      order by indexname`);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "opportunities_tenant_stage_due_scan_idx",
      "tasks_tenant_followup_due_scan_idx",
    ]);
    expect(indexes.rows.find((row) => row.indexname === "tasks_tenant_followup_due_scan_idx")?.indexdef)
      .toContain("INCLUDE (lead_id, customer_id, opportunity_id, assignee_user_id)");
    expect(indexes.rows.find((row) => row.indexname === "tasks_tenant_followup_due_scan_idx")?.indexdef)
      .toContain("WHERE ((status = 'OPEN'::task_status) AND (type = 'FOLLOW_UP'::task_type))");
    expect(indexes.rows.find((row) => row.indexname === "opportunities_tenant_stage_due_scan_idx")?.indexdef)
      .toContain("INCLUDE (owner_user_id)");

    const scanAt = new Date();
    const leadId = await createLead();
    const taskId = await createFollowUp(leadId, new Date(scanAt.getTime() - 3_600_000));
    const opportunityId = await createStalledOpportunity();
    await owner.query("update opportunities set stage_entered_at = $1 where id = $2", [new Date(scanAt.getTime() - 8 * 86_400_000), opportunityId]);
    const customer = await owner.query<{ customer_id: string }>("select customer_id from opportunities where id = $1", [opportunityId]);
    const customerTask = await owner.query<{ id: string }>(`insert into tasks (tenant_id, customer_id, assignee_user_id, type, due_at)
      values ($1, $2, $3, 'FOLLOW_UP', $4) returning id`,
    [tenantA, customer.rows[0].customer_id, ownerA, new Date(scanAt.getTime() - 7_200_000)]);

    const first = await service.scanSalesInsightsService(scanAt);
    expect(first.succeeded).toBeGreaterThanOrEqual(2);
    expect((await insightRows(leadId, "FOLLOWUP_OVERDUE")).rows[0]).toMatchObject({
      status: "OPEN",
      evidence: [{ taskId, dueAt: new Date(scanAt.getTime() - 3_600_000).toISOString() }],
    });
    expect((await opportunityInsightRows(opportunityId, "STAGE_STALLED")).rows[0]).toMatchObject({ status: "OPEN" });
    expect((await opportunityInsightRows(opportunityId, "FOLLOWUP_OVERDUE")).rows[0]).toMatchObject({
      status: "OPEN",
      evidence: [{ taskId: customerTask.rows[0].id, dueAt: new Date(scanAt.getTime() - 7_200_000).toISOString() }],
    });

    const leadUpdatedAt = (await insightRows(leadId, "FOLLOWUP_OVERDUE")).rows[0].updated_at;
    await service.scanSalesInsightsService(scanAt);
    expect((await insightRows(leadId, "FOLLOWUP_OVERDUE")).rows[0].updated_at).toBe(leadUpdatedAt);
  });

  it("时间扫描失败后下一轮可重试", async () => {
    const scanAt = new Date();
    const leadId = await createLead();
    await createFollowUp(leadId, new Date(scanAt.getTime() - 3_600_000));
    await owner.query(`create function insight_service_block_scan_insert() returns trigger language plpgsql as $$
      begin if new.source_type = 'RULE' then raise exception 'test blocks scan insight insert'; end if; return new; end; $$`);
    await owner.query("create trigger insight_service_block_scan_insert before insert on sales_insights for each row execute function insight_service_block_scan_insert()");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const failed = await service.scanSalesInsightsService(scanAt);
      expect(failed.failed).toBeGreaterThan(0);
      expect((await insightRows(leadId, "FOLLOWUP_OVERDUE")).rows).toHaveLength(0);

      await owner.query("drop trigger insight_service_block_scan_insert on sales_insights");
      await owner.query("drop function insight_service_block_scan_insert()");
      const retried = await service.scanSalesInsightsService(scanAt);
      expect(retried.succeeded).toBeGreaterThan(0);
      expect((await insightRows(leadId, "FOLLOWUP_OVERDUE")).rows[0]).toMatchObject({ status: "OPEN" });
    } finally {
      errorSpy.mockRestore();
      await owner.query("drop trigger if exists insight_service_block_scan_insert on sales_insights");
      await owner.query("drop function if exists insight_service_block_scan_insert()");
    }
  });

  it("最近 20 条活动窗口不会丢失更早但仍在 SLA 内的有效推进", async () => {
    const scanAt = new Date();
    const opportunityId = await createStalledOpportunity();
    const enteredAt = new Date(scanAt.getTime() - 8 * 86_400_000);
    await owner.query("update opportunities set stage_entered_at = $1 where id = $2", [enteredAt, opportunityId]);
    await owner.query(`insert into activities (tenant_id, opportunity_id, user_id, type, outcome, summary, occurred_at)
      values ($1, $2, $3, 'CALL', 'CONNECTED', '客户已经确认预算范围并约定下一次方案评审', $4)`,
    [tenantA, opportunityId, ownerA, new Date(scanAt.getTime() - 2 * 86_400_000)]);
    for (let index = 0; index < 20; index += 1) {
      await owner.query(`insert into activities (tenant_id, opportunity_id, user_id, type, outcome, summary, occurred_at)
        values ($1, $2, $3, 'CALL', 'CONNECTED', '已联系', $4)`,
      [tenantA, opportunityId, ownerA, new Date(scanAt.getTime() - index * 3_600_000)]);
    }

    await service.refreshInsightsService(ownerContext(), { type: "opportunity", id: opportunityId }, scanAt);
    expect((await opportunityInsightRows(opportunityId, "STAGE_STALLED")).rows).toHaveLength(0);
  });

  it("生成、更新、过期，并将并发刷新收敛为唯一 OPEN", async () => {
    const leadId = await createLead();
    const firstDueAt = new Date(Date.now() - 3_600_000);
    const taskId = await createFollowUp(leadId, firstDueAt);

    await Promise.all([
      service.refreshInsightsService(ownerContext(), { type: "lead", id: leadId }),
      service.refreshInsightsService(ownerContext(), { type: "lead", id: leadId }),
    ]);
    let rows = await insightRows(leadId, "FOLLOWUP_OVERDUE");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe("OPEN");
    expect(rows.rows[0].evidence).toEqual([{ taskId, dueAt: firstDueAt.toISOString() }]);

    const updatedDueAt = new Date(Date.now() - 1_800_000);
    await owner.query("update tasks set due_at = $1 where id = $2", [updatedDueAt, taskId]);
    await service.refreshInsightsService(ownerContext(), { type: "lead", id: leadId });
    rows = await insightRows(leadId, "FOLLOWUP_OVERDUE");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].evidence).toEqual([{ taskId, dueAt: updatedDueAt.toISOString() }]);

    await owner.query("update tasks set due_at = now() + interval '1 day' where id = $1", [taskId]);
    await service.refreshInsightsService(ownerContext(), { type: "lead", id: leadId });
    rows = await insightRows(leadId, "FOLLOWUP_OVERDUE");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe("EXPIRED");
  });

  it("终态相同证据不复活，证据变化才新建", async () => {
    const leadId = await createLead();
    const firstDueAt = new Date(Date.now() - 3_600_000);
    const taskId = await createFollowUp(leadId, firstDueAt);
    await service.refreshInsightsService(ownerContext(), { type: "lead", id: leadId });
    const original = (await insightRows(leadId, "FOLLOWUP_OVERDUE")).rows[0];

    await service.dismissSalesInsightService(ownerContext(), original.id, "ALREADY_HANDLED");
    await service.refreshInsightsService(ownerContext(), { type: "lead", id: leadId });
    let rows = await insightRows(leadId, "FOLLOWUP_OVERDUE");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe("DISMISSED");

    const changedDueAt = new Date(Date.now() - 1_800_000);
    await owner.query("update tasks set due_at = $1 where id = $2", [changedDueAt, taskId]);
    await service.refreshInsightsService(ownerContext(), { type: "lead", id: leadId });
    rows = await insightRows(leadId, "FOLLOWUP_OVERDUE");
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => row.status)).toEqual(["DISMISSED", "OPEN"]);
  });

  it("ACCEPTED 同证据不复活，证据变化才新建", async () => {
    const leadId = await createLead();
    const firstDueAt = new Date(Date.now() - 3_600_000);
    const taskId = await createFollowUp(leadId, firstDueAt);
    await service.refreshInsightsService(ownerContext(), { type: "lead", id: leadId });
    const original = (await insightRows(leadId, "FOLLOWUP_OVERDUE")).rows[0];
    await service.acceptSalesInsightService(ownerContext(), original.id, new Date(Date.now() + 86_400_000));

    await owner.query("update tasks set due_at = $1 where id = $2", [firstDueAt, taskId]);
    await service.refreshInsightsService(ownerContext(), { type: "lead", id: leadId });
    let rows = await insightRows(leadId, "FOLLOWUP_OVERDUE");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe("ACCEPTED");

    const changedDueAt = new Date(Date.now() - 1_800_000);
    await owner.query("update tasks set due_at = $1 where id = $2", [changedDueAt, taskId]);
    await service.refreshInsightsService(ownerContext(), { type: "lead", id: leadId });
    rows = await insightRows(leadId, "FOLLOWUP_OVERDUE");
    expect(rows.rows.map((row) => row.status)).toEqual(["ACCEPTED", "OPEN"]);
  });

  it("商机停滞读取 stage facts，NOTE 不推进，有效跟进后过期", async () => {
    const opportunityId = await createStalledOpportunity();
    await service.refreshInsightsService(ownerContext(), { type: "opportunity", id: opportunityId });
    let stalled = await owner.query<{ status: string }>(`select status from sales_insights
      where tenant_id = $1 and opportunity_id = $2 and code = 'STAGE_STALLED'`, [tenantA, opportunityId]);
    expect(stalled.rows).toEqual([{ status: "OPEN" }]);

    await addOpportunityActivity(opportunityId, "NOTE", "已记录内部备注，不应推进商机");
    await service.refreshInsightsService(ownerContext(), { type: "opportunity", id: opportunityId });
    stalled = await owner.query<{ status: string }>(`select status from sales_insights
      where tenant_id = $1 and opportunity_id = $2 and code = 'STAGE_STALLED'`, [tenantA, opportunityId]);
    expect(stalled.rows).toEqual([{ status: "OPEN" }]);

    await addOpportunityActivity(opportunityId, "CALL", "已确认客户预算、决策链和下一次演示时间，商机正在正常推进。");
    await service.refreshInsightsService(ownerContext(), { type: "opportunity", id: opportunityId });
    stalled = await owner.query<{ status: string }>(`select status from sales_insights
      where tenant_id = $1 and opportunity_id = $2 and code = 'STAGE_STALLED'`, [tenantA, opportunityId]);
    expect(stalled.rows).toEqual([{ status: "EXPIRED" }]);
  });

  it("accept/dismiss 校验权限、并发、任务与审计", async () => {
    const leadId = await createLead();
    const existingTaskId = await createFollowUp(leadId, new Date(Date.now() + 86_400_000));
    const insightId = await createInsight(leadId, "ACCEPT_TEST", [{ version: 1 }]);
    const future = new Date(Date.now() + 172_800_000);

    await expect(service.acceptSalesInsightService(ownerContext(), insightId, new Date(Date.now() - 1))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.acceptSalesInsightService(otherContext(), insightId, future)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const concurrent = await Promise.allSettled([
      service.acceptSalesInsightService(ownerContext(), insightId, future),
      service.acceptSalesInsightService(ownerContext(), insightId, future),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    const accepted = concurrent.find((result): result is PromiseFulfilledResult<{ insightId: string; taskId: string }> => result.status === "fulfilled")!.value;
    expect(accepted.taskId).toBe(existingTaskId);

    const task = await owner.query<{ type: string; due_at: string; assignee_user_id: string }>("select type, due_at::text, assignee_user_id from tasks where id = $1", [existingTaskId]);
    expect(task.rows[0].type).toBe("FOLLOW_UP");
    expect(new Date(task.rows[0].due_at).getTime()).toBe(future.getTime());
    expect(task.rows[0].assignee_user_id).toBe(ownerA);
    const acceptedInsight = await owner.query<{ status: string; accepted_task_id: string }>("select status, accepted_task_id from sales_insights where id = $1", [insightId]);
    expect(acceptedInsight.rows).toEqual([{ status: "ACCEPTED", accepted_task_id: existingTaskId }]);
    const audit = await owner.query<{ action: string }>("select action from audit_logs where tenant_id = $1 and subject_id = $2", [tenantA, insightId]);
    expect(audit.rows).toEqual([{ action: "insight.accept" }]);

    const dismissId = await createInsight(leadId, "DISMISS_TEST");
    await expect(service.dismissSalesInsightService(ownerContext(), dismissId, "INVALID" as never)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.dismissSalesInsightService(otherContext(), dismissId, "OTHER")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await service.dismissSalesInsightService(ownerContext(), dismissId, "WRONG_INFORMATION");
    const dismissed = await owner.query<{ status: string; dismiss_reason: string }>("select status, dismiss_reason from sales_insights where id = $1", [dismissId]);
    expect(dismissed.rows).toEqual([{ status: "DISMISSED", dismiss_reason: "WRONG_INFORMATION" }]);
    const dismissAudit = await owner.query<{ action: string }>("select action from audit_logs where tenant_id = $1 and subject_id = $2", [tenantA, dismissId]);
    expect(dismissAudit.rows).toEqual([{ action: "insight.dismiss" }]);
  });

  it("未分配线索拒绝 accept，跨租户 insight 返回 NOT_FOUND", async () => {
    const unassignedLead = await createLead(null);
    const unassignedInsight = await createInsight(unassignedLead, "UNASSIGNED");
    // SALES 对无属主主体一律 NOT_FOUND
    await expect(service.acceptSalesInsightService(ownerContext(), unassignedInsight, new Date(Date.now() + 86_400_000))).rejects.toMatchObject({ code: "NOT_FOUND" });
    // 主管角色可查看无主主体，但因未分配负责人触发 INVALID_TRANSITION
    const managerCtx = { tenantId: tenantA, userId: ownerA, role: "MANAGER" as const };
    await expect(service.acceptSalesInsightService(managerCtx, unassignedInsight, new Date(Date.now() + 86_400_000))).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    const foreignLead = await owner.query<{ id: string }>(`insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, status)
      values ($1, $2, '外部线索', '13812999999', 'QUALIFIED') returning id`, [tenantB, ownerB]);
    const foreignInsight = await owner.query<{ id: string }>(`insert into sales_insights
      (tenant_id, lead_id, code, severity, title, summary, suggested_action, source_version, evidence)
      values ($1, $2, 'FOREIGN', 'INFO', '外部', '外部', '外部', 'rules-v1', '[]'::jsonb) returning id`, [tenantB, foreignLead.rows[0].id]);
    await expect(service.dismissSalesInsightService(ownerContext(), foreignInsight.rows[0].id, "OTHER")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.getSalesInsightsService(ownerContext(), { type: "lead", id: foreignLead.rows[0].id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const otherLead = await createLead(otherA);
    await createInsight(otherLead, "OTHER_OWNER");
    await expect(service.getSalesInsightsService(ownerContext(), { type: "lead", id: otherLead })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("授权失败只记录日志，不标记他人对象", async () => {
    const leadId = await createLead();
    const insightId = await createInsight(leadId, "NO_MARK_ON_NOT_FOUND");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await service.refreshInsightsSafely(otherContext(), { type: "lead", id: leadId });
      const row = await owner.query<{ refresh_failed_at: string | null }>("select refresh_failed_at::text from sales_insights where id = $1", [insightId]);
      expect(row.rows[0].refresh_failed_at).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith("sales insight refresh failed", expect.objectContaining({ tenantId: tenantA, subjectType: "lead", subjectId: leadId }));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("规则写入失败时保留旧建议、标记失败，恢复后清空", async () => {
    const leadId = await createLead();
    const firstDueAt = new Date(Date.now() - 3_600_000);
    const taskId = await createFollowUp(leadId, firstDueAt);
    await service.refreshInsightsService(ownerContext(), { type: "lead", id: leadId });
    const before = (await insightRows(leadId, "FOLLOWUP_OVERDUE")).rows[0];
    const changedDueAt = new Date(Date.now() - 1_800_000);
    await owner.query("update tasks set due_at = $1 where id = $2", [changedDueAt, taskId]);
    await owner.query(`create function insight_service_block_rule_update() returns trigger language plpgsql as $$
      begin
        if new.source_type = 'RULE' and (
          new.severity is distinct from old.severity or new.title is distinct from old.title or
          new.summary is distinct from old.summary or new.suggested_action is distinct from old.suggested_action or
          new.suggested_due_at is distinct from old.suggested_due_at or new.evidence is distinct from old.evidence or
          new.source_type is distinct from old.source_type or new.source_version is distinct from old.source_version
        ) then raise exception 'test blocks rule insight update'; end if;
        return new;
      end;
    $$`);
    await owner.query("create trigger insight_service_block_rule_update before update on sales_insights for each row execute function insight_service_block_rule_update()");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await service.refreshInsightsSafely(ownerContext(), { type: "lead", id: leadId });
      let rows = await insightRows(leadId, "FOLLOWUP_OVERDUE");
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({ id: before.id, status: "OPEN", evidence: before.evidence });
      expect(rows.rows[0].refresh_failed_at).not.toBeNull();
      expect(errorSpy).toHaveBeenCalledWith("sales insight refresh failed", expect.objectContaining({ tenantId: tenantA, subjectType: "lead", subjectId: leadId }));

      await owner.query("drop trigger insight_service_block_rule_update on sales_insights");
      await owner.query("drop function insight_service_block_rule_update()");
      await service.refreshInsightsSafely(ownerContext(), { type: "lead", id: leadId });
      rows = await insightRows(leadId, "FOLLOWUP_OVERDUE");
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].evidence).toEqual([{ taskId, dueAt: changedDueAt.toISOString() }]);
      expect(rows.rows[0].refresh_failed_at).toBeNull();
    } finally {
      errorSpy.mockRestore();
      await owner.query("drop trigger if exists insight_service_block_rule_update on sales_insights");
      await owner.query("drop function if exists insight_service_block_rule_update()");
    }
  });
});
