import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("洞察触发集成测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("洞察触发集成测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
let tenantId: string;
let userId: string;
let phoneSuffix = 0;
let closeDb: typeof import("@/db/client").closeDb;

const ctx = () => ({ tenantId, userId, role: "SALES" as const });

async function createCustomer(): Promise<{ customerId: string; contactId: string }> {
  phoneSuffix += 1;
  const customer = await owner.query<{ id: string }>(`insert into customers (tenant_id, owner_user_id, name)
    values ($1, $2, $3) returning id`, [tenantId, userId, `触发测试客户 ${phoneSuffix}`]);
  const contact = await owner.query<{ id: string }>(`insert into contacts (tenant_id, customer_id, name, phone, is_primary)
    values ($1, $2, $3, $4, true) returning id`, [tenantId, customer.rows[0].id, "触发测试联系人", `1390000${String(phoneSuffix).padStart(4, "0")}`]);
  return { customerId: customer.rows[0].id, contactId: contact.rows[0].id };
}

async function createLead(): Promise<string> {
  phoneSuffix += 1;
  const lead = await owner.query<{ id: string }>(`insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, status)
    values ($1, $2, $3, $4, 'QUALIFIED') returning id`, [tenantId, userId, "触发测试线索", `1380000${String(phoneSuffix).padStart(4, "0")}`]);
  return lead.rows[0].id;
}

async function createOpportunity(stage: "DISCOVERY" | "PROPOSAL" | "NEGOTIATION" = "DISCOVERY"): Promise<string> {
  const { customerId, contactId } = await createCustomer();
  const { createOpportunityService } = await import("@/core/opportunity/service");
  return (await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: `触发测试商机 ${phoneSuffix}`, stage })).opportunityId;
}

async function openInsights(subject: "lead" | "opportunity", id: string): Promise<Array<{ id: string; code: string; status: string; refresh_failed_at: string | null; updated_at: string }>> {
  const column = subject === "lead" ? "lead_id" : "opportunity_id";
  const result = await owner.query<{ id: string; code: string; status: string; refresh_failed_at: string | null; updated_at: string }>(
    `select id, code, status, refresh_failed_at::text, updated_at::text from sales_insights where tenant_id = $1 and ${column} = $2 order by created_at`,
    [tenantId, id],
  );
  return result.rows;
}

async function clearTriggers(): Promise<void> {
  await owner.query("drop trigger if exists insight_trigger_block_rule_insert on sales_insights");
  await owner.query("drop trigger if exists insight_trigger_block_rule_update on sales_insights");
  await owner.query("drop function if exists insight_trigger_block_rule_insert()");
  await owner.query("drop function if exists insight_trigger_block_rule_update()");
}

beforeAll(async () => {
  await owner.connect();
  const tenant = await owner.query<{ id: string }>("insert into tenants (name) values ('洞察触发测试') returning id");
  tenantId = tenant.rows[0].id;
  const user = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
    values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8', '触发测试用户', 'SALES') returning id`,
  [tenantId, `insight-triggers-${Date.now()}@example.com`]);
  userId = user.rows[0].id;
  ({ closeDb } = await import("@/db/client"));
});

afterAll(async () => {
  await clearTriggers();
  await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
  await owner.query("delete from deal_interventions where tenant_id = $1", [tenantId]).catch(() => {});
  await owner.query("delete from sales_schedules where tenant_id = $1", [tenantId]).catch(() => {});
  await owner.query("delete from sales_insights where tenant_id = $1", [tenantId]);
  await owner.query("delete from notifications where tenant_id = $1", [tenantId]);
  await owner.query("delete from tasks where tenant_id = $1", [tenantId]);
  await owner.query("delete from activities where tenant_id = $1", [tenantId]);
  await owner.query("delete from lead_status_history where tenant_id = $1", [tenantId]);
  await owner.query("delete from opportunity_stage_history where tenant_id = $1", [tenantId]);
  await owner.query("delete from win_reviews where tenant_id = $1", [tenantId]);
  await owner.query("delete from opportunities where tenant_id = $1", [tenantId]);
  await owner.query("delete from contacts where tenant_id = $1", [tenantId]);
  await owner.query("delete from customers where tenant_id = $1", [tenantId]);
  await owner.query("delete from leads where tenant_id = $1", [tenantId]);
  await owner.query("delete from users where tenant_id = $1", [tenantId]);
  await owner.query("delete from tenants where id = $1", [tenantId]);
  await closeDb();
  await owner.end();
});

describe("业务提交后的洞察触发", () => {
  it("lead 活动先生成 NO_NEXT_STEP，再由带下一步的活动使旧建议 EXPIRED", async () => {
    const leadId = await createLead();
    const { logActivityService } = await import("@/core/followup/service");
    await logActivityService(ctx(), { leadId, type: "CALL", outcome: "CONNECTED", summary: "已完成首次沟通" });
    expect((await openInsights("lead", leadId)).map((row) => row.code)).toContain("NO_NEXT_STEP");
    await logActivityService(ctx(), { leadId, type: "CALL", outcome: "INTERESTED", summary: "客户确认方案方向并约定下一次沟通", nextFollowUpAt: new Date(Date.now() + 86400000) });
    expect((await openInsights("lead", leadId)).find((row) => row.code === "NO_NEXT_STEP")).toMatchObject({ status: "EXPIRED" });
  });

  it("opportunity 活动、推进、回退、赢单和丢单都会刷新，终态没有 OPEN 建议", async () => {
    const { logActivityService } = await import("@/core/followup/service");
    const { advanceStageService, revertStageService, winOpportunityService, loseOpportunityService } = await import("@/core/opportunity/service");
    const wonId = await createOpportunity();
    await logActivityService(ctx(), { opportunityId: wonId, type: "CALL", outcome: "CONNECTED", summary: "确认需求并安排后续方案沟通" });
    expect((await openInsights("opportunity", wonId)).length).toBeGreaterThan(0);
    await advanceStageService(ctx(), { opportunityId: wonId, fromStage: "DISCOVERY", toStage: "PROPOSAL", note: "方案阶段" });
    await revertStageService(ctx(), { opportunityId: wonId, fromStage: "PROPOSAL", toStage: "DISCOVERY", note: "回退补充需求" });
    await advanceStageService(ctx(), { opportunityId: wonId, fromStage: "DISCOVERY", toStage: "PROPOSAL", note: "再次进入方案" });
    await advanceStageService(ctx(), { opportunityId: wonId, fromStage: "PROPOSAL", toStage: "NEGOTIATION", note: "进入谈判" });
    await winOpportunityService(ctx(), { opportunityId: wonId, actualAmount: 100, actualCloseAt: new Date() });
    expect((await openInsights("opportunity", wonId)).filter((row) => row.status === "OPEN")).toHaveLength(0);

    const lostId = await createOpportunity();
    await loseOpportunityService(ctx(), { opportunityId: lostId, reason: "TIMING", note: "时机不合适" });
    expect((await openInsights("opportunity", lostId)).filter((row) => row.status === "OPEN")).toHaveLength(0);
  });

  it("改约 FOLLOW_UP 会在未来和过去之间切换洞察", async () => {
    const leadId = await createLead();
    const task = await owner.query<{ id: string }>(`insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
      values ($1, $2, $3, 'FOLLOW_UP', now() + interval '1 day') returning id`, [tenantId, leadId, userId]);
    const { rescheduleTaskService } = await import("@/core/followup/service");
    await rescheduleTaskService(ctx(), task.rows[0].id, new Date(Date.now() - 3600000));
    expect((await openInsights("lead", leadId)).map((row) => row.code)).toContain("FOLLOWUP_OVERDUE");
    await rescheduleTaskService(ctx(), task.rows[0].id, new Date(Date.now() + 86400000));
    expect((await openInsights("lead", leadId)).find((row) => row.code === "FOLLOWUP_OVERDUE")).toMatchObject({ status: "EXPIRED" });
  });

  it("放弃、恢复和合并线索都会在业务提交后刷新建议", async () => {
    const { logActivityService } = await import("@/core/followup/service");
    const { discardLeadService, mergeLeadService, restoreLeadService } = await import("@/core/leads/service");
    const sourceLeadId = await createLead();
    const targetLeadId = await createLead();
    await logActivityService(ctx(), { leadId: sourceLeadId, type: "CALL", outcome: "CONNECTED", summary: "已完成初次沟通但尚未约定下一步" });
    const sourceInsight = (await openInsights("lead", sourceLeadId)).find((row) => row.code === "NO_NEXT_STEP");
    expect(sourceInsight).toBeTruthy();

    await mergeLeadService(ctx(), sourceLeadId, targetLeadId);
    expect((await openInsights("lead", sourceLeadId)).find((row) => row.id === sourceInsight!.id)).toMatchObject({ status: "EXPIRED" });
    expect((await openInsights("lead", targetLeadId)).map((row) => row.code)).toContain("NO_NEXT_STEP");

    await discardLeadService(ctx(), { leadId: targetLeadId, reason: "NO_NEED" });
    expect((await openInsights("lead", targetLeadId)).filter((row) => row.status === "OPEN")).toHaveLength(0);
    const stale = await owner.query<{ id: string }>(`insert into sales_insights
      (tenant_id, lead_id, code, severity, title, summary, suggested_action, source_version, evidence)
      values ($1, $2, 'RESTORE_STALE', 'ATTENTION', '旧建议', '旧建议', '旧建议', 'rules-v1', '[]'::jsonb) returning id`,
    [tenantId, targetLeadId]);
    await restoreLeadService({ ...ctx(), role: "MANAGER" }, targetLeadId);
    expect((await openInsights("lead", targetLeadId)).find((row) => row.id === stale.rows[0].id)).toMatchObject({ status: "EXPIRED" });
  });

  it("编辑商机后刷新已有建议", async () => {
    const { logActivityService } = await import("@/core/followup/service");
    const { updateOpportunityService } = await import("@/core/opportunity/service");
    const opportunityId = await createOpportunity();
    await logActivityService(ctx(), { opportunityId, type: "CALL", outcome: "CONNECTED", summary: "客户确认需要继续评估但尚未约定下一步" });
    const insight = (await openInsights("opportunity", opportunityId)).find((row) => row.code === "NO_NEXT_STEP");
    expect(insight).toBeTruthy();
    await owner.query("update sales_insights set updated_at = '2020-01-01T00:00:00Z' where id = $1", [insight!.id]);
    await updateOpportunityService(ctx(), { opportunityId, name: "编辑后刷新洞察的商机" });
    const refreshed = (await openInsights("opportunity", opportunityId)).find((row) => row.id === insight!.id);
    expect(new Date(refreshed!.updated_at).getTime()).toBeGreaterThan(new Date("2020-01-01T00:00:00Z").getTime());
  });

  it("客户级跟进和任务作为共享事实刷新该客户的活跃商机", async () => {
    const { customerId, contactId } = await createCustomer();
    const { logActivityService, rescheduleTaskService } = await import("@/core/followup/service");
    const { createOpportunityService } = await import("@/core/opportunity/service");
    const opportunityId = (await createOpportunityService(ctx(), {
      customerId,
      primaryContactId: contactId,
      name: "客户共享事实测试商机",
      stage: "DISCOVERY",
    })).opportunityId;

    await logActivityService(ctx(), { customerId, type: "CALL", outcome: "CONNECTED", summary: "客户确认需要继续评估但尚未约定下一步" });
    expect((await openInsights("opportunity", opportunityId)).map((row) => row.code)).toContain("NO_NEXT_STEP");

    await logActivityService(ctx(), {
      customerId,
      type: "CALL",
      outcome: "INTERESTED",
      summary: "客户确认继续推进并约定下一次方案沟通",
      nextFollowUpAt: new Date(Date.now() + 86_400_000),
    });
    expect((await openInsights("opportunity", opportunityId)).find((row) => row.code === "NO_NEXT_STEP")).toMatchObject({ status: "EXPIRED" });
    const task = await owner.query<{ id: string }>("select id from tasks where customer_id = $1 and status = 'OPEN'", [customerId]);
    await rescheduleTaskService(ctx(), task.rows[0].id, new Date(Date.now() - 3_600_000));
    expect((await openInsights("opportunity", opportunityId)).map((row) => row.code)).toContain("FOLLOWUP_OVERDUE");
    await logActivityService(ctx(), {
      opportunityId,
      type: "CALL",
      outcome: "CONNECTED",
      summary: "已在具体商机中完成本次客户跟进并重新约定时间",
      nextFollowUpAt: new Date(Date.now() + 172_800_000),
    });
    expect((await owner.query<{ status: string }>("select status from tasks where id = $1", [task.rows[0].id])).rows[0].status).toBe("DONE");
    expect((await openInsights("opportunity", opportunityId)).find((row) => row.code === "FOLLOWUP_OVERDUE")).toMatchObject({ status: "EXPIRED" });
  });

  it("规则 INSERT/UPDATE 被阻断时业务仍提交，旧建议保留或标记失败", async () => {
    const { logActivityService, rescheduleTaskService } = await import("@/core/followup/service");
    const { advanceStageService } = await import("@/core/opportunity/service");
    const leadId = await createLead();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await owner.query(`create function insight_trigger_block_rule_insert() returns trigger language plpgsql as $$
        begin if new.source_type = 'RULE' then raise exception 'test blocks rule insight insert'; end if; return new; end; $$`);
      await owner.query("create trigger insight_trigger_block_rule_insert before insert on sales_insights for each row execute function insight_trigger_block_rule_insert()");
      await logActivityService(ctx(), { leadId, type: "CALL", outcome: "CONNECTED", summary: "插入阻断仍应成功" });
      const activity = await owner.query("select 1 from activities where lead_id = $1", [leadId]);
      expect(activity.rows).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalled();
      await clearTriggers();

      await logActivityService(ctx(), { leadId, type: "CALL", outcome: "CONNECTED", summary: "先生成旧建议" });
      const before = (await openInsights("lead", leadId)).find((row) => row.code === "NO_NEXT_STEP");
      expect(before).toBeTruthy();
      const task = await owner.query<{ id: string }>(`insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
        values ($1, $2, $3, 'FOLLOW_UP', now() - interval '1 hour') returning id`, [tenantId, leadId, userId]);
      await owner.query(`create function insight_trigger_block_rule_update() returns trigger language plpgsql as $$
        begin if new.source_type = 'RULE' and (new.evidence is distinct from old.evidence or new.status is distinct from old.status) then raise exception 'test blocks rule insight update'; end if; return new; end; $$`);
      await owner.query("create trigger insight_trigger_block_rule_update before update on sales_insights for each row execute function insight_trigger_block_rule_update()");
      await rescheduleTaskService(ctx(), task.rows[0].id, new Date(Date.now() - 7200000));
      const taskAfter = await owner.query<{ due_at: string }>("select due_at::text from tasks where id = $1", [task.rows[0].id]);
      expect(new Date(taskAfter.rows[0].due_at).getTime()).toBeLessThan(Date.now());
      const after = (await openInsights("lead", leadId)).find((row) => row.id === before!.id);
      expect(after).toMatchObject({ status: "OPEN" });
      expect(after?.refresh_failed_at).not.toBeNull();
      await clearTriggers();

      const opportunityId = await createOpportunity();
      await owner.query("update opportunities set stage_entered_at = now() - interval '8 days' where id = $1", [opportunityId]);
      const { refreshInsightsService } = await import("@/core/insight/service");
      await refreshInsightsService(ctx(), { type: "opportunity", id: opportunityId });
      const opportunityBefore = (await openInsights("opportunity", opportunityId)).find((row) => row.code === "STAGE_STALLED");
      expect(opportunityBefore).toBeTruthy();
      await owner.query(`create function insight_trigger_block_rule_update() returns trigger language plpgsql as $$
        begin if new.source_type = 'RULE' and new.status is distinct from old.status then raise exception 'test blocks stage insight update'; end if; return new; end; $$`);
      await owner.query("create trigger insight_trigger_block_rule_update before update on sales_insights for each row execute function insight_trigger_block_rule_update()");
      await advanceStageService(ctx(), { opportunityId, fromStage: "DISCOVERY", toStage: "PROPOSAL", note: "阶段更新阻断清理后仍成功" });
      expect((await owner.query<{ stage: string }>("select stage from opportunities where id = $1", [opportunityId])).rows[0].stage).toBe("PROPOSAL");
      expect((await openInsights("opportunity", opportunityId)).find((row) => row.id === opportunityBefore!.id)).toMatchObject({ status: "OPEN" });
    } finally {
      errorSpy.mockRestore();
      await clearTriggers();
    }
  });

  it("非法业务操作不刷新洞察 updated_at", async () => {
    const opportunityId = await createOpportunity();
    const { advanceStageService } = await import("@/core/opportunity/service");
    const { logActivityService } = await import("@/core/followup/service");
    await logActivityService(ctx(), { opportunityId, type: "CALL", outcome: "CONNECTED", summary: "非法操作前的有效活动" });
    const before = (await openInsights("opportunity", opportunityId)).find((row) => row.code === "NO_NEXT_STEP");
    expect(before).toBeTruthy();
    await expect(advanceStageService(ctx(), { opportunityId, fromStage: "DISCOVERY", toStage: "NEGOTIATION", note: "非法跳级" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const after = (await openInsights("opportunity", opportunityId)).find((row) => row.id === before!.id);
    expect(after?.updated_at).toBe(before!.updated_at);
  });
});
