"use server";

import { requireSession } from "@/core/auth/session";
import {
  analyzeOpportunityDiagnosticService,
  generateLeadOutreachPitchService,
  generateObjectionKillerService,
  listAiRecommendationsService,
  markAiRecommendationAppliedService,
  submitCopilotFeedbackService,
} from "./service";
import type {
  AiRecommendationItem,
  LeadPitchScript,
  ObjectionKillerScript,
  ObjectionType,
  OpportunityDiagnosticResult,
} from "./types";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export async function analyzeOpportunityDiagnosticAction(
  opportunityId: string,
): Promise<ActionResult<OpportunityDiagnosticResult>> {
  try {
    const session = await requireSession();
    const data = await analyzeOpportunityDiagnosticService(session, opportunityId);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "AI 智能诊断商机失败",
    };
  }
}

export async function generateObjectionKillerAction(input: {
  objectionType: ObjectionType;
  competitorName?: string;
  targetName?: string;
  productName?: string;
}): Promise<ActionResult<ObjectionKillerScript>> {
  try {
    const session = await requireSession();
    const data = await generateObjectionKillerService(session, input);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "生成实战对抗话术失败",
    };
  }
}

export async function generateLeadOutreachPitchAction(
  leadId: string,
): Promise<ActionResult<LeadPitchScript>> {
  try {
    const session = await requireSession();
    const data = await generateLeadOutreachPitchService(session, leadId);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "生成拓客触达话术失败",
    };
  }
}

export async function listAiRecommendationsAction(filter: {
  opportunityId?: string;
  leadId?: string;
  type?: string;
} = {}): Promise<ActionResult<AiRecommendationItem[]>> {
  try {
    const session = await requireSession();
    const data = await listAiRecommendationsService(session, filter);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "获取 AI 决策推荐记录失败",
    };
  }
}

export async function submitCopilotFeedbackAction(
  recommendationId: string,
  verdict: "HELPFUL" | "NOT_HELPFUL" | "NOT_APPLICABLE",
): Promise<ActionResult<{ success: boolean }>> {
  try {
    const session = await requireSession();
    const data = await submitCopilotFeedbackService(session, recommendationId, verdict);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "提交反馈失败",
    };
  }
}

export async function markAiRecommendationAppliedAction(
  recommendationId: string,
): Promise<ActionResult<void>> {
  try {
    const session = await requireSession();
    await markAiRecommendationAppliedService(session, recommendationId);
    return { ok: true, data: undefined };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "标记采纳失败",
    };
  }
}
