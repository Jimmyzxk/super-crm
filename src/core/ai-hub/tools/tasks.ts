import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/core/tenant";
import { AgentTool } from "./types";

export const listMyDueTasksTool: AgentTool = {
  name: "listMyDueTasks",
  description: "列出当前销售本人待办的跟进与催办任务（包含今日到期、已逾期及近 3 天内待处理的任务）。",
  parameters: z.object({
    status: z.enum(["OPEN", "ALL", "open", "all"]).optional().describe("任务状态，默认为 OPEN"),
  }),
  execute: async (ctx, args) => {
    const rawStatus = (args.status || "OPEN").toUpperCase();
    const statusCondition = rawStatus === "ALL" ? sql`` : sql`and t.status = 'OPEN'`;
    return withTenant(ctx.tenantId, async (tx) => {
      const res = await tx.execute<{
        id: string;
        type: string;
        dueAt: string;
        status: string;
        targetType: "lead" | "customer" | "opportunity";
        targetId: string;
        targetName: string;
      }>(sql`
        select
          t.id,
          t.type,
          t.due_at::text as "dueAt",
          t.status,
          case
            when t.lead_id is not null then 'lead'
            when t.customer_id is not null then 'customer'
            else 'opportunity'
          end as "targetType",
          coalesce(t.lead_id, t.customer_id, t.opportunity_id)::text as "targetId",
          coalesce(l.contact_name, l.company_name, c.name, o.name, '未知目标') as "targetName"
        from tasks t
        left join leads l on l.tenant_id = t.tenant_id and l.id = t.lead_id and l.deleted_at is null
        left join customers c on c.tenant_id = t.tenant_id and c.id = t.customer_id and c.deleted_at is null
        left join opportunities o on o.tenant_id = t.tenant_id and o.id = t.opportunity_id and o.deleted_at is null
        where t.tenant_id = ${ctx.tenantId}::uuid
          and t.assignee_user_id = ${ctx.userId}::uuid
          ${statusCondition}
        order by t.due_at asc
        limit 20
      `);

      return {
        result: {
          totalTasks: res.rows.length,
          tasks: res.rows,
        },
      };
    });
  },
};
