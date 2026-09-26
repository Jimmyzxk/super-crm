import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

let aiCopilotService: typeof import("@/core/ai-copilot/service");
let securityService: typeof import("@/core/security/service");
let maskingUtil: typeof import("@/core/security/masking");
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let adminId: string;
let salesId: string;
let customerId: string;
let contactId: string;
let opportunityId: string;
let leadId: string;
let adminCtx: TenantContext;
let salesCtx: TenantContext;

describe("销冠 AI 决策推荐引擎与三级等保数据安全合规 (AI Copilot & Level 3 Security Compliance)", { timeout: 25000 }, () => {
  beforeAll(async () => {
    await owner.connect();
    aiCopilotService = await import("@/core/ai-copilot/service");
    securityService = await import("@/core/security/service");
    maskingUtil = await import("@/core/security/masking");
    closeDb = (await import("@/db/client")).closeDb;

    const tRes = await owner.query<{ id: string }>(
      "insert into tenants (name) values ('AI赋能与等保安全测试租户') returning id",
    );
    tenantId = tRes.rows[0].id;

    const ts = Date.now();
    const [aRes, sRes] = await Promise.all([
      owner.query<{ id: string }>(
        "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '安全管理员', 'ADMIN') returning id",
        [tenantId, `admin-sec-${ts}@example.com`],
      ),
      owner.query<{ id: string }>(
        "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '金牌销冠小赵', 'SALES') returning id",
        [tenantId, `sales-copilot-${ts}@example.com`],
      ),
    ]);

    adminId = aRes.rows[0].id;
    salesId = sRes.rows[0].id;
    adminCtx = { tenantId, userId: adminId, role: "ADMIN" };
    salesCtx = { tenantId, userId: salesId, role: "SALES" };

    // 建立客户、商机与线索基础数据
    const cRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, customer_type, owner_user_id) values ($1, '未来科技集团', 'ENTERPRISE', $2) returning id",
      [tenantId, salesId],
    );
    customerId = cRes.rows[0].id;

    // 增加联系人并标记关键决策人 EB
    const ctRes = await owner.query<{ id: string }>(
      "insert into contacts (tenant_id, customer_id, name, phone, email, is_primary, role_tag) values ($1, $2, '张总监', '13912345678', 'zhang@futuretech.com', true, 'DECISION_MAKER') returning id",
      [tenantId, customerId],
    );
    contactId = ctRes.rows[0].id;

    const oRes = await owner.query<{ id: string }>(
      "insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount) values ($1, $2, $3, '全栈智能化升级项目', 'PROPOSAL', 5000000) returning id",
      [tenantId, customerId, salesId],
    );
    opportunityId = oRes.rows[0].id;

    const lRes = await owner.query<{ id: string }>(
      "insert into leads (tenant_id, contact_name, contact_phone, company_name, source, owner_user_id) values ($1, '刘经理', '13611223344', '创智云联', 'manual', $2) returning id",
      [tenantId, salesId],
    );
    leadId = lRes.rows[0].id;
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from notifications where tenant_id = $1", [tenantId]);
      await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
      await owner.query("delete from ai_recommendations where tenant_id = $1", [tenantId]);
      await owner.query("delete from security_compliance_configs where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunity_line_items where tenant_id = $1", [tenantId]);
      await owner.query("delete from deal_interventions where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunities where tenant_id = $1", [tenantId]);
      await owner.query("delete from contacts where tenant_id = $1", [tenantId]);
      await owner.query("delete from customers where tenant_id = $1", [tenantId]);
      await owner.query("delete from leads where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await closeDb();
    await owner.end();
  });

  it("1. 三级等保数据脱敏工具与安全合规规则管理", async () => {
    // 1) 掩码工具函数单测
    expect(maskingUtil.maskPhone("13812345678")).toBe("138****5678");
    expect(maskingUtil.maskEmail("zhangsan@futuretech.com")).toBe("zh***n@futuretech.com");

    // 2) 非管理员无权修改等保合规配置
    await expect(
      securityService.upsertSecurityComplianceConfigService(salesCtx, {
        isPhoneMaskingEnabled: false,
      }),
    ).rejects.toThrow("权限不足");

    // 3. 管理员配置安全规则与功能开关并记录审计日志
    const cfg = await securityService.upsertSecurityComplianceConfigService(adminCtx, {
      isAiCopilotEnabled: true,
      isPhoneMaskingEnabled: true,
      isEmailMaskingEnabled: true,
      sessionTimeoutMinutes: 60,
    });
    expect(cfg.isAiCopilotEnabled).toBe(true);
    expect(cfg.isPhoneMaskingEnabled).toBe(true);
    expect(cfg.sessionTimeoutMinutes).toBe(60);

    // 4) 销售查看潜客、联系人与企业主联系人明文手机号，触发强制安全解密审计留痕
    const unmaskLead = await securityService.logSensitiveDataUnmaskService(salesCtx, "LEAD", leadId, "PHONE");
    expect(unmaskLead.success).toBe(true);
    expect(unmaskLead.unmaskedValue).toBe("13611223344");

    const unmaskContact = await securityService.logSensitiveDataUnmaskService(salesCtx, "CONTACT", contactId, "PHONE");
    expect(unmaskContact.success).toBe(true);
    expect(unmaskContact.unmaskedValue).toBe("13912345678");

    const unmaskCustomer = await securityService.logSensitiveDataUnmaskService(salesCtx, "CUSTOMER", customerId, "PHONE");
    expect(unmaskCustomer.success).toBe(true);
    expect(unmaskCustomer.unmaskedValue).toBe("13912345678");

    const auditCheck = await owner.query<{ action: string; actor_user_id: string }>(
      "select action, actor_user_id from audit_logs where tenant_id = $1 and action = 'security.unmask_view'",
      [tenantId],
    );
    expect(auditCheck.rows.length).toBeGreaterThanOrEqual(3);
    expect(auditCheck.rows[0].actor_user_id).toBe(salesId);
  });

  it("2. 销冠 AI 商机深度诊断与赢单预测引擎 (MEDDICC & NBA)", async () => {
    // 执行商机 AI 深度诊断
    const diag = await aiCopilotService.analyzeOpportunityDiagnosticService(salesCtx, opportunityId);

    expect(diag.opportunityId).toBe(opportunityId);
    expect(diag.winProbabilityPercent).toBeGreaterThan(0);
    expect(diag.winProbabilityPercent).toBeLessThanOrEqual(100);
    expect(["STRONG", "HEALTHY", "AT_RISK", "CRITICAL"]).toContain(diag.dealHealth);

    // 正面特征识别 (决策人 EB 已标记)
    expect(diag.positiveFactors.some((p) => p.includes("决策人"))).toBe(true);

    // 下一步最佳推进动作 (NBA)
    expect(diag.nextBestAction.title).toBeTruthy();
    expect(diag.nextBestAction.suggestedScript).toBeTruthy();

    // 验证已存入 ai_recommendations 表
    const recCheck = await owner.query<{ recommendation_type: string }>(
      "select recommendation_type from ai_recommendations where tenant_id = $1 and opportunity_id = $2 and recommendation_type = 'HEALTH_DIAGNOSTIC'",
      [tenantId, opportunityId],
    );
    expect(recCheck.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("3. 销冠实战对抗异议拆解生成器 (Objection Killer AI)", async () => {
    const script = await aiCopilotService.generateObjectionKillerService(salesCtx, {
      objectionType: "PRICE_TOO_HIGH",
      competitorName: "某友网络",
      targetName: "未来科技李总",
    });

    expect(script.objectionType).toBe("PRICE_TOO_HIGH");
    expect(script.talkTracks.length).toBe(4);
    expect(script.talkTracks[0].stepName).toContain("同理认可");
    expect(script.talkTracks[3].stepName).toContain("条件交换");

    const recCheck = await owner.query<{ id: string }>(
      "select id from ai_recommendations where tenant_id = $1 and recommendation_type = 'OBJECTION_KILLER'",
      [tenantId],
    );
    expect(recCheck.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("4. AI 潜客拓客初次触达话术与反馈闭环 (Outreach Pitch & Feedback)", async () => {
    // 1) 生成定制拓客话术
    const pitch = await aiCopilotService.generateLeadOutreachPitchService(salesCtx, leadId);
    expect(pitch.leadId).toBe(leadId);
    expect(pitch.hook).toContain("刘经理");
    expect(pitch.valueProposition).toContain("35%");
    expect(pitch.callToAction).toBeTruthy();

    // 2) 获取最新推荐记录并提交有价值反馈
    const list = await aiCopilotService.listAiRecommendationsService(salesCtx, { leadId });
    expect(list.length).toBeGreaterThanOrEqual(1);

    const recId = list[0].id;
    await owner.query("update ai_recommendations set user_id = $1 where id = $2", [salesId, recId]);
    const fbRes = await aiCopilotService.submitCopilotFeedbackService(salesCtx, recId, "HELPFUL");
    expect(fbRes.success).toBe(true);

    const checkFb = await owner.query<{ feedback_verdict: string }>(
      "select feedback_verdict from ai_recommendations where id = $1",
      [recId],
    );
    expect(checkFb.rows[0].feedback_verdict).toBe("HELPFUL");
  });

  it("5. AI API Key 安全回传：读取与保存只返回掩码，明文不离开服务端", async () => {
    const RAW_KEY = "sk-live-plaintext-9876";
    await securityService.upsertSecurityComplianceConfigService(adminCtx, {
      aiProvider: "DEEPSEEK",
      aiApiKey: RAW_KEY,
      aiModelName: "deepseek-chat",
    });

    const cfg = await securityService.getSecurityComplianceConfigService(adminCtx);
    expect(JSON.stringify(cfg)).not.toContain(RAW_KEY);
    expect(cfg.aiApiKeyMasked).toBe("••••9876");

    const saved = await securityService.upsertSecurityComplianceConfigService(adminCtx, {
      aiTemperature: 0.5,
    });
    expect(JSON.stringify(saved)).not.toContain(RAW_KEY);
    expect(saved.aiApiKeyMasked).toBe("••••9876");

    // Key 在数据库中以 AES-256-GCM 密文存储，解密后保持完整（AI 网关依赖它调用真实大模型）
    const { decryptSecret } = await import("@/core/security/crypto");
    const row = await owner.query<{ ai_api_key: string | null }>(
      "select ai_api_key from security_compliance_configs where tenant_id = $1",
      [tenantId],
    );
    expect(row.rows[0]?.ai_api_key).toMatch(/^enc:v1:/);
    expect(decryptSecret(row.rows[0]?.ai_api_key)).toBe(RAW_KEY);
  });

  it("6. 保存留空不动已存 Key，显式传 null 才清除", async () => {
    await securityService.upsertSecurityComplianceConfigService(adminCtx, { watermarkEnabled: false });
    let cfg = await securityService.getSecurityComplianceConfigService(adminCtx);
    expect(cfg.aiApiKeyMasked).toBe("••••9876");

    await securityService.upsertSecurityComplianceConfigService(adminCtx, { aiApiKey: null });
    cfg = await securityService.getSecurityComplianceConfigService(adminCtx);
    expect(cfg.aiApiKeyMasked).toBeNull();
  });

  it("7. AI 推荐反馈与采纳防越权拦截：非属主销售禁止操作他人推荐，管理员放行", async () => {
    const uRes = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '别组销售小钱', 'SALES') returning id",
      [tenantId, `other-sales-${Date.now()}@example.com`],
    );
    const otherSalesCtx: TenantContext = { tenantId, userId: uRes.rows[0].id, role: "SALES" };

    const recRes = await owner.query<{ id: string }>(
      `insert into ai_recommendations (tenant_id, user_id, lead_id, recommendation_type, title, content)
       values ($1, $2, $3, 'NEXT_BEST_ACTION', '跟进提醒', '下周二电话跟进') returning id`,
      [tenantId, salesId, leadId],
    );
    const recId = recRes.rows[0].id;

    // 非属主销售提交反馈被拒
    await expect(
      aiCopilotService.submitCopilotFeedbackService(otherSalesCtx, recId, "HELPFUL"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 非属主销售标记采纳被拒
    await expect(
      aiCopilotService.markAiRecommendationAppliedService(otherSalesCtx, recId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 管理员放行（该函数返回 void）
    await aiCopilotService.markAiRecommendationAppliedService(adminCtx, recId);

    // 属主销售放行
    const salesFeedback = await aiCopilotService.submitCopilotFeedbackService(salesCtx, recId, "NOT_HELPFUL");
    expect(salesFeedback.success).toBe(true);
    const auditRows = await owner.query<{ action: string; actor_user_id: string; subject_id: string }>(
      `select action, actor_user_id, subject_id
       from audit_logs
       where tenant_id = $1 and subject_id = $2 and action in ('ai_recommendation.applied', 'ai_recommendation.feedback')
       order by created_at asc`,
      [tenantId, recId],
    );
    expect(auditRows.rows).toEqual([
      expect.objectContaining({ action: "ai_recommendation.applied", actor_user_id: adminId, subject_id: recId }),
      expect.objectContaining({ action: "ai_recommendation.feedback", actor_user_id: salesId, subject_id: recId }),
    ]);
  });
});
