import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/core/tenant";
import { AgentTool } from "./types";

export interface PortfolioSegmentItem {
  industry: string;
  scale: string;
  customerType: string;
  customerCount: number;
  revenueAmountYuan: number;
  revenueSharePercent: number;
}

export interface RevenueSegmentItem {
  dimension: "industry" | "source" | "customerType";
  segment: string;
  wonAmountYuan: number;
  wonCount: number;
  pipelineAmountYuan: number;
  pipelineCount: number;
  totalDeals: number;
}

export const customerPortfolioStructureTool: AgentTool = {
  name: "customerPortfolioStructure",
  description: "获取客户全景盘子的结构分布（行业 × 企业规模 × 客户类型），以及各细分画像群体的客户数与营收贡献金额（单位：元）和占比。",
  parameters: z.object({}),
  execute: async (ctx) => {
    return withTenant(ctx.tenantId, async (tx) => {
      // 1. 客户总数与总营收基准
      const baseRes = await tx.execute<{ totalCustomers: string | number; totalRevenue: string | number }>(sql`
        select
          count(distinct c.id)::int as "totalCustomers",
          coalesce(sum(case when o.stage = 'WON' then coalesce(o.actual_amount, o.expected_amount, 0) else 0 end), 0)::bigint as "totalRevenue"
        from customers c
        left join opportunities o on o.tenant_id = c.tenant_id and o.customer_id = c.id and o.deleted_at is null
        where c.tenant_id = ${ctx.tenantId}::uuid
          and c.deleted_at is null
      `);

      const totalCustomers = Number(baseRes.rows[0]?.totalCustomers || 0);
      const totalRevenue = Number(baseRes.rows[0]?.totalRevenue || 0);
      const totalRevenueYuan = Number((totalRevenue / 100).toFixed(2));

      // 2. 行业 × 规模 × 类型多维交叉统计
      const segRes = await tx.execute<{
        industry: string;
        scale: string;
        customerType: string;
        customerCount: string | number;
        revenueAmount: string | number;
      }>(sql`
        select
          coalesce(nullif(c.industry, ''), '未分类行业') as "industry",
          coalesce(nullif(c.size::text, ''), '未知规模') as "scale",
          c.customer_type::text as "customerType",
          count(distinct c.id)::int as "customerCount",
          coalesce(sum(case when o.stage = 'WON' then coalesce(o.actual_amount, o.expected_amount, 0) else 0 end), 0)::bigint as "revenueAmount"
        from customers c
        left join opportunities o on o.tenant_id = c.tenant_id and o.customer_id = c.id and o.deleted_at is null
        where c.tenant_id = ${ctx.tenantId}::uuid
          and c.deleted_at is null
        group by coalesce(nullif(c.industry, ''), '未分类行业'), coalesce(nullif(c.size::text, ''), '未知规模'), c.customer_type
        order by "revenueAmount" desc, "customerCount" desc
      `);

      const portfolio: PortfolioSegmentItem[] = segRes.rows.map((r) => {
        const rev = Number(r.revenueAmount);
        const share = totalRevenue > 0 ? Number(((rev / totalRevenue) * 100).toFixed(1)) : 0;
        return {
          industry: r.industry,
          scale: r.scale,
          customerType: r.customerType,
          customerCount: Number(r.customerCount),
          revenueAmountYuan: Number((rev / 100).toFixed(2)),
          revenueSharePercent: share,
        };
      });

      return {
        result: {
          totalCustomers,
          sampleSize: totalCustomers,
          totalRevenueYuan,
          portfolio,
        },
      };
    });
  },
};

export const revenueBySegmentTool: AgentTool = {
  name: "revenueBySegment",
  description: "按行业、获客渠道来源与客户类型分层，统计已实现的赢单营收金额（单位：元）与在途蓄水池商机金额（单位：元）。",
  parameters: z.object({
    dimension: z.enum(["industry", "source", "customerType", "all"]).optional().describe("分层维度，默认为 all")
  }),
  execute: async (ctx, args) => {
    const dimension = args.dimension || "all";
    return withTenant(ctx.tenantId, async (tx) => {
      const totalOppRes = await tx.execute<{ totalCount: string | number }>(sql`
        select count(*)::int as "totalCount"
        from opportunities
        where tenant_id = ${ctx.tenantId}::uuid and deleted_at is null
      `);
      const totalSampleCount = Number(totalOppRes.rows[0]?.totalCount || 0);

      const items: RevenueSegmentItem[] = [];

      // 1. 行业维度
      if (dimension === "industry" || dimension === "all") {
        const indRes = await tx.execute<{
          segment: string;
          wonAmount: string | number;
          wonCount: string | number;
          pipelineAmount: string | number;
          pipelineCount: string | number;
        }>(sql`
          select
            coalesce(nullif(c.industry, ''), '未分类行业') as "segment",
            coalesce(sum(case when o.stage = 'WON' then coalesce(o.actual_amount, o.expected_amount, 0) else 0 end), 0)::bigint as "wonAmount",
            count(case when o.stage = 'WON' then 1 end)::int as "wonCount",
            coalesce(sum(case when o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION') then coalesce(o.expected_amount, 0) else 0 end), 0)::bigint as "pipelineAmount",
            count(case when o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION') then 1 end)::int as "pipelineCount"
          from opportunities o
          left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id and c.deleted_at is null
          where o.tenant_id = ${ctx.tenantId}::uuid
            and o.deleted_at is null
          group by coalesce(nullif(c.industry, ''), '未分类行业')
          order by "wonAmount" desc, "pipelineAmount" desc
        `);

        for (const r of indRes.rows) {
          const wonC = Number(r.wonCount);
          const pipeC = Number(r.pipelineCount);
          items.push({
            dimension: "industry",
            segment: r.segment,
            wonAmountYuan: Number((Number(r.wonAmount) / 100).toFixed(2)),
            wonCount: wonC,
            pipelineAmountYuan: Number((Number(r.pipelineAmount) / 100).toFixed(2)),
            pipelineCount: pipeC,
            totalDeals: wonC + pipeC,
          });
        }
      }

      // 2. 来源渠道维度
      if (dimension === "source" || dimension === "all") {
        const srcRes = await tx.execute<{
          segment: string;
          wonAmount: string | number;
          wonCount: string | number;
          pipelineAmount: string | number;
          pipelineCount: string | number;
        }>(sql`
          select
            coalesce(nullif(l.channel, ''), nullif(l.source, ''), '自拓录入') as "segment",
            coalesce(sum(case when o.stage = 'WON' then coalesce(o.actual_amount, o.expected_amount, 0) else 0 end), 0)::bigint as "wonAmount",
            count(case when o.stage = 'WON' then 1 end)::int as "wonCount",
            coalesce(sum(case when o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION') then coalesce(o.expected_amount, 0) else 0 end), 0)::bigint as "pipelineAmount",
            count(case when o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION') then 1 end)::int as "pipelineCount"
          from opportunities o
          left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id and c.deleted_at is null
          left join lead_conversions lc on lc.tenant_id = o.tenant_id and lc.opportunity_id = o.id
          left join leads l on l.tenant_id = o.tenant_id and l.id = coalesce(lc.lead_id, o.from_lead_id, c.from_lead_id) and l.deleted_at is null
          where o.tenant_id = ${ctx.tenantId}::uuid
            and o.deleted_at is null
          group by coalesce(nullif(l.channel, ''), nullif(l.source, ''), '自拓录入')
          order by "wonAmount" desc, "pipelineAmount" desc
        `);

        for (const r of srcRes.rows) {
          const wonC = Number(r.wonCount);
          const pipeC = Number(r.pipelineCount);
          items.push({
            dimension: "source",
            segment: r.segment,
            wonAmountYuan: Number((Number(r.wonAmount) / 100).toFixed(2)),
            wonCount: wonC,
            pipelineAmountYuan: Number((Number(r.pipelineAmount) / 100).toFixed(2)),
            pipelineCount: pipeC,
            totalDeals: wonC + pipeC,
          });
        }
      }

      // 3. 客户类型维度
      if (dimension === "customerType" || dimension === "all") {
        const typeRes = await tx.execute<{
          segment: string;
          wonAmount: string | number;
          wonCount: string | number;
          pipelineAmount: string | number;
          pipelineCount: string | number;
        }>(sql`
          select
            coalesce(c.customer_type::text, 'ENTERPRISE') as "segment",
            coalesce(sum(case when o.stage = 'WON' then coalesce(o.actual_amount, o.expected_amount, 0) else 0 end), 0)::bigint as "wonAmount",
            count(case when o.stage = 'WON' then 1 end)::int as "wonCount",
            coalesce(sum(case when o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION') then coalesce(o.expected_amount, 0) else 0 end), 0)::bigint as "pipelineAmount",
            count(case when o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION') then 1 end)::int as "pipelineCount"
          from opportunities o
          left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id and c.deleted_at is null
          where o.tenant_id = ${ctx.tenantId}::uuid
            and o.deleted_at is null
          group by coalesce(c.customer_type::text, 'ENTERPRISE')
          order by "wonAmount" desc, "pipelineAmount" desc
        `);

        for (const r of typeRes.rows) {
          const wonC = Number(r.wonCount);
          const pipeC = Number(r.pipelineCount);
          items.push({
            dimension: "customerType",
            segment: r.segment,
            wonAmountYuan: Number((Number(r.wonAmount) / 100).toFixed(2)),
            wonCount: wonC,
            pipelineAmountYuan: Number((Number(r.pipelineAmount) / 100).toFixed(2)),
            pipelineCount: pipeC,
            totalDeals: wonC + pipeC,
          });
        }
      }

      return {
        result: {
          totalSampleCount,
          sampleSize: totalSampleCount,
          revenueSegments: items,
        },
      };
    });
  },
};
