import { z } from "zod";
import { AgentTool } from "./types";
import { listOpportunitiesService, getOpportunityDetailService } from "@/core/opportunity/service";

export const listOpportunitiesTool: AgentTool = {
  name: "listOpportunities",
  description: "列出当前租户下的商机，可按责任人、阶段、最小金额过滤。返回商机的基本信息（金额单位：元），包括停滞天数（stalledDays）。",
  parameters: z.object({
    ownerUserId: z.string().optional().describe("商机负责人的 user_id"),
    stage: z.string().optional().describe("商机阶段 (如 'QUALIFICATION', 'PROPOSAL' 等)"),
    minAmountYuan: z.number().optional().describe("期望金额下限（单位：元）"),
    filter: z.enum(["active", "stalled", "month", "won", "lost"]).optional().describe("快捷过滤视图，例如 'stalled' 返回停滞超 7 天的商机"),
    search: z.string().optional().describe("名称或客户搜索词")
  }),
  execute: async (ctx, args) => {
    const minAmountCents = typeof args.minAmountYuan === "number" ? Math.round(args.minAmountYuan * 100) : undefined;
    const list = await listOpportunitiesService(ctx, {
      filter: args.filter,
      search: args.search,
      ownerUserId: args.ownerUserId,
      stage: args.stage,
      minAmountCents,
    });

    const formattedItems = list.items.map(i => ({
      ...i,
      expectedAmountYuan: i.expectedAmount ? Number((Number(i.expectedAmount) / 100).toFixed(2)) : null,
    }));

    return { result: formattedItems };
  }
};

export const getOpportunityDetailTool: AgentTool = {
  name: "getOpportunityDetail",
  description: "获取特定商机的详细信息（金额单位：元），包括跟进时间线摘要。",
  parameters: z.object({
    opportunityId: z.string().uuid().describe("商机 ID")
  }),
  execute: async (ctx, args) => {
    const detail = await getOpportunityDetailService(ctx, args.opportunityId);
    return {
      result: {
        ...detail,
        opportunity: {
          ...detail.opportunity,
          expectedAmountYuan: detail.opportunity.expectedAmount ? Number((Number(detail.opportunity.expectedAmount) / 100).toFixed(2)) : null,
          actualAmountYuan: detail.opportunity.actualAmount ? Number((Number(detail.opportunity.actualAmount) / 100).toFixed(2)) : null,
        }
      }
    };
  }
};

export const listStalledOpportunitiesTool: AgentTool = {
  name: "listStalledOpportunities",
  description: "列出停滞超过 7 天（或指定天数）的商机（金额单位：元）。",
  parameters: z.object({
    stalledDays: z.number().optional().describe("停滞天数阈值，默认 7 天"),
  }),
  execute: async (ctx, args) => {
    const minDays = typeof args?.stalledDays === "number" ? Math.max(0, args.stalledDays) : 7;
    const list = await listOpportunitiesService(ctx, { filter: "stalled", stalledDaysMin: minDays });
    const formattedItems = list.items.map((i) => ({
      ...i,
      stalledDays: Math.max(0, Math.floor((Date.now() - new Date(i.stageEnteredAt).getTime()) / 86400000)),
      expectedAmountYuan: i.expectedAmount ? Number((Number(i.expectedAmount) / 100).toFixed(2)) : null,
    }));
    return { result: formattedItems };
  }
};
