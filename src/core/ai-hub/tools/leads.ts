import { z } from "zod";
import { AgentTool } from "./types";
import { listLeadsService } from "@/core/leads/service";

export const searchLeadsTool: AgentTool = {
  name: "searchLeads",
  description: "搜索线索列表，支持按名称、公司搜索以及状态过滤。",
  parameters: z.object({
    search: z.string().optional().describe("搜索词"),
    filter: z.enum(["my", "public", "converted", "discarded"]).optional().describe("线索过滤范围")
  }),
  execute: async (ctx, args) => {
    const list = await listLeadsService(ctx, { search: args.search, filter: args.filter });
    // 字段瘦身：去除明文手机、note、utm 等敏感/冗余字段，控制 token 消耗与隐私风险
    const slim = list.items.map((item: Record<string, unknown>) => {
      const { contactPhone, note, utmSource, utmMedium, utmCampaign, contactEmail, ...rest } = item as Record<string, unknown> & { contactPhone?: string; note?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string; contactEmail?: string };
      return {
        ...rest,
        // 保留脱敏后的联系方式占位，不暴露明文
        hasPhone: Boolean(contactPhone),
      };
    });
    return { result: slim };
  }
};
