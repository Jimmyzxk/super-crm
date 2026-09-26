import { sql } from "drizzle-orm";
import type { TenantContext } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import type { InsightListItem } from "@/core/insight/types";

export type TodayInsight = InsightListItem & {
  subjectType: "lead" | "opportunity";
  subjectId: string;
  subjectName: string;
  subjectContext: string;
};

export async function getTodayInsights(session: TenantContext): Promise<TodayInsight[]> {
  return withTenant(session.tenantId, async (tx) => {
    const result = await tx.execute<TodayInsight>(sql`
      select si.id, si.code, si.severity, si.status, si.title, si.summary,
        si.suggested_action as "suggestedAction", si.suggested_due_at::text as "suggestedDueAt",
        si.evidence, si.source_type as "sourceType", si.source_version as "sourceVersion",
        si.accepted_task_id as "acceptedTaskId", si.refresh_failed_at::text as "refreshFailedAt",
        si.created_at::text as "createdAt", si.updated_at::text as "updatedAt",
        case when si.lead_id is not null then 'lead' else 'opportunity' end as "subjectType",
        coalesce(si.lead_id, si.opportunity_id) as "subjectId",
        coalesce(l.contact_name, o.name) as "subjectName",
        case when si.lead_id is not null then coalesce(l.company_name, '未填写公司') else c.name end as "subjectContext"
      from sales_insights si
      left join leads l on l.tenant_id = si.tenant_id and l.id = si.lead_id and l.deleted_at is null
      left join opportunities o on o.tenant_id = si.tenant_id and o.id = si.opportunity_id and o.deleted_at is null
      left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id and c.deleted_at is null
      where si.tenant_id = ${session.tenantId}
        and si.status = 'OPEN'
        and (
          (si.lead_id is not null and l.id is not null and (${session.role} <> 'SALES' or l.owner_user_id = ${session.userId}))
          or (si.opportunity_id is not null and o.id is not null and (${session.role} <> 'SALES' or o.owner_user_id = ${session.userId}))
        )
      order by case si.severity when 'HIGH_RISK' then 0 when 'ATTENTION' then 1 else 2 end,
        si.suggested_due_at nulls last, si.created_at desc
    `);
    return result.rows;
  });
}
