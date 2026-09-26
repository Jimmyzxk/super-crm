import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/core/tenant";
import { AgentTool } from "./types";

export interface TopPerformerItem {
  ownerUserId: string;
  ownerName: string;
  wonAmountYuan: number;
  wonCount: number;
  avgDealSizeYuan: number;
  avgSalesCycleDays: number;
}

export interface FactorComparisonItem {
  dimension: "industry" | "scale" | "source";
  segment: string;
  wonCount: number;
  wonAmountYuan: number;
  lostCount: number;
  lostAmountYuan: number;
  totalCount: number;
  winRatePercent: number;
}

export const topPerformersByRevenueTool: AgentTool = {
  name: "topPerformersByRevenue",
  description: "按负责人（销售）聚合统计赢单业绩排行榜，包含赢单金额（单位：元）、赢单数量、平均客单价（单位：元）和平均成交周期（天），取前 5 名销冠及总赢单样本量 N。",
  parameters: z.object({
    limit: z.number().int().min(1).max(20).optional().describe("返回销冠人数，默认 5")
  }),
  execute: async (ctx, args) => {
    const limit = args.limit ?? 5;
    return withTenant(ctx.tenantId, async (tx) => {
      const totalRes = await tx.execute<{ total: string | number }>(sql`
        select count(*)::int as total
        from opportunities
        where tenant_id = ${ctx.tenantId}::uuid
          and stage = 'WON'
          and deleted_at is null
      `);
      const totalWonSamples = Number(totalRes.rows[0]?.total || 0);

      const topRes = await tx.execute<{
        ownerUserId: string;
        ownerName: string;
        wonCount: string | number;
        wonAmount: string | number;
        avgDealSize: string | number;
        avgSalesCycleDays: string | number;
      }>(sql`
        select
          u.id as "ownerUserId",
          coalesce(u.name, '未知销售') as "ownerName",
          count(o.id)::int as "wonCount",
          coalesce(sum(coalesce(o.actual_amount, o.expected_amount, 0)), 0)::bigint as "wonAmount",
          coalesce(avg(coalesce(o.actual_amount, o.expected_amount, 0)), 0)::bigint as "avgDealSize",
          coalesce(avg(extract(epoch from (coalesce(o.actual_close_at at time zone 'Asia/Shanghai', o.stage_entered_at, o.updated_at) - o.created_at)) / 86400), 0)::numeric(10,1) as "avgSalesCycleDays"
        from opportunities o
        join users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
        where o.tenant_id = ${ctx.tenantId}::uuid
          and o.stage = 'WON'
          and o.deleted_at is null
        group by u.id, u.name
        order by "wonAmount" desc, "wonCount" desc
        limit ${limit}
      `);

      const topPerformers: TopPerformerItem[] = topRes.rows.map((r) => ({
        ownerUserId: r.ownerUserId,
        ownerName: r.ownerName,
        wonAmountYuan: Number((Number(r.wonAmount) / 100).toFixed(2)),
        wonCount: Number(r.wonCount),
        avgDealSizeYuan: Number((Number(r.avgDealSize) / 100).toFixed(2)),
        avgSalesCycleDays: Number(r.avgSalesCycleDays),
      }));

      return {
        result: {
          totalWonSamples,
          sampleSize: totalWonSamples,
          topPerformers,
        },
      };
    });
  },
};

export const winLossFactorStatsTool: AgentTool = {
  name: "winLossFactorStats",
  description: "按客户行业、企业规模和获客来源统计赢单与输单的多维对比（赢单数、赢单金额（单位：元）、丢单数、丢单金额（单位：元）、胜率）。",
  parameters: z.object({
    dimension: z.enum(["industry", "scale", "source", "all"]).optional().describe("分析维度，默认为 all")
  }),
  execute: async (ctx, args) => {
    const dimension = args.dimension || "all";
    return withTenant(ctx.tenantId, async (tx) => {
      const totalRes = await tx.execute<{ total: string | number }>(sql`
        select count(*)::int as total
        from opportunities
        where tenant_id = ${ctx.tenantId}::uuid
          and stage in ('WON', 'LOST')
          and deleted_at is null
      `);
      const totalClosedSamples = Number(totalRes.rows[0]?.total || 0);

      const items: FactorComparisonItem[] = [];

      // 1. 行业维度
      if (dimension === "industry" || dimension === "all") {
        const indRes = await tx.execute<{
          segment: string;
          wonCount: string | number;
          wonAmount: string | number;
          lostCount: string | number;
          lostAmount: string | number;
          totalCount: string | number;
        }>(sql`
          select
            coalesce(nullif(c.industry, ''), '未分类行业') as "segment",
            count(case when o.stage = 'WON' then 1 end)::int as "wonCount",
            coalesce(sum(case when o.stage = 'WON' then coalesce(o.actual_amount, o.expected_amount, 0) else 0 end), 0)::bigint as "wonAmount",
            count(case when o.stage = 'LOST' then 1 end)::int as "lostCount",
            coalesce(sum(case when o.stage = 'LOST' then coalesce(o.expected_amount, 0) else 0 end), 0)::bigint as "lostAmount",
            count(o.id)::int as "totalCount"
          from opportunities o
          left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id and c.deleted_at is null
          where o.tenant_id = ${ctx.tenantId}::uuid
            and o.stage in ('WON', 'LOST')
            and o.deleted_at is null
          group by coalesce(nullif(c.industry, ''), '未分类行业')
          order by "wonAmount" desc, "wonCount" desc
        `);

        for (const r of indRes.rows) {
          const tot = Number(r.totalCount);
          const won = Number(r.wonCount);
          items.push({
            dimension: "industry",
            segment: r.segment,
            wonCount: won,
            wonAmountYuan: Number((Number(r.wonAmount) / 100).toFixed(2)),
            lostCount: Number(r.lostCount),
            lostAmountYuan: Number((Number(r.lostAmount) / 100).toFixed(2)),
            totalCount: tot,
            winRatePercent: tot > 0 ? Number(((won / tot) * 100).toFixed(1)) : 0,
          });
        }
      }

      // 2. 规模维度
      if (dimension === "scale" || dimension === "all") {
        const scaleRes = await tx.execute<{
          segment: string;
          wonCount: string | number;
          wonAmount: string | number;
          lostCount: string | number;
          lostAmount: string | number;
          totalCount: string | number;
        }>(sql`
          select
            coalesce(nullif(c.size::text, ''), '未知规模') as "segment",
            count(case when o.stage = 'WON' then 1 end)::int as "wonCount",
            coalesce(sum(case when o.stage = 'WON' then coalesce(o.actual_amount, o.expected_amount, 0) else 0 end), 0)::bigint as "wonAmount",
            count(case when o.stage = 'LOST' then 1 end)::int as "lostCount",
            coalesce(sum(case when o.stage = 'LOST' then coalesce(o.expected_amount, 0) else 0 end), 0)::bigint as "lostAmount",
            count(o.id)::int as "totalCount"
          from opportunities o
          left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id and c.deleted_at is null
          where o.tenant_id = ${ctx.tenantId}::uuid
            and o.stage in ('WON', 'LOST')
            and o.deleted_at is null
          group by coalesce(nullif(c.size::text, ''), '未知规模')
          order by "wonAmount" desc, "wonCount" desc
        `);

        for (const r of scaleRes.rows) {
          const tot = Number(r.totalCount);
          const won = Number(r.wonCount);
          items.push({
            dimension: "scale",
            segment: r.segment,
            wonCount: won,
            wonAmountYuan: Number((Number(r.wonAmount) / 100).toFixed(2)),
            lostCount: Number(r.lostCount),
            lostAmountYuan: Number((Number(r.lostAmount) / 100).toFixed(2)),
            totalCount: tot,
            winRatePercent: tot > 0 ? Number(((won / tot) * 100).toFixed(1)) : 0,
          });
        }
      }

      // 3. 来源维度
      if (dimension === "source" || dimension === "all") {
        const srcRes = await tx.execute<{
          segment: string;
          wonCount: string | number;
          wonAmount: string | number;
          lostCount: string | number;
          lostAmount: string | number;
          totalCount: string | number;
        }>(sql`
          select
            coalesce(nullif(l.channel, ''), nullif(l.source, ''), '自拓录入') as "segment",
            count(case when o.stage = 'WON' then 1 end)::int as "wonCount",
            coalesce(sum(case when o.stage = 'WON' then coalesce(o.actual_amount, o.expected_amount, 0) else 0 end), 0)::bigint as "wonAmount",
            count(case when o.stage = 'LOST' then 1 end)::int as "lostCount",
            coalesce(sum(case when o.stage = 'LOST' then coalesce(o.expected_amount, 0) else 0 end), 0)::bigint as "lostAmount",
            count(o.id)::int as "totalCount"
          from opportunities o
          left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id and c.deleted_at is null
          left join lead_conversions lc on lc.tenant_id = o.tenant_id and lc.opportunity_id = o.id
          left join leads l on l.tenant_id = o.tenant_id and l.id = coalesce(lc.lead_id, o.from_lead_id, c.from_lead_id) and l.deleted_at is null
          where o.tenant_id = ${ctx.tenantId}::uuid
            and o.stage in ('WON', 'LOST')
            and o.deleted_at is null
          group by coalesce(nullif(l.channel, ''), nullif(l.source, ''), '自拓录入')
          order by "wonAmount" desc, "wonCount" desc
        `);

        for (const r of srcRes.rows) {
          const tot = Number(r.totalCount);
          const won = Number(r.wonCount);
          items.push({
            dimension: "source",
            segment: r.segment,
            wonCount: won,
            wonAmountYuan: Number((Number(r.wonAmount) / 100).toFixed(2)),
            lostCount: Number(r.lostCount),
            lostAmountYuan: Number((Number(r.lostAmount) / 100).toFixed(2)),
            totalCount: tot,
            winRatePercent: tot > 0 ? Number(((won / tot) * 100).toFixed(1)) : 0,
          });
        }
      }

      return {
        result: {
          totalClosedSamples,
          sampleSize: totalClosedSamples,
          factors: items,
        },
      };
    });
  },
};
