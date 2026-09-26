"use server";

import { requireSession } from "@/core/auth/session";
import {
  executeDealInspectionService,
  extractLearningFromWinReviewService,
  getAiHubOverviewService,
  listAgentLearningLogsService,
  listPromptTemplatesService,
  listQualityInspectionsService,
  upsertPromptTemplateService,
} from "./service";
import type { UpsertPromptTemplateInput } from "./types";

export async function listPromptTemplatesAction() {
  try {
    const session = await requireSession();
    const data = await listPromptTemplatesService(session);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "获取提示词模板失败" };
  }
}

export async function upsertPromptTemplateAction(input: UpsertPromptTemplateInput) {
  try {
    const session = await requireSession();
    const data = await upsertPromptTemplateService(session, input);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "保存提示词模板失败" };
  }
}

export async function executeDealInspectionAction(opportunityId: string) {
  try {
    const session = await requireSession();
    const data = await executeDealInspectionService(session, opportunityId);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "执行智能质检失败" };
  }
}

export async function listQualityInspectionsAction(opportunityId?: string) {
  try {
    const session = await requireSession();
    const data = await listQualityInspectionsService(session, opportunityId);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "获取质检列表失败" };
  }
}

export async function listAgentLearningLogsAction() {
  try {
    const session = await requireSession();
    const data = await listAgentLearningLogsService(session);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "获取智能体学习库失败" };
  }
}

export async function extractLearningFromWinReviewAction(winReviewId: string) {
  try {
    const session = await requireSession();
    const data = await extractLearningFromWinReviewService(session, winReviewId);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "赢单策略经验提取失败" };
  }
}

export async function getAiHubOverviewAction() {
  try {
    const session = await requireSession();
    const data = await getAiHubOverviewService(session);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "获取 AI 智能体概览失败" };
  }
}

export async function runChampionAnalysisAction() {
  try {
    const session = await requireSession();
    if (session.role === "SALES") {
      return { ok: false as const, message: "权限不足，仅主管或管理员可运行经营智能体" };
    }
    const { runChampionAnalysisAgent } = await import("./agents/champion-analysis");
    const data = await runChampionAnalysisAgent(session);

    // 自动持久化报告并反哺一线销售
    const { saveInsightReportService } = await import("./service");
    let sampleSize = 0;
    for (const m of data.messages) {
      if (m.role === "tool" && m.content) {
        try {
          const parsed = JSON.parse(m.content);
          const sz = parsed?.result?.sampleSize ?? parsed?.result?.totalWonSamples ?? parsed?.result?.totalClosedSamples;
          if (typeof sz === "number") sampleSize = Math.max(sampleSize, sz);
        } catch {
          // ignore
        }
      }
    }
    const saved = await saveInsightReportService(session, {
      kind: "CHAMPION_ANALYSIS",
      content: data.outcome,
      sampleSize,
      confidence: sampleSize >= 20 ? "HIGH" : sampleSize >= 10 ? "MEDIUM" : "LOW",
    });

    // 精简返回：不整包返回 messages，仅回 outcome/rounds/toolsUsed/reportId/tokenUsage
    const slim = {
      outcome: data.outcome,
      rounds: data.rounds,
      toolsUsed: data.toolsUsed,
      reportId: saved.id,
      tokenUsage: data.tokenUsage,
    };
    return { ok: true as const, data: slim };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "运行销冠解构智能体失败" };
  }
}

export async function runCompanyProfileAction() {
  try {
    const session = await requireSession();
    if (session.role === "SALES") {
      return { ok: false as const, message: "权限不足，仅主管或管理员可运行经营智能体" };
    }
    const { runCompanyProfileAgent } = await import("./agents/company-profile");
    const data = await runCompanyProfileAgent(session);

    // 自动持久化报告
    const { saveInsightReportService } = await import("./service");
    let sampleSize = 0;
    for (const m of data.messages) {
      if (m.role === "tool" && m.content) {
        try {
          const parsed = JSON.parse(m.content);
          const sz = parsed?.result?.sampleSize ?? parsed?.result?.totalCustomers ?? parsed?.result?.totalSampleCount;
          if (typeof sz === "number") sampleSize = Math.max(sampleSize, sz);
        } catch {
          // ignore
        }
      }
    }
    const saved = await saveInsightReportService(session, {
      kind: "COMPANY_PROFILE",
      content: data.outcome,
      sampleSize,
      confidence: sampleSize >= 20 ? "HIGH" : sampleSize >= 10 ? "MEDIUM" : "LOW",
    });

    const slim = {
      outcome: data.outcome,
      rounds: data.rounds,
      toolsUsed: data.toolsUsed,
      reportId: saved.id,
      tokenUsage: data.tokenUsage,
    };
    return { ok: true as const, data: slim };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "运行企业画像智能体失败" };
  }
}

export async function listInsightReportsAction(kind?: import("./types").AiInsightReportKind) {
  try {
    const session = await requireSession();
    const { listInsightReportsService } = await import("./service");
    const data = await listInsightReportsService(session, kind);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "获取认知历史报告失败" };
  }
}

export async function getInsightReportAction(reportId: string) {
  try {
    const session = await requireSession();
    const { getInsightReportByIdService } = await import("./service");
    const data = await getInsightReportByIdService(session, reportId);
    if (!data) return { ok: false as const, message: "报告不存在" };
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "获取认知报告详情失败" };
  }
}

export async function listMyRecentRecommendationsAction(days: number = 7) {
  try {
    const session = await requireSession();
    const { getMyRecentRecommendationsService } = await import("./morning-copilot-service");
    const data = await getMyRecentRecommendationsService(session, days);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "获取近7天晨会建议回顾失败" };
  }
}

export async function getTodayMorningRecommendationsAction() {
  try {
    const session = await requireSession();
    const { getTodayMorningRecommendationsService } = await import("./morning-copilot-service");
    const data = await getTodayMorningRecommendationsService(session, session.userId);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "获取今日晨会建议失败" };
  }
}

export async function applyMorningRecommendationAction(recommendationId: string, actionNote?: string) {
  try {
    const session = await requireSession();
    const { applyMorningRecommendationService } = await import("./morning-copilot-service");
    const data = await applyMorningRecommendationService(session, recommendationId, actionNote);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "采纳建议失败" };
  }
}

export async function dismissMorningRecommendationAction(recommendationId: string, reason?: string) {
  try {
    const session = await requireSession();
    const { dismissMorningRecommendationService } = await import("./morning-copilot-service");
    const data = await dismissMorningRecommendationService(session, recommendationId, reason);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "忽略建议失败" };
  }
}

export async function getAdoptionStatsAction(days: 7 | 30 = 7) {
  try {
    const session = await requireSession();
    if (session.role === "SALES") {
      return { ok: false as const, message: "权限不足，仅主管或管理员可查看采纳率统计" };
    }
    const { getAdoptionStatsService } = await import("./morning-copilot-service");
    const data = await getAdoptionStatsService(session, days);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "获取采纳率统计失败" };
  }
}

export async function listClosedOpportunitiesAction() {
  try {
    const session = await requireSession();
    const { listClosedOpportunitiesService } = await import("./service");
    const data = await listClosedOpportunitiesService(session);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "获取已关闭商机列表失败" };
  }
}

export async function runDealAttributionAction(opportunityId: string) {
  try {
    const session = await requireSession();
    const { withTenant } = await import("@/core/tenant");
    const { sql } = await import("drizzle-orm");

    // 鉴权校验商机状态与归属
    const opp = await withTenant(session.tenantId, async (tx) => {
      const res = await tx.execute<{
        id: string;
        stage: "WON" | "LOST" | string;
        ownerUserId: string;
      }>(sql`
        select id, stage, owner_user_id::text as "ownerUserId"
        from opportunities
        where tenant_id = ${session.tenantId}::uuid
          and id = ${opportunityId}::uuid
          and deleted_at is null
      `);
      return res.rows[0];
    });

    if (!opp) {
      return { ok: false as const, message: "商机不存在或已被删除" };
    }

    if (session.role === "SALES" && opp.ownerUserId !== session.userId) {
      return { ok: false as const, message: "权限不足：销售人员仅可对自己负责的商机执行归因分析" };
    }

    const direction = opp.stage === "WON" ? "WON" : (opp.stage === "LOST" ? "LOST" : undefined);
    const { runDealAttributionAgent } = await import("./agents/deal-attribution");
    const data = await runDealAttributionAgent(session, opportunityId, direction);
    const slim = {
      outcome: data.outcome,
      rounds: data.rounds,
      toolsUsed: data.toolsUsed,
      tokenUsage: (data as unknown as { tokenUsage?: unknown }).tokenUsage,
      opportunityId: data.opportunityId,
      direction: data.direction,
      evidenceCount: data.evidenceCount,
    };
    return { ok: true as const, data: slim };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "商机因果归因分析失败" };
  }
}




export async function runGrowthOpportunityAction() {
  try {
    const session = await requireSession();
    const { runGrowthOpportunityAgent } = await import("./agents/growth-opportunity");
    const data = await runGrowthOpportunityAgent(session);
    const slim = {
      outcome: data.outcome,
      rounds: data.rounds,
      toolsUsed: data.toolsUsed,
      tokenUsage: data.tokenUsage,
      report: (data as unknown as { report?: unknown }).report,
    };
    return { ok: true as const, data: slim };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "运行增量与变现智能体失败" };
  }
}
