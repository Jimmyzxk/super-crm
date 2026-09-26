import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/core/tenant";
import { getPluginFactsProvider } from "@/core/plugin-facts";
import { AgentTool } from "./types";

export interface StageStayItem {
  stage: string;
  enteredAt: string;
  leftAt: string | null;
  stayDays: number;
}

export interface FullOpportunityHistoryResult {
  opportunity: {
    id: string;
    name: string;
    stage: string;
    expectedAmountYuan: number | null;
    actualAmountYuan: number | null;
    lostReason: string | null;
    lostNote: string | null;
    createdAt: string;
    actualCloseAt: string | null;
    customer: {
      id: string;
      name: string;
      industry: string | null;
      size: string | null;
      customerType: string | null;
    };
    primaryContact: {
      id: string | null;
      name: string | null;
      title: string | null;
      role: string | null;
    } | null;
    owner: {
      id: string;
      name: string;
    };
  };
  stageHistory: Array<{
    fromStage: string | null;
    toStage: string;
    note: string | null;
    operatorName: string;
    createdAt: string;
  }>;
  stageStays: StageStayItem[];
  activities: Array<{
    id: string;
    type: string;
    outcome: string | null;
    summary: string;
    occurredAt: string;
    userName: string;
  }>;
  dealInterventions: Array<{
    id: string;
    interventionType: string;
    status: string;
    requestNote: string;
    managerFeedback: string | null;
    coachingNotes: string | null;
    createdAt: string;
    resolvedAt: string | null;
    managerName: string | null;
  }>;
  quotesAndContracts: {
    lineItems: Array<{
      productName: string;
      productCode: string;
      quantity: number;
      unitPriceYuan: number;
      discountRate: number;
      subtotalAmountYuan: number;
    }>;
    initialExpectedAmountYuan: number | null;
    finalActualAmountYuan: number | null;
    discountOrDeviationPercent: number | null;
    contracts: Array<{
      contractNo: string;
      title: string;
      totalAmountYuan: number;
      status: string;
      signDate: string | null;
    }>;
  };
}

export const getOpportunityFullHistoryTool: AgentTool = {
  name: "getOpportunityFullHistory",
  description: "获取特定商机的完整生命周期历史（全量阶段停留天数、全量跟进记录、战情室介入指导记录、关联报价与合同对比）。",
  parameters: z.object({
    opportunityId: z.string().uuid().describe("商机 ID"),
  }),
  execute: async (ctx, args) => {
    return withTenant(ctx.tenantId, async (tx) => {
      // 1. 查询商机基本信息与客户、主联系人、负责人
      const oppRes = await tx.execute<{
        id: string;
        name: string;
        stage: string;
        expectedAmount: string | null;
        actualAmount: string | null;
        lostReason: string | null;
        lostNote: string | null;
        createdAt: string;
        actualCloseAt: string | null;
        stageEnteredAt: string;
        ownerUserId: string;
        ownerName: string;
        customerId: string;
        customerName: string;
        customerIndustry: string | null;
        customerSize: string | null;
        customerType: string | null;
        contactId: string | null;
        contactName: string | null;
        contactTitle: string | null;
        contactRole: string | null;
      }>(sql`
        select
          o.id,
          o.name,
          o.stage,
          o.expected_amount::text as "expectedAmount",
          o.actual_amount::text as "actualAmount",
          o.lost_reason as "lostReason",
          o.lost_note as "lostNote",
          o.created_at::text as "createdAt",
          o.actual_close_at::text as "actualCloseAt",
          o.stage_entered_at::text as "stageEnteredAt",
          o.owner_user_id::text as "ownerUserId",
          u.name as "ownerName",
          c.id as "customerId",
          c.name as "customerName",
          c.industry as "customerIndustry",
          c.size as "customerSize",
          c.customer_type as "customerType",
          ct.id as "contactId",
          ct.name as "contactName",
          ct.title as "contactTitle",
          ct.role_tag as "contactRole"
        from opportunities o
        join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        join users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
        left join contacts ct on ct.tenant_id = o.tenant_id and ct.id = o.primary_contact_id
        where o.tenant_id = ${ctx.tenantId}::uuid
          and o.id = ${args.opportunityId}::uuid
          and o.deleted_at is null
      `);

      const opp = oppRes.rows[0];
      if (!opp) {
        return { result: { error: `商机 ${args.opportunityId} 不存在或已被删除` } };
      }

      // SALES 隔离断言
      if (ctx.role === "SALES" && opp.ownerUserId !== ctx.userId) {
        return { result: { error: `FORBIDDEN: 无权查看非本人负责的商机历史` } };
      }

      // 2. 查询阶段流转历史
      const historyRes = await tx.execute<{
        fromStage: string | null;
        toStage: string;
        note: string | null;
        operatorName: string;
        createdAt: string;
      }>(sql`
        select
          h.from_stage as "fromStage",
          h.to_stage as "toStage",
          h.note,
          coalesce(u.name, '系统') as "operatorName",
          h.created_at::text as "createdAt"
        from opportunity_stage_history h
        left join users u on u.tenant_id = h.tenant_id and u.id = h.operator_user_id
        where h.tenant_id = ${ctx.tenantId}::uuid
          and h.opportunity_id = ${args.opportunityId}::uuid
        order by h.created_at asc
      `);

      // 计算各阶段停留天数
      const stageStays: StageStayItem[] = [];
      const historyRows = historyRes.rows;
      if (historyRows.length > 0) {
        for (let i = 0; i < historyRows.length; i++) {
          const current = historyRows[i];
          const next = historyRows[i + 1];
          const enteredAt = new Date(current.createdAt);
          const leftAt = next ? new Date(next.createdAt) : (opp.actualCloseAt ? new Date(opp.actualCloseAt) : new Date());
          const stayDays = Math.max(0.1, Number(((leftAt.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24)).toFixed(1)));
          stageStays.push({
            stage: current.toStage,
            enteredAt: current.createdAt,
            leftAt: next ? next.createdAt : (opp.actualCloseAt || null),
            stayDays,
          });
        }
      } else {
        const enteredAt = new Date(opp.stageEnteredAt || opp.createdAt);
        const leftAt = opp.actualCloseAt ? new Date(opp.actualCloseAt) : new Date();
        const stayDays = Math.max(0.1, Number(((leftAt.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24)).toFixed(1)));
        stageStays.push({
          stage: opp.stage,
          enteredAt: opp.createdAt,
          leftAt: opp.actualCloseAt || null,
          stayDays,
        });
      }

      // 3. 查询跟进活动记录（最近 100 条，避免全量拖慢）
      const actRes = await tx.execute<{
        id: string;
        type: string;
        outcome: string | null;
        summary: string;
        occurredAt: string;
        userName: string;
      }>(sql`
        select
          a.id,
          a.type,
          a.outcome,
          a.summary,
          a.occurred_at::text as "occurredAt",
          coalesce(u.name, '销售人员') as "userName"
        from activities a
        left join users u on u.tenant_id = a.tenant_id and u.id = a.user_id
        where a.tenant_id = ${ctx.tenantId}::uuid
          and a.opportunity_id = ${args.opportunityId}::uuid
        order by a.occurred_at desc
        limit 100
      `);

      // 4. 查询战情室介入指导记录
      const interventionRes = await tx.execute<{
        id: string;
        interventionType: string;
        status: string;
        requestNote: string;
        managerFeedback: string | null;
        coachingNotes: string | null;
        createdAt: string;
        resolvedAt: string | null;
        managerName: string | null;
      }>(sql`
        select
          di.id,
          di.intervention_type as "interventionType",
          di.status,
          di.request_note as "requestNote",
          di.manager_feedback as "managerFeedback",
          di.coaching_notes as "coachingNotes",
          di.created_at::text as "createdAt",
          di.resolved_at::text as "resolvedAt",
          u.name as "managerName"
        from deal_interventions di
        left join users u on u.tenant_id = di.tenant_id and u.id = di.assigned_manager_id
        where di.tenant_id = ${ctx.tenantId}::uuid
          and di.opportunity_id = ${args.opportunityId}::uuid
        order by di.created_at asc
      `);

      // 5. 查询报价明细与合同
      const lineItemsRes = await tx.execute<{
        productName: string;
        productCode: string;
        quantity: number;
        unitPrice: number;
        discountRate: number;
        subtotalAmount: number;
      }>(sql`
        select
          p.name as "productName",
          p.code as "productCode",
          li.quantity,
          li.unit_price as "unitPrice",
          li.discount_rate as "discountRate",
          li.subtotal_amount as "subtotalAmount"
        from opportunity_line_items li
        join products p on p.tenant_id = li.tenant_id and p.id = li.product_id
        where li.tenant_id = ${ctx.tenantId}::uuid
          and li.opportunity_id = ${args.opportunityId}::uuid
      `);

      const contracts = await getPluginFactsProvider()
        .getOpportunityContracts(tx, ctx.tenantId, args.opportunityId)
        .catch(() => []);

      const expectedYuan = opp.expectedAmount ? Number((Number(opp.expectedAmount) / 100).toFixed(2)) : null;
      const actualYuan = opp.actualAmount ? Number((Number(opp.actualAmount) / 100).toFixed(2)) : null;
      let deviation: number | null = null;
      if (expectedYuan && actualYuan && expectedYuan > 0) {
        deviation = Number((((actualYuan - expectedYuan) / expectedYuan) * 100).toFixed(1));
      }

      const historyResult: FullOpportunityHistoryResult = {
        opportunity: {
          id: opp.id,
          name: opp.name,
          stage: opp.stage,
          expectedAmountYuan: expectedYuan,
          actualAmountYuan: actualYuan,
          lostReason: opp.lostReason,
          lostNote: opp.lostNote,
          createdAt: opp.createdAt,
          actualCloseAt: opp.actualCloseAt,
          customer: {
            id: opp.customerId,
            name: opp.customerName,
            industry: opp.customerIndustry,
            size: opp.customerSize,
            customerType: opp.customerType,
          },
          primaryContact: opp.contactId ? {
            id: opp.contactId,
            name: opp.contactName,
            title: opp.contactTitle,
            role: opp.contactRole,
          } : null,
          owner: {
            id: opp.ownerUserId,
            name: opp.ownerName,
          },
        },
        stageHistory: historyRows,
        stageStays,
        activities: actRes.rows,
        dealInterventions: interventionRes.rows,
        quotesAndContracts: {
          lineItems: lineItemsRes.rows.map((li) => ({
            productName: li.productName,
            productCode: li.productCode,
            quantity: li.quantity,
            unitPriceYuan: Number((li.unitPrice / 100).toFixed(2)),
            discountRate: li.discountRate,
            subtotalAmountYuan: Number((li.subtotalAmount / 100).toFixed(2)),
          })),
          initialExpectedAmountYuan: expectedYuan,
          finalActualAmountYuan: actualYuan,
          discountOrDeviationPercent: deviation,
          contracts: contracts.map((c) => ({
            contractNo: c.contractNo,
            title: c.title,
            totalAmountYuan: Number((Number(c.totalAmount) / 100).toFixed(2)),
            status: c.status,
            signDate: c.signDate,
          })),
        },
      };

      return { result: historyResult };
    });
  },
};

export const getLostReasonDistributionTool: AgentTool = {
  name: "getLostReasonDistribution",
  description: "获取租户内按输单原因×客户行业多维聚合的输单分布与金额统计。",
  parameters: z.object({
    timeWindowDays: z.number().int().min(7).max(730).optional().describe("统计时间窗口（天数），默认 365 天"),
  }),
  execute: async (ctx, args) => {
    const days = args.timeWindowDays ?? 365;
    return withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.execute<{
        lostReason: string;
        industry: string;
        count: number;
        totalAmount: string | number;
      }>(sql`
        select
          coalesce(o.lost_reason, 'OTHER') as "lostReason",
          coalesce(c.industry, '未分类行业') as "industry",
          count(*)::int as count,
          coalesce(sum(coalesce(o.expected_amount, o.actual_amount, 0)), 0) as "totalAmount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}::uuid
          and o.stage = 'LOST'
          and o.deleted_at is null
          and o.created_at >= (now() - (${days} || ' days')::interval)
        group by coalesce(o.lost_reason, 'OTHER'), coalesce(c.industry, '未分类行业')
        order by count desc
      `);

      let totalLostCount = 0;
      let totalLostAmountYuan = 0;
      const reasonMap = new Map<string, { count: number; totalAmountYuan: number }>();

      const byIndustryAndReason = rows.rows.map((r) => {
        const amountYuan = Number((Number(r.totalAmount) / 100).toFixed(2));
        totalLostCount += r.count;
        totalLostAmountYuan += amountYuan;

        const cur = reasonMap.get(r.lostReason) || { count: 0, totalAmountYuan: 0 };
        cur.count += r.count;
        cur.totalAmountYuan += amountYuan;
        reasonMap.set(r.lostReason, cur);

        return {
          industry: r.industry,
          reason: r.lostReason,
          count: r.count,
          totalAmountYuan: amountYuan,
        };
      });

      const byReason = Array.from(reasonMap.entries()).map(([reason, stats]) => ({
        reason,
        count: stats.count,
        totalAmountYuan: Number(stats.totalAmountYuan.toFixed(2)),
        percentage: totalLostCount > 0 ? Number(((stats.count / totalLostCount) * 100).toFixed(1)) : 0,
      })).sort((a, b) => b.count - a.count);

      return {
        result: {
          timeWindowDays: days,
          totalLostDeals: totalLostCount,
          totalLostAmountYuan: Number(totalLostAmountYuan.toFixed(2)),
          byReason,
          byIndustryAndReason,
        },
      };
    });
  },
};

export const getPeerWinPatternsTool: AgentTool = {
  name: "getPeerWinPatterns",
  description: "获取同行业、同量级已赢单商机的成功共性基准（成交周期中位数、战情室介入率、平均跟进频次、折扣习惯等）。",
  parameters: z.object({
    industry: z.string().optional().describe("客户所属行业，如 '智能制造'、'企业服务' 等"),
    amountBand: z.string().optional().describe("金额带过滤，如 '0-100k', '100k-500k', '500k+'"),
  }),
  execute: async (ctx, args) => {
    return withTenant(ctx.tenantId, async (tx) => {
      let amountBandSql = sql``;
      if (args.amountBand) {
        if (args.amountBand === "0-100k" || args.amountBand === "<100k") {
          amountBandSql = sql`and coalesce(o.actual_amount, o.expected_amount, 0) < 10000000`;
        } else if (args.amountBand === "100k-500k") {
          amountBandSql = sql`and coalesce(o.actual_amount, o.expected_amount, 0) >= 10000000 and coalesce(o.actual_amount, o.expected_amount, 0) < 50000000`;
        } else if (args.amountBand === "500k+" || args.amountBand === ">=500k") {
          amountBandSql = sql`and coalesce(o.actual_amount, o.expected_amount, 0) >= 50000000`;
        }
      }

      const rows = await tx.execute<{
        id: string;
        actualAmount: string | null;
        cycleDays: string | number;
        activityCount: string | number;
        interventionCount: string | number;
        avgDiscountRate: string | number | null;
      }>(sql`
        select
          o.id,
          o.actual_amount::text as "actualAmount",
          greatest(1, round(extract(epoch from (coalesce(o.actual_close_at::timestamp, o.updated_at) - o.created_at)) / 86400)) as "cycleDays",
          coalesce(act.cnt,0)::int as "activityCount",
          coalesce(di.cnt,0)::int as "interventionCount",
          disc."avgDiscountRate"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        left join (select opportunity_id, count(*) as cnt from activities where tenant_id = ${ctx.tenantId}::uuid group by opportunity_id) act on act.opportunity_id = o.id
        left join (select opportunity_id, count(*) as cnt from deal_interventions where tenant_id = ${ctx.tenantId}::uuid group by opportunity_id) di on di.opportunity_id = o.id
        left join (select opportunity_id, avg(discount_rate)::numeric(5,2) as "avgDiscountRate" from opportunity_line_items where tenant_id = ${ctx.tenantId}::uuid group by opportunity_id) disc on disc.opportunity_id = o.id
        where o.tenant_id = ${ctx.tenantId}::uuid
          and o.stage = 'WON'
          and o.deleted_at is null
          ${args.industry ? sql`and c.industry = ${args.industry}` : sql``}
          ${amountBandSql}
        limit 200
      `);

      const sampleSize = rows.rows.length;
      if (sampleSize === 0) {
        return {
          result: {
            sampleSize: 0,
            hasSufficientData: false,
            message: "当前行业或租户内暂无足够已赢单样本（N=0）",
            medianCycleDays: null,
            avgCycleDays: null,
            medianActivityCount: null,
            avgActivityCount: null,
            avgDiscountRate: null,
            avg_discount_rate: null,
            interventionRatePercent: null,
          },
        };
      }

      const cycleDaysList = rows.rows.map((r) => Number(r.cycleDays)).sort((a, b) => a - b);
      const activityCountList = rows.rows.map((r) => Number(r.activityCount)).sort((a, b) => a - b);
      const withInterventionCount = rows.rows.filter((r) => Number(r.interventionCount) > 0).length;
      const discounts = rows.rows
        .map((r) => (r.avgDiscountRate !== null ? Number(r.avgDiscountRate) : null))
        .filter((d): d is number => d !== null);
      const avgDiscountRate = discounts.length > 0 ? Number((discounts.reduce((s, v) => s + v, 0) / discounts.length).toFixed(1)) : null;

      const median = (arr: number[]) => {
        const mid = Math.floor(arr.length / 2);
        return arr.length % 2 !== 0 ? arr[mid] : Number(((arr[mid - 1] + arr[mid]) / 2).toFixed(1));
      };
      const avg = (arr: number[]) => Number((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1));

      const medianCycleDays = median(cycleDaysList);
      const avgCycleDays = avg(cycleDaysList);
      const medianActivityCount = median(activityCountList);
      const avgActivityCount = avg(activityCountList);
      const interventionRatePercent = Number(((withInterventionCount / sampleSize) * 100).toFixed(1));

      return {
        result: {
          sampleSize,
          hasSufficientData: sampleSize >= 3,
          industry: args.industry || "全行业汇总",
          amountBand: args.amountBand || "全金额段",
          medianCycleDays,
          avgCycleDays,
          medianActivityCount,
          avgActivityCount,
          avgDiscountRate,
          avg_discount_rate: avgDiscountRate,
          withInterventionCount,
          interventionRatePercent,
          confidenceLevel: sampleSize >= 10 ? "HIGH" : (sampleSize >= 3 ? "MEDIUM" : "LOW"),
        },
      };
    });
  },
};
