import { z } from "zod";

export const customerSizeValues = ["1-20", "21-100", "101-500", "501-1000", "1000+"] as const;
export const playbookTargetStageValues = ["DISCOVERY", "PROPOSAL", "NEGOTIATION"] as const;
export const playbookFeedbackVerdictValues = ["HELPFUL", "NOT_HELPFUL", "NOT_APPLICABLE"] as const;

export type CustomerSize = (typeof customerSizeValues)[number];
export type PlaybookTargetStage = (typeof playbookTargetStageValues)[number];
export type SalesPlaybookStatus = "DRAFT" | "PUBLISHED" | "RETIRED";
export type SalesPlaybookFeedbackVerdict = (typeof playbookFeedbackVerdictValues)[number];

export type PlaybookScope = {
  applicableIndustries: string[];
  excludedIndustries: string[];
  applicableRegions: string[];
  excludedRegions: string[];
  applicableCustomerSizes: CustomerSize[];
  excludedCustomerSizes: CustomerSize[];
};

export type PlaybookClaimEvidence = {
  checkpoints: string[];
  recommendedCadence: string[];
  effectiveActions: string[];
  commonRisks: string[];
};

export type SalesPlaybook = PlaybookScope & {
  id: string;
  familyKey: string;
  version: number;
  status: SalesPlaybookStatus;
  name: string;
  targetStage: PlaybookTargetStage;
  checkpoints: string[];
  recommendedCadence: string[];
  effectiveActions: string[];
  commonRisks: string[];
  claimEvidence: PlaybookClaimEvidence;
  sampleIds: string[];
  createdByName: string | null;
  publishedByName: string | null;
  publishReason: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SalesPlaybookRecommendation = {
  playbook: SalesPlaybook;
  score: number;
  currentUserFeedback: SalesPlaybookFeedback | null;
};

export type SalesPlaybookFeedback = {
  verdict: SalesPlaybookFeedbackVerdict;
  reason: string | null;
  updatedAt: string;
};

export type ReviewedWinSample = {
  id: string;
  opportunityId: string;
  opportunityName: string;
  customerName: string;
  customerIndustry: string | null;
  customerRegion: string | null;
  customerSize: CustomerSize | null;
  summary: string;
  metrics: Record<string, unknown>;
  reviewedAt: string;
};

const textItem = z.string().trim().min(1, "内容不能为空").max(300, "内容不能超过 300 个字符");
const scopeTextItem = z.string().trim().min(1, "范围不能为空").max(50, "范围不能超过 50 个字符");

function uniqueArray<T extends z.ZodTypeAny>(schema: T, max: number, min = 0) {
  return z.array(schema).min(min, "至少需要一项").max(max, `最多允许 ${max} 项`).superRefine((items: z.output<T>[], context) => {
    if (new Set(items).size !== items.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "不允许重复项" });
  });
}

const claimEvidenceSchema = z.object({
  checkpoints: uniqueArray(z.string().uuid("样本 ID 无效"), 20, 1),
  recommendedCadence: uniqueArray(z.string().uuid("样本 ID 无效"), 20, 1),
  effectiveActions: uniqueArray(z.string().uuid("样本 ID 无效"), 20, 1),
  commonRisks: uniqueArray(z.string().uuid("样本 ID 无效"), 20, 1),
}).strict();

export const salesPlaybookDraftSchema = z.object({
  familyKey: z.string().trim().regex(/^[a-z][a-z0-9-]{2,49}$/, "打法标识只能使用小写字母、数字和连字符").max(50),
  name: z.string().trim().min(1, "打法名称不能为空").max(100, "打法名称不能超过 100 个字符"),
  targetStage: z.enum(playbookTargetStageValues),
  applicableIndustries: uniqueArray(scopeTextItem, 20),
  excludedIndustries: uniqueArray(scopeTextItem, 20),
  applicableRegions: uniqueArray(scopeTextItem, 20),
  excludedRegions: uniqueArray(scopeTextItem, 20),
  applicableCustomerSizes: uniqueArray(z.enum(customerSizeValues), customerSizeValues.length),
  excludedCustomerSizes: uniqueArray(z.enum(customerSizeValues), customerSizeValues.length),
  checkpoints: uniqueArray(textItem, 12, 1),
  recommendedCadence: uniqueArray(textItem, 8, 1),
  effectiveActions: uniqueArray(textItem, 12, 1),
  commonRisks: uniqueArray(textItem, 12, 1),
  claimEvidence: claimEvidenceSchema,
  sampleIds: uniqueArray(z.string().uuid("样本 ID 无效"), 20, 1),
}).strict().superRefine((input, context) => {
  const sampleIds = new Set(input.sampleIds);
  for (const [field, evidence] of Object.entries(input.claimEvidence)) {
    evidence.forEach((sampleId, index) => {
      if (!sampleIds.has(sampleId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["claimEvidence", field, index], message: "证据样本必须来自当前打法样本" });
      }
    });
  }
});

export const publishSalesPlaybookSchema = z.object({
  playbookId: z.string().uuid("打法 ID 无效"),
  reason: z.string().trim().min(1, "请填写发布理由").max(500, "发布理由不能超过 500 个字符"),
}).strict();

export const playbookFeedbackSchema = z.object({
  opportunityId: z.string().uuid("商机 ID 无效"),
  playbookId: z.string().uuid("打法 ID 无效"),
  verdict: z.enum(playbookFeedbackVerdictValues),
  reason: z.string().trim().max(500, "反馈原因不能超过 500 个字符").optional(),
}).strict().superRefine((input, context) => {
  if ((input.verdict === "NOT_HELPFUL" || input.verdict === "NOT_APPLICABLE") && !input.reason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "此反馈需要填写原因" });
  }
});

export type CreateSalesPlaybookDraftInput = z.infer<typeof salesPlaybookDraftSchema>;
export type PublishSalesPlaybookInput = z.infer<typeof publishSalesPlaybookSchema>;
export type SubmitPlaybookFeedbackInput = z.infer<typeof playbookFeedbackSchema>;
