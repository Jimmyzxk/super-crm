import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("评分集成测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("评分集成测试不得使用开发数据库");
}
process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
let tenantId: string;
let userId: string;
let sourceKeyId: string;
let phoneSuffix = 0;
let closeDb: typeof import("@/db/client").closeDb;
const ctx = () => ({ tenantId, userId, role: "ADMIN" as const });

function phone() {
  phoneSuffix += 1;
  return `1388888${String(phoneSuffix).padStart(4, "0")}`;
}

async function leadScore(leadId: string) {
  const result = await owner.query<{ score: number | null; score_reason: string | null; scored_at: string | null }>(
    "select score, score_reason, scored_at::text from leads where id = $1", [leadId],
  );
  return result.rows[0];
}

async function insightRows(leadId: string) {
  const result = await owner.query<{ code: string; status: string }>(
    "select code, status from sales_insights where tenant_id = $1 and lead_id = $2 order by created_at", [tenantId, leadId],
  );
  return result.rows;
}

async function clearTestTriggers() {
  await owner.query("drop trigger if exists scoring_block_write on leads");
  await owner.query("drop function if exists scoring_block_write()");
  await owner.query("drop trigger if exists scoring_force_stalled_opportunity on opportunities");
  await owner.query("drop function if exists scoring_force_stalled_opportunity()");
}

beforeAll(async () => {
  await owner.connect();
  const tenant = await owner.query<{ id: string }>("insert into tenants (name) values ('评分纵向切片测试') returning id");
  tenantId = tenant.rows[0].id;
  const user = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
    values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', '评分管理员', 'ADMIN') returning id`,
  [tenantId, `scoring-${Date.now()}@example.com`]);
  userId = user.rows[0].id;
  const source = await owner.query<{ id: string }>(`insert into lead_source_keys
    (tenant_id, name, source_key, token_hash, created_by_user_id)
    values ($1, '评分 API', 'scoring-api', repeat('0', 64), $2) returning id`, [tenantId, userId]);
  sourceKeyId = source.rows[0].id;
  ({ closeDb } = await import("@/db/client"));
});

afterAll(async () => {
  await clearTestTriggers();
  await closeDb();
  await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
  await owner.query("delete from sales_insights where tenant_id = $1", [tenantId]);
  await owner.query("delete from notifications where tenant_id = $1", [tenantId]);
  await owner.query("delete from tasks where tenant_id = $1", [tenantId]);
  await owner.query("delete from activities where tenant_id = $1", [tenantId]);
  await owner.query("delete from opportunity_stage_history where tenant_id = $1", [tenantId]);
  await owner.query("delete from lead_conversions where tenant_id = $1", [tenantId]);
  await owner.query("delete from lead_conversion_backfill_issues where tenant_id = $1", [tenantId]);
  await owner.query("delete from opportunities where tenant_id = $1", [tenantId]);
  await owner.query("delete from contacts where tenant_id = $1", [tenantId]);
  await owner.query("update leads set customer_id = null where tenant_id = $1", [tenantId]);
  await owner.query("delete from customers where tenant_id = $1", [tenantId]);
  await owner.query("delete from lead_intake_requests where tenant_id = $1", [tenantId]);
  await owner.query("delete from lead_status_history where tenant_id = $1", [tenantId]);
  await owner.query("delete from leads where tenant_id = $1", [tenantId]);
  await owner.query("delete from lead_source_keys where tenant_id = $1", [tenantId]);
  await owner.query("delete from users where tenant_id = $1", [tenantId]);
  await owner.query("delete from tenants where id = $1", [tenantId]);
  await owner.end();
});

describe("统一进线、自动评分和首次质检", () => {
  it("新租户由触发器初始化默认 7 条规则", async () => {
    const rules = await owner.query<{ count: string }>("select count(*)::text from score_rules where tenant_id = $1", [tenantId]);
    expect(rules.rows[0].count).toBe("7");
    const security = await owner.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('score_rules', 'score_feedback') order by relname",
    );
    expect(security.rows).toEqual([
      { relname: "score_feedback", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "score_rules", relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const permissions = await owner.query<{ rules_select: boolean; feedback_select: boolean; auth_insert: boolean; scoring_insert: boolean }>(
      `select has_table_privilege('salescrm', 'score_rules', 'SELECT') rules_select,
        has_table_privilege('salescrm', 'score_feedback', 'SELECT') feedback_select,
        has_table_privilege('salescrm_auth', 'score_rules', 'INSERT') auth_insert,
        has_table_privilege('salescrm_scoring', 'score_rules', 'INSERT') scoring_insert`,
    );
    expect(permissions.rows[0]).toEqual({ rules_select: true, feedback_select: true, auth_insert: false, scoring_insert: true });
    const functionOwner = await owner.query<{ owner: string }>(`select owner.rolname as owner
      from pg_proc function join pg_roles owner on owner.oid = function.proowner
      where function.oid = 'public.initialize_tenant_score_rules()'::regprocedure`);
    expect(functionOwner.rows[0].owner).toBe("salescrm_scoring");
  });

  it("手工、API 和 CSV 入口都在提交后获得评分", async () => {
    const { createLeadService, createApiLeadService, importLeadsService } = await import("@/core/leads/service");
    const manual = await createLeadService(ctx(), { contactName: "手工线索", contactPhone: phone(), companyName: "手工公司" });
    if (!manual.created) throw new Error("手工线索未创建");
    const api = await createApiLeadService({ sourceKeyId, tenantId, sourceKey: "scoring-api", createdByUserId: userId, revokedAt: null, tenantStatus: "ACTIVE", actorRole: "ADMIN" }, "scoring-api-1", { contactName: "API 线索", contactPhone: phone() });
    const csvPhone = phone();
    const imported = await importLeadsService(ctx(), [{ contactName: "CSV 线索", contactPhone: csvPhone, title: "采购" }], false);
    expect(imported).toEqual({ created: 1, skipped: 0, failed: 0 });
    const csv = await owner.query<{ id: string }>("select id from leads where tenant_id = $1 and contact_phone = $2", [tenantId, csvPhone]);
    const scores = await Promise.all([leadScore(manual.leadId), leadScore(api.leadId!), leadScore(csv.rows[0].id)]);
    expect(scores.every((row) => row.score !== null && row.scored_at && row.score_reason)).toBe(true);
  });

  it("关键字段更新和线索跟进会重算，并保留可解释理由", async () => {
    const { createLeadService, updateLeadService } = await import("@/core/leads/service");
    const { logActivityService } = await import("@/core/followup/service");
    const created = await createLeadService(ctx(), { contactName: "重算线索", contactPhone: phone() });
    if (!created.created) throw new Error("线索未创建");
    expect((await leadScore(created.leadId)).score).toBe(0);
    await updateLeadService(ctx(), created.leadId, { companyName: "补充后的公司" });
    expect(await leadScore(created.leadId)).toMatchObject({ score: 20, score_reason: "填了公司名 +20" });
    await logActivityService(ctx(), { leadId: created.leadId, type: "CALL", outcome: "REFUSED", summary: "客户明确拒绝继续沟通" });
    expect(await leadScore(created.leadId)).toMatchObject({ score: 0, score_reason: "填了公司名 +20，已联系过 +10，明确拒绝 -40" });
  });

  it("评分写入失败不会阻断线索创建", async () => {
    const { createLeadService } = await import("@/core/leads/service");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await owner.query(`create function scoring_block_write() returns trigger language plpgsql as $$
        begin if new.score is not null then raise exception 'block score update'; end if; return new; end; $$`);
      await owner.query("create trigger scoring_block_write before update on leads for each row execute function scoring_block_write()");
      const created = await createLeadService(ctx(), { contactName: "评分失败仍创建", contactPhone: phone(), companyName: "不阻断公司" });
      if (!created.created) throw new Error("线索未创建");
      expect(await leadScore(created.leadId)).toMatchObject({ score: null, scored_at: null });
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      await clearTestTriggers();
    }
  });

  it("创建、分配、字段更新、确认需求和转客户都会刷新建议", async () => {
    const { createApiLeadService, assignLeadService, createLeadService, updateLeadService, qualifyLeadService } = await import("@/core/leads/service");
    const { logActivityService } = await import("@/core/followup/service");
    const { convertLeadToCustomerService } = await import("@/core/customer/service");
    const api = await createApiLeadService({ sourceKeyId, tenantId, sourceKey: "scoring-api", createdByUserId: userId, revokedAt: null, tenantStatus: "ACTIVE", actorRole: "ADMIN" }, "scoring-api-assign", { contactName: "待分配 API", contactPhone: phone() });
    await owner.query(`insert into sales_insights (tenant_id, lead_id, code, severity, title, summary, suggested_action, source_version)
      values ($1, $2, 'NO_NEXT_STEP', 'ATTENTION', '旧建议', '旧建议', '旧建议', 'rules-v1')`, [tenantId, api.leadId]);
    await assignLeadService(ctx(), api.leadId!, userId);
    expect((await insightRows(api.leadId!)).find((row) => row.code === "NO_NEXT_STEP")).toMatchObject({ status: "EXPIRED" });

    const created = await createLeadService(ctx(), { contactName: "建议触发线索", contactPhone: phone() });
    if (!created.created) throw new Error("线索未创建");
    await logActivityService(ctx(), { leadId: created.leadId, type: "CALL", outcome: "INTERESTED", summary: "客户确认预算和采购计划" });
    expect((await insightRows(created.leadId)).find((row) => row.code === "NO_NEXT_STEP")).toMatchObject({ status: "OPEN" });
    await owner.query(`insert into sales_insights (tenant_id, lead_id, code, severity, title, summary, suggested_action, source_version)
      values ($1, $2, 'FOLLOWUP_OVERDUE', 'HIGH_RISK', '旧超时建议', '旧超时建议', '旧超时建议', 'rules-v1')`, [tenantId, created.leadId]);
    await updateLeadService(ctx(), created.leadId, { title: "采购经理" });
    expect((await insightRows(created.leadId)).find((row) => row.code === "FOLLOWUP_OVERDUE")).toMatchObject({ status: "EXPIRED" });
    await qualifyLeadService(ctx(), created.leadId, "确认采购需求");

    await owner.query(`create function scoring_force_stalled_opportunity() returns trigger language plpgsql as $$
      begin new.stage_entered_at := now() - interval '8 days'; return new; end; $$`);
    await owner.query("create trigger scoring_force_stalled_opportunity before insert on opportunities for each row execute function scoring_force_stalled_opportunity()");
    const converted = await convertLeadToCustomerService(ctx(), {
      leadId: created.leadId, customerName: "转化客户", contactName: "建议触发线索", contactPhone: (await owner.query<{ contact_phone: string }>("select contact_phone from leads where id = $1", [created.leadId])).rows[0].contact_phone,
      opportunityName: "转化商机", expectedAmount: 100, expectedCloseAt: new Date(Date.now() + 86400000), demandNote: "确认需求",
    });
    await clearTestTriggers();
    expect((await insightRows(created.leadId)).filter((row) => row.status === "OPEN")).toHaveLength(0);
    const opportunityInsights = await owner.query<{ code: string }>("select code from sales_insights where tenant_id = $1 and opportunity_id = $2 and status = 'OPEN'", [tenantId, converted.opportunityId]);
    expect(opportunityInsights.rows.map((row) => row.code)).toContain("STAGE_STALLED");
  });

  it("评分反馈按用户覆盖保存，不改变分数且销售不能反馈他人的线索", async () => {
    const { createLeadService, assignLeadService } = await import("@/core/leads/service");
    const { getScoreFeedbackStatsService, submitScoreFeedbackService } = await import("@/core/scoring/service");
    const users = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
      values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', '反馈销售 A', 'SALES'),
        ($1, $3, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', '反馈销售 B', 'SALES') returning id`,
    [tenantId, `score-feedback-a-${Date.now()}@example.com`, `score-feedback-b-${Date.now()}@example.com`]);
    const [salesA, salesB] = users.rows.map((row) => row.id);
    const created = await createLeadService(ctx(), { contactName: "评分反馈线索", contactPhone: phone(), companyName: "反馈公司" });
    if (!created.created) throw new Error("线索未创建");
    await assignLeadService(ctx(), created.leadId, salesA);
    const before = await leadScore(created.leadId);
    const salesContext = { tenantId, userId: salesA, role: "SALES" as const };
    await submitScoreFeedbackService(salesContext, created.leadId, "ACCURATE");
    await submitScoreFeedbackService(salesContext, created.leadId, "INACCURATE");
    await expect(submitScoreFeedbackService({ tenantId, userId: salesB, role: "SALES" }, created.leadId, "ACCURATE"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    const stored = await owner.query<{ count: string; verdict: string; score_at_feedback: number }>(`select count(*)::text, max(verdict::text) as verdict, max(score_at_feedback) as score_at_feedback
      from score_feedback where tenant_id = $1 and lead_id = $2 and user_id = $3`, [tenantId, created.leadId, salesA]);
    expect(stored.rows[0]).toMatchObject({ count: "1", verdict: "INACCURATE", score_at_feedback: before.score });
    expect(await leadScore(created.leadId)).toMatchObject({ score: before.score, score_reason: before.score_reason });
    const stats = await getScoreFeedbackStatsService(ctx());
    expect(stats.inaccurate).toBeGreaterThanOrEqual(1);
    expect(stats.total).toBeGreaterThanOrEqual(1);
  });

  it("评分规则仅 ADMIN 可改，校验操作符并只影响后续评分", async () => {
    const { createLeadService } = await import("@/core/leads/service");
    const { createScoreRuleService, deleteScoreRuleService, listScoreRulesService, reorderScoreRulesService, updateScoreRuleService } = await import("@/core/scoring/service");
    const before = await createLeadService(ctx(), { contactName: "规则修改前", contactPhone: phone() });
    if (!before.created) throw new Error("线索未创建");
    const manager = { tenantId, userId, role: "MANAGER" as const };
    const input = { label: "手工来源", field: "source" as const, operator: "EQUALS" as const, value: "manual", weight: 7, enabled: true };
    await expect(createScoreRuleService(manager, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createScoreRuleService(ctx(), { ...input, operator: "GT", field: "company_name", value: "1" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", field: "operator" });
    const createdRule = await createScoreRuleService(ctx(), input);
    const unchanged = await leadScore(before.leadId);
    expect(unchanged.score).toBe(0);
    const after = await createLeadService(ctx(), { contactName: "规则修改后", contactPhone: phone() });
    if (!after.created) throw new Error("线索未创建");
    expect(await leadScore(after.leadId)).toMatchObject({ score: 7, score_reason: "手工来源 +7" });
    const updated = await updateScoreRuleService(ctx(), createdRule.id, { ...input, label: "手工录入来源", weight: 9 });
    expect(updated).toMatchObject({ label: "手工录入来源", weight: 9 });
    const all = await listScoreRulesService(ctx());
    const reordered = await reorderScoreRulesService(ctx(), [...all].reverse().map((rule) => rule.id));
    expect(reordered[0].id).toBe(all.at(-1)?.id);
    await deleteScoreRuleService(ctx(), createdRule.id);
    expect((await listScoreRulesService(ctx())).some((rule) => rule.id === createdRule.id)).toBe(false);
    const deleted = await owner.query<{ enabled: boolean; deleted_at: string | null }>("select enabled, deleted_at::text from score_rules where id = $1", [createdRule.id]);
    expect(deleted.rows[0]).toMatchObject({ enabled: false });
    expect(deleted.rows[0].deleted_at).not.toBeNull();
  });

  it("扩展字段真实参与评分：客户画像、未跟进天数、赢单与活跃商机数不再是恒空摆设", async () => {
    const { scoreLeadService } = await import("@/core/scoring/service");

    // 清掉租户默认规则，避免与扩展规则叠加干扰断言
    await owner.query("delete from score_rules where tenant_id = $1", [tenantId]);

    // 客户画像：制造业/华南/101-500，且名下 2 赢单 + 1 活跃商机
    const cust = await owner.query<{ id: string }>(
      `insert into customers (tenant_id, name, customer_type, owner_user_id, industry, region, size)
       values ($1, '扩展字段科技', 'ENTERPRISE', $2, '制造业', '华南', '101-500') returning id`,
      [tenantId, userId],
    );
    const customerId = cust.rows[0].id;
    await owner.query(
      `insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, actual_amount, actual_close_at)
       values ($1, $2, $3, '已赢单A', 'WON', 100000, now()), ($1, $2, $3, '已赢单B', 'WON', 200000, now()), ($1, $2, $3, '推进中C', 'PROPOSAL', null, null)`,
      [tenantId, customerId, userId],
    );

    // 线索 10 天前创建、9 天前有过一次跟进（days_since_activity = 9）
    const lead = await owner.query<{ id: string }>(
      `insert into leads (tenant_id, contact_name, contact_phone, customer_id, owner_user_id, source, created_at)
       values ($1, '扩展字段线索', $2, $3, $4, 'manual', now() - interval '10 days') returning id`,
      [tenantId, phone(), customerId, userId],
    );
    const leadId = lead.rows[0].id;
    await owner.query(
      `insert into activities (tenant_id, user_id, lead_id, type, outcome, summary, occurred_at)
       values ($1, $2, $3, 'CALL', 'CONNECTED', '九天前的沟通', now() - interval '9 days')`,
      [tenantId, userId, leadId],
    );

    await owner.query(
      `insert into score_rules (tenant_id, label, field, operator, value, weight, enabled, sort_order) values
       ($1, '制造业客户 +15', 'customer_industry', 'CONTAINS', '制造', 15, true, 10),
       ($1, '华南地区 +10', 'customer_region', 'EQUALS', '华南', 10, true, 20),
       ($1, '中等规模 +5', 'customer_size', 'EQUALS', '101-500', 5, true, 30),
       ($1, '沉睡超7天 +10', 'days_since_activity', 'GT', '7', 10, true, 40),
       ($1, '老客赢单≥2 +20', 'won_deal_count', 'GTE', '2', 20, true, 50),
       ($1, '有活跃商机 +5', 'active_deal_count', 'GTE', '1', 5, true, 60)`,
      [tenantId],
    );

    await scoreLeadService(ctx(), leadId);
    const after = await leadScore(leadId);
    // 15+10+5+10+20+5 = 65
    expect(after.score).toBe(65);
    expect(after.score_reason).toContain("制造业客户");
    expect(after.score_reason).toContain("沉睡超7天");
    expect(after.score_reason).toContain("老客赢单");

    // 反例：无客户画像、无商机的新线索，扩展规则一条都不应命中
    const plain = await owner.query<{ id: string }>(
      `insert into leads (tenant_id, contact_name, contact_phone, source) values ($1, '无画像线索', $2, 'manual') returning id`,
      [tenantId, phone()],
    );
    await scoreLeadService(ctx(), plain.rows[0].id);
    expect((await leadScore(plain.rows[0].id)).score).toBe(0);
  });
});
