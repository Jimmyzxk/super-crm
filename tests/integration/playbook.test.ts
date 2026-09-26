import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("团队打法集成测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("团队打法集成测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
const app = new pg.Client({ connectionString: appUrl });
let tenantA: string;
let tenantB: string;
let salesA: string;
let salesOtherA: string;
let managerA: string;
let salesB: string;
let counter = 0;

const salesContext = () => ({ tenantId: tenantA, userId: salesA, role: "SALES" as const });
const otherSalesContext = () => ({ tenantId: tenantA, userId: salesOtherA, role: "SALES" as const });
const managerContext = () => ({ tenantId: tenantA, userId: managerA, role: "MANAGER" as const });

async function addUser(tenantId: string, role: "SALES" | "MANAGER", label: string) {
  const result = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
    values ($1, $2, '$2a$12$C6UzMD.MH6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', $3, $4) returning id`,
  [tenantId, `playbook-${label}-${Date.now()}@example.com`, label, role]);
  return result.rows[0].id;
}

async function createOpportunity(tenantId: string, ownerId: string, stage: "DISCOVERY" | "PROPOSAL" | "WON" = "WON", profile: { industry?: string; region?: string; size?: string } = {}) {
  counter += 1;
  const customer = await owner.query<{ id: string }>(`insert into customers (tenant_id, owner_user_id, name, industry, region, size)
    values ($1, $2, $3, $4, $5, $6::customer_size) returning id`,
  [tenantId, ownerId, `打法客户-${counter}`, profile.industry ?? null, profile.region ?? null, profile.size ?? null]);
  const opportunity = await owner.query<{ id: string }>(`insert into opportunities
    (tenant_id, customer_id, owner_user_id, name, stage, actual_amount, actual_close_at)
    values ($1, $2, $3, $4, $5::opportunity_stage, case when $5 = 'WON' then 10000 else null end,
      case when $5 = 'WON' then current_date else null end) returning id`,
  [tenantId, customer.rows[0].id, ownerId, `打法商机-${counter}`, stage]);
  return { opportunityId: opportunity.rows[0].id, customerId: customer.rows[0].id };
}

async function createReviewedSample(tenantId: string, ownerId: string, reviewerId: string) {
  const opportunity = await createOpportunity(tenantId, ownerId, "WON");
  const result = await owner.query<{ id: string }>(`insert into win_reviews
    (tenant_id, opportunity_id, status, summary, metrics, evidence, reviewed_by_user_id, review_reason, reviewed_at)
    values ($1, $2, 'REVIEWED', '已确认的事实复盘', '{}'::jsonb, '[{"kind":"FACT"}]'::jsonb, $3, '证据完整', now()) returning id`,
  [tenantId, opportunity.opportunityId, reviewerId]);
  return { ...opportunity, reviewId: result.rows[0].id };
}

function draftInput(sampleIds: string[], familyKey: string) {
  return {
    familyKey,
    name: `打法 ${familyKey}`,
    targetStage: "DISCOVERY" as const,
    applicableIndustries: ["制造"],
    excludedIndustries: [],
    applicableRegions: ["华东"],
    excludedRegions: [],
    applicableCustomerSizes: ["101-500" as const],
    excludedCustomerSizes: [],
    checkpoints: ["确认预算与决策链"],
    recommendedCadence: ["每 3 天一次有效推进"],
    effectiveActions: ["在方案评审前确认下一步日期"],
    commonRisks: ["没有明确下一步时间"],
    claimEvidence: {
      checkpoints: [sampleIds[0]],
      recommendedCadence: [sampleIds[0]],
      effectiveActions: [sampleIds[0]],
      commonRisks: [sampleIds[0]],
    },
    sampleIds,
  };
}

let playbookService: typeof import("@/core/playbook/service");

beforeAll(async () => {
  await owner.connect();
  await app.connect();
  const tenants = await owner.query<{ id: string }>("insert into tenants (name) values ('打法 A'), ('打法 B') returning id");
  tenantA = tenants.rows[0].id;
  tenantB = tenants.rows[1].id;
  salesA = await addUser(tenantA, "SALES", "sales-a");
  salesOtherA = await addUser(tenantA, "SALES", "sales-other-a");
  managerA = await addUser(tenantA, "MANAGER", "manager-a");
  salesB = await addUser(tenantB, "SALES", "sales-b");
  playbookService = await import("@/core/playbook/service");
});

afterAll(async () => {
  const { closeDb } = await import("@/db/client");
  await closeDb();
  await owner.query("delete from audit_logs where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from sales_playbook_feedback where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("alter table sales_playbook_samples disable trigger sales_playbook_samples_terminal_immutable");
  try {
    await owner.query("delete from sales_playbook_samples where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  } finally {
    await owner.query("alter table sales_playbook_samples enable trigger sales_playbook_samples_terminal_immutable");
  }
  await owner.query("delete from sales_playbooks where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from win_reviews where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from opportunities where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from customers where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from users where tenant_id = any($1::uuid[])", [[tenantA, tenantB]]);
  await owner.query("delete from tenants where id = any($1::uuid[])", [[tenantA, tenantB]]);
  await app.end();
  await owner.end();
});

describe("团队打法核心层", () => {
  it("少于 3 个样本、未确认样本和跨租户样本不能发布", async () => {
    const first = await createReviewedSample(tenantA, salesA, managerA);
    const second = await createReviewedSample(tenantA, salesA, managerA);
    const tooFew = await playbookService.createSalesPlaybookDraftService(managerContext(), draftInput([first.reviewId, second.reviewId], "too-few"));
    await expect(playbookService.publishSalesPlaybookService(managerContext(), { playbookId: tooFew.id, reason: "样本不足不应发布" })).rejects.toMatchObject({ code: "CONFLICT" });

    const pending = await createOpportunity(tenantA, salesA, "WON");
    const pendingReview = await owner.query<{ id: string }>(`insert into win_reviews (tenant_id, opportunity_id) values ($1, $2) returning id`, [tenantA, pending.opportunityId]);
    const unreviewed = await playbookService.createSalesPlaybookDraftService(managerContext(), draftInput([first.reviewId, second.reviewId, pendingReview.rows[0].id], "pending-sample"));
    await expect(playbookService.publishSalesPlaybookService(managerContext(), { playbookId: unreviewed.id, reason: "未确认样本不应发布" })).rejects.toMatchObject({ code: "CONFLICT" });

    const foreign = await createReviewedSample(tenantB, salesB, salesB);
    await expect(playbookService.createSalesPlaybookDraftService(managerContext(), draftInput([first.reviewId, second.reviewId, foreign.reviewId], "foreign-sample"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("成功发布后生成不可原地覆盖的版本", async () => {
    const samples = await Promise.all([
      createReviewedSample(tenantA, salesA, managerA),
      createReviewedSample(tenantA, salesA, managerA),
      createReviewedSample(tenantA, salesA, managerA),
    ]);
    const input = draftInput(samples.map((sample) => sample.reviewId), "versioned-playbook");
    const draft = await playbookService.createSalesPlaybookDraftService(managerContext(), input);
    expect(draft).toMatchObject({ status: "DRAFT", version: 1, sampleIds: input.sampleIds });
    const published = await playbookService.publishSalesPlaybookService(managerContext(), { playbookId: draft.id, reason: "三条已确认样本，证据链完整" });
    expect(published).toMatchObject({ status: "PUBLISHED", version: 1, publishReason: "三条已确认样本，证据链完整" });
    await expect(playbookService.publishSalesPlaybookService(managerContext(), { playbookId: draft.id, reason: "不能覆盖" })).rejects.toMatchObject({ code: "CONFLICT" });
    const next = await playbookService.createSalesPlaybookDraftService(managerContext(), input);
    expect(next.version).toBe(2);
  });

  it("销售只能读取已发布打法，推荐最多一条并排除不适用客户", async () => {
    const samples = await Promise.all([
      createReviewedSample(tenantA, salesA, managerA),
      createReviewedSample(tenantA, salesA, managerA),
      createReviewedSample(tenantA, salesA, managerA),
    ]);
    const excludedInput = draftInput(samples.map((sample) => sample.reviewId), "excluded-playbook");
    const excluded = await playbookService.createSalesPlaybookDraftService(managerContext(), { ...excludedInput, targetStage: "PROPOSAL", excludedIndustries: ["制造"] });
    await playbookService.publishSalesPlaybookService(managerContext(), { playbookId: excluded.id, reason: "排除条件测试" });
    const generalInput = draftInput(samples.map((sample) => sample.reviewId), "general-playbook");
    const general = await playbookService.createSalesPlaybookDraftService(managerContext(), { ...generalInput, targetStage: "PROPOSAL", applicableIndustries: [], applicableRegions: [], applicableCustomerSizes: [] });
    await playbookService.publishSalesPlaybookService(managerContext(), { playbookId: general.id, reason: "通用打法测试" });
    const opportunity = await createOpportunity(tenantA, salesA, "PROPOSAL", { industry: "制造", region: "华东", size: "101-500" });
    const recommendation = await playbookService.getRecommendedPlaybookService(salesContext(), opportunity.opportunityId);
    expect(recommendation?.playbook.id).toBe(general.id);
    expect(recommendation?.playbook.id).not.toBe(excluded.id);
    expect((await playbookService.listSalesPlaybooksService(salesContext())).every((item) => item.status === "PUBLISHED")).toBe(true);
    expect(await playbookService.getRecommendedPlaybookService(salesContext(), (await createOpportunity(tenantA, salesA, "WON")).opportunityId)).toBeNull();
    const mismatch = await createOpportunity(tenantA, salesA, "DISCOVERY", { industry: "零售", region: "华南", size: "1-20" });
    expect(await playbookService.getRecommendedPlaybookService(salesContext(), mismatch.opportunityId)).toBeNull();
  });

  it("反馈校验可见商机和已发布打法，并按用户 upsert", async () => {
    const samples = await Promise.all([
      createReviewedSample(tenantA, salesA, managerA),
      createReviewedSample(tenantA, salesA, managerA),
      createReviewedSample(tenantA, salesA, managerA),
    ]);
    const draft = await playbookService.createSalesPlaybookDraftService(managerContext(), draftInput(samples.map((sample) => sample.reviewId), "feedback-playbook"));
    const published = await playbookService.publishSalesPlaybookService(managerContext(), { playbookId: draft.id, reason: "反馈测试" });
    const opportunity = await createOpportunity(tenantA, salesA, "DISCOVERY", { industry: "制造", region: "华东", size: "101-500" });
    await expect(playbookService.submitPlaybookFeedbackService(salesContext(), { opportunityId: opportunity.opportunityId, playbookId: published.id, verdict: "NOT_HELPFUL" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const firstFeedback = await playbookService.submitPlaybookFeedbackService(salesContext(), { opportunityId: opportunity.opportunityId, playbookId: published.id, verdict: "HELPFUL" });
    const afterFirstFeedback = await playbookService.getRecommendedPlaybookService(salesContext(), opportunity.opportunityId);
    expect(afterFirstFeedback?.currentUserFeedback).toMatchObject({ verdict: "HELPFUL", reason: null, updatedAt: firstFeedback.updatedAt });
    expect((await playbookService.getRecommendedPlaybookService(managerContext(), opportunity.opportunityId))?.currentUserFeedback).toBeNull();
    await playbookService.submitPlaybookFeedbackService(salesContext(), { opportunityId: opportunity.opportunityId, playbookId: published.id, verdict: "NOT_HELPFUL", reason: "当前阶段不适用" });
    const feedback = await owner.query<{ count: string; verdict: string; reason: string }>(`select count(*)::text, max(verdict)::text as verdict, max(reason) as reason
      from sales_playbook_feedback where tenant_id = $1 and opportunity_id = $2 and playbook_id = $3`, [tenantA, opportunity.opportunityId, published.id]);
    expect(feedback.rows[0]).toMatchObject({ count: "1", verdict: "NOT_HELPFUL", reason: "当前阶段不适用" });
    expect((await playbookService.getRecommendedPlaybookService(salesContext(), opportunity.opportunityId))?.currentUserFeedback).toMatchObject({ verdict: "NOT_HELPFUL", reason: "当前阶段不适用" });
    await expect(playbookService.submitPlaybookFeedbackService(otherSalesContext(), { opportunityId: opportunity.opportunityId, playbookId: published.id, verdict: "HELPFUL" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("无租户上下文和跨租户读取为空，应用角色不能篡改发布终态", async () => {
    const samples = await Promise.all([
      createReviewedSample(tenantA, salesA, managerA),
      createReviewedSample(tenantA, salesA, managerA),
      createReviewedSample(tenantA, salesA, managerA),
    ]);
    const draft = await playbookService.createSalesPlaybookDraftService(managerContext(), draftInput(samples.map((sample) => sample.reviewId), "rls-playbook"));
    const published = await playbookService.publishSalesPlaybookService(managerContext(), { playbookId: draft.id, reason: "隔离测试" });
    expect((await app.query("select id from sales_playbooks where tenant_id = $1", [tenantA])).rows).toHaveLength(0);
    await app.query("begin");
    await app.query("select set_config('app.tenant_id', $1, true)", [tenantB]);
    expect((await app.query("select id from sales_playbooks where tenant_id = $1", [tenantA])).rows).toHaveLength(0);
    await app.query("rollback");
    await app.query("begin");
    await app.query("select set_config('app.tenant_id', $1, true)", [tenantA]);
    await expect(app.query("update sales_playbooks set status = 'RETIRED' where id = $1", [published.id])).rejects.toBeTruthy();
    await app.query("rollback");
    const extra = await createReviewedSample(tenantA, salesA, managerA);
    await app.query("begin");
    try {
      await app.query("select set_config('app.tenant_id', $1, true)", [tenantA]);
      await expect(app.query("insert into sales_playbook_samples (tenant_id, playbook_id, win_review_id) values ($1, $2, $3)", [tenantA, published.id, extra.reviewId])).rejects.toMatchObject({ code: "40001" });
    } finally {
      await app.query("rollback");
    }
  });
});
