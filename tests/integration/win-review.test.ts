import "dotenv/config";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("赢单复盘集成测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
let tenantA: string;
let tenantB: string;
let salesA: string;
let salesOtherA: string;
let managerA: string;
let salesB: string;
let counter = 0;

const salesContext = () => ({ tenantId: tenantA, userId: salesA, role: "SALES" as const });
const managerContext = () => ({ tenantId: tenantA, userId: managerA, role: "MANAGER" as const });

async function addUser(tenantId: string, role: "SALES" | "MANAGER", label: string) {
  const row = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
    values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8V1K', $3, $4) returning id`,
  [tenantId, `win-review-${label}-${Date.now()}@example.com`, label, role]);
  return row.rows[0].id;
}

async function createWonOpportunity(ownerId = salesA) {
  counter += 1;
  const customer = await owner.query<{ id: string }>(`insert into customers (tenant_id, owner_user_id, name)
    values ($1, $2, $3) returning id`, [tenantA, ownerId, `复盘客户-${counter}`]);
  const contact = await owner.query<{ id: string }>(`insert into contacts (tenant_id, customer_id, name, phone, is_primary)
    values ($1, $2, '复盘联系人', $3, true) returning id`, [tenantA, customer.rows[0].id, `139700${String(counter).padStart(5, "0")}`]);
  const opportunity = await owner.query<{ id: string }>(`insert into opportunities
    (tenant_id, customer_id, owner_user_id, primary_contact_id, name, stage, created_at, stage_entered_at)
    values ($1, $2, $3, $4, $5, 'NEGOTIATION', now() - interval '10 days', now() - interval '3 days') returning id`,
  [tenantA, customer.rows[0].id, ownerId, contact.rows[0].id, `复盘商机-${counter}`]);
  await owner.query(`insert into opportunity_stage_history (tenant_id, opportunity_id, from_stage, to_stage, operator_user_id, created_at)
    values ($1, $2, null, 'DISCOVERY', $3, now() - interval '10 days'),
      ($1, $2, 'DISCOVERY', 'PROPOSAL', $3, now() - interval '7 days'),
      ($1, $2, 'PROPOSAL', 'NEGOTIATION', $3, now() - interval '3 days')`, [tenantA, opportunity.rows[0].id, ownerId]);
  return { opportunityId: opportunity.rows[0].id, customerId: customer.rows[0].id };
}

async function win(opportunityId: string, context = salesContext()) {
  const { winOpportunityService } = await import("@/core/opportunity/service");
  await winOpportunityService(context, { opportunityId, actualAmount: 32100, actualCloseAt: new Date() });
}

async function reviewRow(opportunityId: string) {
  const result = await owner.query<{ id: string; status: string; summary: string; metrics: Record<string, unknown>; evidence: Array<Record<string, unknown>>; data_gaps: string[]; generation_failed_at: string | null }>(`select id, status, summary, metrics, evidence, data_gaps, generation_failed_at::text
    from win_reviews where tenant_id = $1 and opportunity_id = $2`, [tenantA, opportunityId]);
  return result.rows[0];
}

beforeAll(async () => {
  await owner.connect();
  const tenants = await owner.query<{ id: string }>("insert into tenants (name) values ('复盘 A'), ('复盘 B') returning id");
  tenantA = tenants.rows[0].id;
  tenantB = tenants.rows[1].id;
  salesA = await addUser(tenantA, "SALES", "sales-a");
  salesOtherA = await addUser(tenantA, "SALES", "sales-other-a");
  managerA = await addUser(tenantA, "MANAGER", "manager-a");
  salesB = await addUser(tenantB, "SALES", "sales-b");
});

afterAll(async () => {
  const { closeDb } = await import("@/db/client");
  await closeDb();
  await owner.query("delete from audit_logs where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from win_reviews where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from tasks where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from activities where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from opportunity_stage_history where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from opportunities where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from contacts where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from customers where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from notifications where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from users where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from tenants where id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.end();
});

describe("赢单复盘", () => {
  it("赢单后自动生成单商机事实复盘，不计入仅关联客户的活动", async () => {
    const created = await createWonOpportunity();
    await owner.query(`insert into activities (tenant_id, opportunity_id, user_id, type, outcome, summary, occurred_at)
      values ($1, $2, $3, 'CALL', 'CONNECTED', '确认需求', now() - interval '9 days'),
        ($1, $2, $3, 'MESSAGE', 'INTERESTED', '确认演示', now() - interval '5 days'),
        ($1, $2, $3, 'NOTE', null, '内部备注', now() - interval '4 days')`, [tenantA, created.opportunityId, salesA]);
    await owner.query(`insert into activities (tenant_id, customer_id, user_id, type, outcome, summary, occurred_at)
      values ($1, $2, $3, 'CALL', 'CONNECTED', '只关联客户，不可归入商机', now() - interval '2 days')`, [tenantA, created.customerId, salesA]);
    await win(created.opportunityId);
    const review = await reviewRow(created.opportunityId);
    expect(review.status).toBe("DRAFT");
    expect(review.metrics).toMatchObject({ effectiveFollowUpCount: 2, actualAmount: "32100" });
    expect(review.metrics.createdToWonHours).toBeGreaterThan(0);
    expect(review.evidence.some((fact) => fact.summary === "只关联客户，不可归入商机")).toBe(false);
    expect(review.evidence.some((fact) => fact.kind === "STAGE")).toBe(true);
  });

  it("重复生成保持一份复盘且不会覆盖已审核终态", async () => {
    const created = await createWonOpportunity();
    await win(created.opportunityId);
    const { generateWinReviewSafely, reviewWinReviewService } = await import("@/core/win-review/service");
    const draft = await reviewRow(created.opportunityId);
    await generateWinReviewSafely(salesContext(), created.opportunityId);
    expect((await owner.query("select id from win_reviews where tenant_id = $1 and opportunity_id = $2", [tenantA, created.opportunityId])).rows).toHaveLength(1);
    await reviewWinReviewService(managerContext(), { winReviewId: draft.id, status: "REVIEWED", reason: "事实完整，可作为赢单样本" });
    const reviewed = await reviewRow(created.opportunityId);
    await generateWinReviewSafely(salesContext(), created.opportunityId);
    expect(await reviewRow(created.opportunityId)).toMatchObject({ status: "REVIEWED", summary: reviewed.summary });
  });

  it("少事实时明确写入数据缺口", async () => {
    const created = await createWonOpportunity();
    await win(created.opportunityId);
    const review = await reviewRow(created.opportunityId);
    expect(review.data_gaps.join(" ")).toContain("未记录可作为有效响应");
  });

  it("阶段历史超过窗口时保留最接近赢单的事实", async () => {
    const created = await createWonOpportunity();
    await owner.query(`insert into opportunity_stage_history
      (tenant_id, opportunity_id, from_stage, to_stage, note, operator_user_id, created_at)
      select $1, $2, 'PROPOSAL', 'NEGOTIATION', 'window-' || g, $3,
        now() - ((52 - g) * interval '1 minute')
      from generate_series(1, 51) g`, [tenantA, created.opportunityId, salesA]);
    await win(created.opportunityId);
    const review = await reviewRow(created.opportunityId);
    const stageNotes = review.evidence.filter((fact) => fact.kind === "STAGE").map((fact) => fact.note);
    expect(stageNotes).toContain("window-51");
    expect(stageNotes).not.toContain("window-1");
    expect(review.data_gaps.join(" ")).toContain("阶段记录超过 50 条");
  });

  it("生成更新失败不会回滚赢单，并保留可诊断失败记录", async () => {
    const created = await createWonOpportunity();
    await owner.query(`create function block_win_review_generation() returns trigger language plpgsql as $$
      begin if new.metrics <> old.metrics then raise exception 'block review hydration'; end if; return new; end; $$`);
    await owner.query("create trigger block_win_review_generation before update on win_reviews for each row execute function block_win_review_generation()");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await win(created.opportunityId);
      expect((await owner.query<{ stage: string }>("select stage from opportunities where id = $1", [created.opportunityId])).rows[0].stage).toBe("WON");
      expect((await owner.query("select id from audit_logs where tenant_id = $1 and action = 'win_review.generate_failed' and subject_id = $2", [tenantA, created.opportunityId])).rows).toHaveLength(1);
      const failedReview = await reviewRow(created.opportunityId);
      expect(failedReview.generation_failed_at).not.toBeNull();
      const { getWinReviewService, reviewWinReviewService } = await import("@/core/win-review/service");
      await expect(reviewWinReviewService(managerContext(), { winReviewId: failedReview.id, status: "REVIEWED", reason: "空草稿不可确认" })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(owner.query(`update win_reviews set status = 'REVIEWED', reviewed_by_user_id = $1,
        review_reason = '绕过服务审核', reviewed_at = now() where id = $2`, [managerA, failedReview.id])).rejects.toThrow();
      const attemptsBeforeRead = (await owner.query<{ generation_attempts: number }>("select generation_attempts from win_reviews where id = $1", [failedReview.id])).rows[0].generation_attempts;
      await getWinReviewService(salesContext(), created.opportunityId);
      expect((await owner.query<{ generation_attempts: number }>("select generation_attempts from win_reviews where id = $1", [failedReview.id])).rows[0].generation_attempts).toBe(attemptsBeforeRead);
    } finally {
      await owner.query("drop trigger if exists block_win_review_generation on win_reviews");
      await owner.query("drop function if exists block_win_review_generation()");
      errorSpy.mockRestore();
    }
    await owner.query("update win_reviews set generation_failed_at = now() - interval '6 minutes' where opportunity_id = $1", [created.opportunityId]);
    const { getWinReviewService } = await import("@/core/win-review/service");
    const retried = await getWinReviewService(salesContext(), created.opportunityId);
    expect(retried).toMatchObject({ status: "DRAFT", generationFailedAt: null });
    expect(retried?.summary).toContain("以上仅陈述已记录事实");
  });

  it("销售不能读取他人复盘，RLS 隔离跨租户记录", async () => {
    const created = await createWonOpportunity();
    await win(created.opportunityId);
    const { getWinReviewService } = await import("@/core/win-review/service");
    await expect(getWinReviewService({ tenantId: tenantA, userId: salesOtherA, role: "SALES" }, created.opportunityId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { withTenant } = await import("@/core/tenant");
    const hidden = await withTenant(tenantB, (tx) => tx.execute(sql`select id from win_reviews where opportunity_id = ${created.opportunityId}`));
    expect(hidden.rows).toHaveLength(0);
    const { pool } = await import("@/db/client");
    expect((await pool.query("select id from win_reviews where opportunity_id = $1", [created.opportunityId])).rows).toHaveLength(0);
    expect(salesB).toBeTruthy();
  });

  it("仅主管可审核，理由必填，终态审核冲突", async () => {
    const created = await createWonOpportunity();
    await win(created.opportunityId);
    const review = await reviewRow(created.opportunityId);
    const { reviewWinReviewService } = await import("@/core/win-review/service");
    await expect(reviewWinReviewService(salesContext(), { winReviewId: review.id, status: "REVIEWED", reason: "越权" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reviewWinReviewService(managerContext(), { winReviewId: review.id, status: "REJECTED", reason: "  " })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await reviewWinReviewService(managerContext(), { winReviewId: review.id, status: "REJECTED", reason: "证据不足，需要补充事实" });
    await expect(reviewWinReviewService(managerContext(), { winReviewId: review.id, status: "REVIEWED", reason: "不可覆盖" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(owner.query("update win_reviews set summary = '篡改终态' where id = $1", [review.id])).rejects.toThrow();
  });

  it("当客户名下已有 OPEN 待办时，赢单不撞 tasks_open_customer_unique 唯一索引，复用并更新待办", async () => {
    const created = await createWonOpportunity();
    // 预先为该客户插入一条 OPEN 状态的跟进待办
    const taskRes = await owner.query<{ id: string }>(
      `insert into tasks (tenant_id, customer_id, assignee_user_id, type, due_at, status)
       values ($1, $2, $3, 'FOLLOW_UP', now() + interval '1 day', 'OPEN') returning id`,
      [tenantA, created.customerId, salesA],
    );
    const existingTaskId = taskRes.rows[0].id;

    // 执行赢单，不应报 duplicate key violation 错误
    await expect(win(created.opportunityId)).resolves.not.toThrow();

    // 验证原待办被复用更新为 STAGE_PUSH 待办，且客户名下仍仅有这 1 条 OPEN 待办
    const tasks = await owner.query<{ id: string; type: string; status: string; assignee_user_id: string }>(
      "select id, type, status, assignee_user_id from tasks where tenant_id = $1 and customer_id = $2 and status = 'OPEN'",
      [tenantA, created.customerId],
    );
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0].id).toBe(existingTaskId);
    expect(tasks.rows[0].type).toBe("STAGE_PUSH");
    expect(tasks.rows[0].assignee_user_id).toBe(salesA);
  });
});
