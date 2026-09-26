import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("V1闭环测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

let leadsService: typeof import("@/core/leads/service");
let followupService: typeof import("@/core/followup/service");
let followupAssistant: typeof import("@/core/followup/assistant");
let customerService: typeof import("@/core/customer/service");
let opportunityService: typeof import("@/core/opportunity/service");
let winReviewService: typeof import("@/core/win-review/service");
let playbookService: typeof import("@/core/playbook/service");
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let salesId: string;
let managerId: string;

describe("V1 完整 7 步销售闭环端到端集成测试", () => {
  beforeAll(async () => {
    await owner.connect();
    leadsService = await import("@/core/leads/service");
    followupService = await import("@/core/followup/service");
    followupAssistant = await import("@/core/followup/assistant");
    customerService = await import("@/core/customer/service");
    opportunityService = await import("@/core/opportunity/service");
    winReviewService = await import("@/core/win-review/service");
    playbookService = await import("@/core/playbook/service");
    closeDb = (await import("@/db/client")).closeDb;

    const tenantRes = await owner.query<{ id: string }>(`insert into tenants (name) values ('闭环测试租户') returning id`);
    tenantId = tenantRes.rows[0].id;

    const pw = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K";
    const ts = Date.now();
    await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
      values ($1, $2, $3, '管理员', 'ADMIN') returning id`, [tenantId, `admin-${ts}@example.com`, pw]);

    const managerRes = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)

      values ($1, $2, $3, '销售主管', 'MANAGER') returning id`, [tenantId, `manager-${ts}@example.com`, pw]);
    managerId = managerRes.rows[0].id;

    const salesRes = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
      values ($1, $2, $3, '一线销售', 'SALES') returning id`, [tenantId, `sales-${ts}@example.com`, pw]);
    salesId = salesRes.rows[0].id;
  });

  afterAll(async () => {
    await closeDb();
    await owner.end();
  });

  it("完整走通：进线 → 评分 → 智能跟进 → 转商机 → 推进 → 赢单 → 复盘审核 → 发布打法 → 新商机推荐", async () => {
    const salesCtx = { tenantId, userId: salesId, role: "SALES" as const };
    const managerCtx = { tenantId, userId: managerId, role: "MANAGER" as const };

    // 1. 进线录入与自动评分
    const lead1 = await leadsService.createLeadService(salesCtx, {
      contactName: "张总",
      contactPhone: "13811112222",
      contactEmail: "zhang@example.com",
      companyName: "张氏高端制造科技",
      title: "CTO",
    });
    expect(lead1.leadId).toBeDefined();

    // 2. 智能提炼跟进并记录
    const rawNote = "今天拜访客户现场交流顺利，张总意向强，预算充足，约定后天沟通详细方案细节";
    const parsed = followupAssistant.parseQuickFollowupText(rawNote);
    expect(parsed.suggestedType).toBe("VISIT");
    expect(parsed.suggestedOutcome).toBe("INTERESTED");
    expect(parsed.detectedTags).toContain("价格/预算关注");

    const activity = await followupService.logActivityService(salesCtx, {
      leadId: lead1.leadId!,
      type: parsed.suggestedType,
      outcome: parsed.suggestedOutcome,
      summary: parsed.cleanSummary,
      nextFollowUpAt: new Date(Date.now() + 2 * 24 * 3600 * 1000),
    });
    expect(activity.activityId).toBeDefined();

    // 3. 确认为合格线索 (QUALIFIED)
    await leadsService.qualifyLeadService(salesCtx, lead1.leadId!, "需求确认且预算充足");

    // 4. 转为客户并创建商机 (Atomic Conversion)
    const converted = await customerService.convertLeadToCustomerService(salesCtx, {
      leadId: lead1.leadId!,
      customerName: "张氏高端制造科技",
      industry: "制造",
      region: "华东",
      size: "101-500",
      contactName: "张总",
      contactPhone: "13811112222",
      contactEmail: "zhang@example.com",
      contactTitle: "CTO",
      opportunityName: "高端制造数字化采购项目",
      expectedAmount: 500000,
      expectedCloseAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      demandNote: "ERP升级需求，预算充足",
    });


    expect(converted.customerId).toBeDefined();
    expect(converted.opportunityId).toBeDefined();

    // 5. 推进商机阶段：DISCOVERY -> PROPOSAL -> NEGOTIATION -> WON
    const oppId = converted.opportunityId!;

    await opportunityService.advanceStageService(salesCtx, {
      opportunityId: oppId,
      fromStage: "DISCOVERY",
      toStage: "PROPOSAL",
      note: "完成初访并确认需求规格",
    });

    await opportunityService.advanceStageService(salesCtx, {
      opportunityId: oppId,
      fromStage: "PROPOSAL",
      toStage: "NEGOTIATION",
      note: "方案与报价已提交并经技术审核",
    });

    // 赢单 (在 NEGOTIATION 阶段赢单)
    await opportunityService.winOpportunityService(salesCtx, {
      opportunityId: oppId,
      actualAmount: 480000,
      actualCloseAt: new Date(),
      note: "成功签约",
    });

    // 6. 自动生成赢单复盘草稿 (Win Review)
    const winReview = await winReviewService.getWinReviewService(managerCtx, oppId);
    expect(winReview).toBeDefined();
    expect(winReview?.status).toBe("DRAFT");
    expect(winReview?.summary).toContain("赢单");

    // 主管审核通过赢单复盘
    const reviewed = await winReviewService.reviewWinReviewService(managerCtx, {
      winReviewId: winReview!.id,
      status: "REVIEWED",
      reason: "推进节奏紧凑，客户预算清晰，符合标杆样本标准",
    });
    expect(reviewed.status).toBe("REVIEWED");

    // 7. 沉淀 3 个样本并由主管发布销冠打法 (Playbook)
    const sampleIds = [winReview!.id];
    for (let i = 2; i <= 3; i++) {
      const extraLead = await leadsService.createLeadService(salesCtx, {
        contactName: `李总${i}`,
        contactPhone: `1381111333${i}`,
        companyName: `制造标杆企业${i}`,
      });
      // 记跟进使线索进入 CONTACTED 状态
      await followupService.logActivityService(salesCtx, {
        leadId: extraLead.leadId!,
        type: "CALL",
        outcome: "CONNECTED",
        summary: `与李总${i}进行首次电话沟通`,
      });
      await leadsService.qualifyLeadService(salesCtx, extraLead.leadId!, "合格");
      const extraConv = await customerService.convertLeadToCustomerService(salesCtx, {
        leadId: extraLead.leadId!,
        customerName: `制造标杆企业${i}`,
        industry: "制造",
        size: "101-500",
        contactName: `李总${i}`,
        contactPhone: `1381111333${i}`,
        opportunityName: `制造采购项目${i}`,
        expectedAmount: 300000,
        expectedCloseAt: new Date(Date.now() + 20 * 24 * 3600 * 1000),
        demandNote: "采购扩容",
      });

      const extraOppId = extraConv.opportunityId!;
      await opportunityService.advanceStageService(salesCtx, { opportunityId: extraOppId, fromStage: "DISCOVERY", toStage: "PROPOSAL", note: "方案" });
      await opportunityService.advanceStageService(salesCtx, { opportunityId: extraOppId, fromStage: "PROPOSAL", toStage: "NEGOTIATION", note: "谈判" });
      await opportunityService.winOpportunityService(salesCtx, { opportunityId: extraOppId, actualAmount: 300000, actualCloseAt: new Date() });
      const extraWinReview = await winReviewService.getWinReviewService(managerCtx, extraOppId);
      await winReviewService.reviewWinReviewService(managerCtx, {
        winReviewId: extraWinReview!.id,
        status: "REVIEWED",
        reason: "样本有效",
      });
      sampleIds.push(extraWinReview!.id);
    }

    expect(sampleIds.length).toBe(3);

    // 主管基于 3 个样本创建并发布打法
    const draft = await playbookService.createSalesPlaybookDraftService(managerCtx, {
      familyKey: "manufacturing-erp",
      name: "制造业数字化采购标准打法",
      targetStage: "DISCOVERY",
      applicableIndustries: ["制造"],
      excludedIndustries: [],
      applicableRegions: [],
      excludedRegions: [],
      applicableCustomerSizes: ["101-500"],
      excludedCustomerSizes: [],
      checkpoints: ["确认CTO决策权", "摸清预算范围"],
      recommendedCadence: ["首次拜访后2天内跟进", "方案提交后3天内答疑"],
      effectiveActions: ["现场展示标杆案例", "提供客制化ROI测算"],
      commonRisks: ["跳过决策人直接报价", "未约定下次时间"],
      claimEvidence: {
        checkpoints: sampleIds,
        recommendedCadence: sampleIds,
        effectiveActions: sampleIds,
        commonRisks: sampleIds,
      },
      sampleIds,
    });

    const published = await playbookService.publishSalesPlaybookService(managerCtx, {
      playbookId: draft.id,
      reason: "样本完整，验证通过",
    });

    expect(published.status).toBe("PUBLISHED");

    // 8. 验证新进商机自动匹配并推荐该打法
    const newLead = await leadsService.createLeadService(salesCtx, {
      contactName: "王总",
      contactPhone: "13900008888",
      companyName: "江南重工制造",
    });
    await followupService.logActivityService(salesCtx, {
      leadId: newLead.leadId!,
      type: "CALL",
      outcome: "INTERESTED",
      summary: "与王总初次沟通，意向强烈",
    });
    await leadsService.qualifyLeadService(salesCtx, newLead.leadId!, "合格");
    const newConv = await customerService.convertLeadToCustomerService(salesCtx, {
      leadId: newLead.leadId!,
      customerName: "江南重工制造",
      industry: "制造",
      size: "101-500",
      contactName: "王总",
      contactPhone: "13900008888",
      opportunityName: "江南重工一期项目",
      expectedAmount: 200000,
      expectedCloseAt: new Date(Date.now() + 15 * 24 * 3600 * 1000),
      demandNote: "一期采购",
    });


    const recommendation = await playbookService.getRecommendedPlaybookService(salesCtx, newConv.opportunityId!);
    expect(recommendation).toBeDefined();
    expect(recommendation?.playbook.id).toBe(published.id);
    expect(recommendation?.playbook.name).toBe("制造业数字化采购标准打法");
    expect(recommendation?.score).toBeGreaterThan(0);
  });
});
