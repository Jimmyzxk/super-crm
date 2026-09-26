import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/core/tenant";
import { AgentTool } from "./types";

export const getPipelineSummaryTool: AgentTool = {
  name: "getPipelineSummary",
  description: "获取当前管线（活跃商机）的按阶段分布摘要，包含各阶段商机数量与金额总和（单位：元）。",
  parameters: z.object({}),
  execute: async (ctx) => {
    return await withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.execute<{
        stage: string;
        count: string | number;
        total_amount: string | number | null;
      }>(sql`
        select
          o.stage::text as stage,
          count(*)::int as count,
          coalesce(sum(o.expected_amount), 0)::bigint as total_amount
        from opportunities o
        where o.tenant_id = ${ctx.tenantId}
          and o.deleted_at is null
          and o.stage not in ('WON', 'LOST')
          ${ctx.role === "SALES" ? sql`and o.owner_user_id = ${ctx.userId}::uuid` : sql``}
        group by o.stage
      `);

      const summary: Record<string, { count: number; amountYuan: number }> = {};
      for (const row of rows.rows) {
        summary[row.stage] = {
          count: Number(row.count),
          amountYuan: Number((Number(row.total_amount || 0) / 100).toFixed(2)),
        };
      }

      return { result: summary };
    });
  }
};

