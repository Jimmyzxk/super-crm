import { z } from "zod";
import { AgentTool } from "./types";
import { withTenant } from "@/core/tenant";
import { sql } from "drizzle-orm";
import { getPluginFactsProvider } from "@/core/plugin-facts";

export const customerRevenueTieringTool: AgentTool = {
  name: "customerRevenueTiering",
  description: "查询客户按累计营收分层（零贡献 ZERO / 低 LOW / 中 MEDIUM / 高 HIGH）×最近互动时间×行业的数据，直接支撑存量激活策略",
  parameters: z.object({
    tier: z.enum(["ZERO", "LOW", "MEDIUM", "HIGH"]).optional().describe("按营收分层筛选：ZERO=0, LOW<10万, MEDIUM=10-100万, HIGH>=100万"),
    limit: z.number().optional().default(10).describe("返回条数限制，默认 10")
  }),
  execute: async (ctx, args) => {
    return withTenant(ctx.tenantId, async (tx) => {
      const { tier, limit = 10 } = (args || {}) as { tier?: "ZERO" | "LOW" | "MEDIUM" | "HIGH"; limit?: number };
      const factsProvider = getPluginFactsProvider();

      // 1. 获取插件侧订单营收事实（若未注册则为空）
      const orderFacts = await factsProvider.getCustomerOrderRevenues(tx, ctx.tenantId).catch(() => []);
      const orderRevMap = new Map<string, number>();
      for (const f of orderFacts) {
        orderRevMap.set(f.customerId, Number(f.orderRevenue) || 0);
      }

      // 2. 获取核心业务客户与赢单商机营收
      const coreCustRes = await tx.execute<{
        id: string;
        name: string;
        industry: string | null;
        lastActivityAt: string | null;
        oppRevenue: string | number;
      }>(sql`
        select
          c.id,
          c.name,
          c.industry,
          c.last_activity_at as "lastActivityAt",
          coalesce(sum(case when opp.stage = 'WON' then coalesce(opp.actual_amount, opp.expected_amount, 0) else 0 end), 0)::bigint as "oppRevenue"
        from customers c
        left join opportunities opp on opp.customer_id = c.id and opp.tenant_id = c.tenant_id and opp.deleted_at is null
        where c.tenant_id = ${ctx.tenantId}::uuid and c.deleted_at is null
        group by c.id, c.name, c.industry, c.last_activity_at
      `);

      // 3. 计算综合营收与分层
      const categorized = coreCustRes.rows.map((c) => {
        const orderRev = orderRevMap.get(c.id) || 0;
        const oppRev = Number(c.oppRevenue) || 0;
        const totalRevenueCents = Math.max(orderRev, oppRev);

        let t: "ZERO" | "LOW" | "MEDIUM" | "HIGH" = "ZERO";
        if (totalRevenueCents === 0) {
          t = "ZERO";
        } else if (totalRevenueCents < 10000000) {
          t = "LOW";
        } else if (totalRevenueCents < 100000000) {
          t = "MEDIUM";
        } else {
          t = "HIGH";
        }

        return {
          id: c.id,
          name: c.name,
          industry: c.industry,
          lastActivityAt: c.lastActivityAt,
          totalRevenueCents,
          tier: t,
        };
      });

      // 4. 筛选与排序（与原 SQL 语义一致）
      const filtered = tier ? categorized.filter((item) => item.tier === tier) : categorized;

      filtered.sort((a, b) => {
        if (tier === "ZERO") {
          const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : -Infinity;
          const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : -Infinity;
          if (aTime !== bTime) return bTime - aTime;
          return a.name.localeCompare(b.name);
        } else {
          if (a.totalRevenueCents !== b.totalRevenueCents) {
            return b.totalRevenueCents - a.totalRevenueCents;
          }
          const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : -Infinity;
          const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : -Infinity;
          return bTime - aTime;
        }
      });

      const sliced = filtered.slice(0, limit);

      return {
        result: sliced.map((r) => ({
          id: r.id,
          name: r.name,
          industry: r.industry,
          lastActivityAt: r.lastActivityAt,
          totalRevenue: r.totalRevenueCents / 100,
          tier: r.tier,
        })),
      };
    });
  }
};

export const crossSellCandidatesTool: AgentTool = {
  name: "crossSellCandidates",
  description: "已购产品线 × 产品目录交叉矩阵，找出买了A产品但未购买B产品的客户清单（交叉销售候选），返回已购清单与推荐新产品及依据",
  parameters: z.object({
    limit: z.number().optional().default(5).describe("返回条数限制，默认 5")
  }),
  execute: async (ctx, args) => {
    return withTenant(ctx.tenantId, async (tx) => {
      const { limit = 5 } = (args || {}) as { limit?: number };
      const factsProvider = getPluginFactsProvider();

      // 1. 获取插件侧订单明细的产品事实
      const orderBoughtProducts = await factsProvider.getCustomerBoughtProducts(tx, ctx.tenantId).catch(() => []);

      // 2. 获取核心已赢单商机中的产品（包含 line items 与 intended_product）
      const coreOppProductsRes = await tx.execute<{
        customerId: string;
        customerName: string;
        category: string | null;
        code: string | null;
      }>(sql`
        select c.id as "customerId", c.name as "customerName", p.category, p.code
        from customers c
        join opportunities opp on opp.customer_id = c.id and opp.tenant_id = c.tenant_id and opp.stage = 'WON' and opp.deleted_at is null
        join opportunity_line_items oli on oli.opportunity_id = opp.id and oli.tenant_id = c.tenant_id
        join products p on oli.product_id = p.id and p.tenant_id = c.tenant_id and p.deleted_at is null
        where c.tenant_id = ${ctx.tenantId}::uuid and c.deleted_at is null

        union

        select c.id as "customerId", c.name as "customerName", p.category, p.code
        from customers c
        join opportunities opp on opp.customer_id = c.id and opp.tenant_id = c.tenant_id and opp.stage = 'WON' and opp.deleted_at is null
        join products p on opp.intended_product_id = p.id and p.tenant_id = c.tenant_id and p.deleted_at is null
        where c.tenant_id = ${ctx.tenantId}::uuid and c.deleted_at is null
      `);

      // 3. 聚合所有已购产品
      const allBought = [...orderBoughtProducts, ...coreOppProductsRes.rows];
      const customerMap = new Map<string, {
        customerId: string;
        customerName: string;
        categories: Set<string>;
        codes: Set<string>;
      }>();

      for (const item of allBought) {
        let entry = customerMap.get(item.customerId);
        if (!entry) {
          entry = {
            customerId: item.customerId,
            customerName: item.customerName,
            categories: new Set<string>(),
            codes: new Set<string>(),
          };
          customerMap.set(item.customerId, entry);
        }
        if (item.category) entry.categories.add(item.category);
        if (item.code) entry.codes.add(item.code);
      }

      const productsRes = await tx.execute<{ code: string; name: string; category: string }>(sql`
        select code, name, category 
        from products 
        where tenant_id = ${ctx.tenantId}::uuid and deleted_at is null and status = 'ACTIVE'
        order by created_at asc
      `);
      const allProducts = productsRes.rows;

      const sortedCustomers = Array.from(customerMap.values()).sort((a, b) =>
        a.customerId.localeCompare(b.customerId)
      );
      const sliced = sortedCustomers.slice(0, limit);

      return {
        result: sliced.map((cp) => {
          const boughtCodes = Array.from(cp.codes);
          const unbought = allProducts.filter((p) => !boughtCodes.includes(p.code));
          return {
            customerId: cp.customerId,
            customerName: cp.customerName,
            boughtCategories: Array.from(cp.categories),
            boughtCodes,
            fullyCovered: unbought.length === 0,
            recommendation: unbought.length > 0 ? unbought[0] : null,
          };
        }),
      };
    });
  }
};

export const dormantHighValueTool: AgentTool = {
  name: "dormantHighValue",
  description: "查询历史有真实营收但超过 60 天无任何跟进互动的客户（沉睡高价值客群），返回客户名称、历史营收、沉睡天数与最后跟进时间",
  parameters: z.object({
    limit: z.number().optional().default(5).describe("返回条数限制，默认 5")
  }),
  execute: async (ctx, args) => {
    return withTenant(ctx.tenantId, async (tx) => {
      const { limit = 5 } = (args || {}) as { limit?: number };
      const factsProvider = getPluginFactsProvider();

      // 1. 获取插件侧订单营收事实
      const orderFacts = await factsProvider.getCustomerOrderRevenues(tx, ctx.tenantId).catch(() => []);
      const orderRevMap = new Map<string, number>();
      for (const f of orderFacts) {
        orderRevMap.set(f.customerId, Number(f.orderRevenue) || 0);
      }

      // 2. 核心客户与赢单商机（过滤超过 60 天无互动）
      const res = await tx.execute<{
        id: string;
        name: string;
        lastActivityAt: string | null;
        dormantDays: number;
        oppRevenue: string | number;
      }>(sql`
        select
          c.id,
          c.name,
          c.last_activity_at as "lastActivityAt",
          extract(day from (now() - coalesce(c.last_activity_at, now() - interval '90 days')))::int as "dormantDays",
          coalesce(sum(case when opp.stage = 'WON' then coalesce(opp.actual_amount, opp.expected_amount, 0) else 0 end), 0)::bigint as "oppRevenue"
        from customers c
        left join opportunities opp on opp.customer_id = c.id and opp.tenant_id = c.tenant_id and opp.deleted_at is null
        where c.tenant_id = ${ctx.tenantId}::uuid and c.deleted_at is null
          and (c.last_activity_at is null or c.last_activity_at < now() - interval '60 days')
        group by c.id, c.name, c.last_activity_at
      `);

      // 3. 计算综合营收，过滤 totalRevenue > 0
      const matched = res.rows
        .map((r) => {
          const orderRev = orderRevMap.get(r.id) || 0;
          const oppRev = Number(r.oppRevenue) || 0;
          const totalRevenueCents = Math.max(orderRev, oppRev);
          return {
            id: r.id,
            name: r.name,
            lastActivityAt: r.lastActivityAt,
            totalRevenueCents,
            dormantDays: typeof r.dormantDays === "number" ? r.dormantDays : 90,
          };
        })
        .filter((r) => r.totalRevenueCents > 0);

      matched.sort((a, b) => b.totalRevenueCents - a.totalRevenueCents);
      const sliced = matched.slice(0, limit);

      return {
        result: sliced.map((r) => ({
          id: r.id,
          name: r.name,
          lastActivityAt: r.lastActivityAt,
          totalRevenue: r.totalRevenueCents / 100,
          dormantDays: r.dormantDays,
        })),
      };
    });
  }
};

export const renewalPipelineTool: AgentTool = {
  name: "renewalPipeline",
  description: "查询在指定天数内即将到期的合同（如 30/60/90/180 天内），包含合同编号、客户名称、合同金额与到期日，用于续约商机挖掘",
  parameters: z.object({
    days: z.number().optional().default(90).describe("临期天数范围（如 30, 60, 90, 180，默认 90）"),
    limit: z.number().optional().default(5).describe("返回条数限制，默认 5")
  }),
  execute: async (ctx, args) => {
    return withTenant(ctx.tenantId, async (tx) => {
      const { days = 90, limit = 5 } = (args || {}) as { days?: number; limit?: number };
      const factsProvider = getPluginFactsProvider();

      const contracts = await factsProvider.getRenewalContracts(tx, ctx.tenantId, days, limit).catch(() => []);

      return {
        result: contracts.map((c) => ({
          id: c.id,
          contractNo: c.contractNo,
          title: c.title,
          endDate: c.endDate,
          customerName: c.customerName,
          totalAmount: Number(c.totalAmount) / 100,
        })),
      };
    });
  }
};
