import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 插件事实接口解耦验证 —— 开源版（AGPL-3.0）只保留「插件缺席路径」
 *
 * 开源版不编译任何业务插件，`@/plugin-kit/facts`（真实事实提供者，随闭源插件一同移除）
 * 在运行时不存在。`src/core/plugin-facts/index.ts` 的惰性 require 必须安全降级到
 * `defaultPluginFactsProvider`（全部返回空事实），从而保证：
 *   - 晨检报告不出现合同/账期/里程碑段落
 *   - Growth AI 工具在无插件证据时仍可执行且不误判
 *   - 客户详情与归因工具的商业/合同事实为空，核心数据完整
 * 原「插件在场路径」（写 plugin_contracts / plugin_orders / plugin_projects 并断言真实
 * 穿透）随闭源插件一并移除。
 */

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) {
  throw new Error("插件事实接口测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
}
process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const db = new pg.Client({ connectionString: migrationUrl });

// 动态加载的模块（避免在 env 生效前静态导入 db/client 导致池指向开发库）
let defaultPluginFactsProvider: typeof import("@/core/plugin-facts").defaultPluginFactsProvider;
let registerPluginFactsProvider: typeof import("@/core/plugin-facts").registerPluginFactsProvider;
let getPluginFactsProvider: typeof import("@/core/plugin-facts").getPluginFactsProvider;
let buildDailyInspectionReport: typeof import("@/core/insight/daily-inspection").buildDailyInspectionReport;
let getCustomerDetailService: typeof import("@/core/customer/service").getCustomerDetailService;
let getOpportunityFullHistoryTool: typeof import("@/core/ai-hub/tools/attribution").getOpportunityFullHistoryTool;
let customerRevenueTieringTool: typeof import("@/core/ai-hub/tools/growth").customerRevenueTieringTool;
let crossSellCandidatesTool: typeof import("@/core/ai-hub/tools/growth").crossSellCandidatesTool;
let dormantHighValueTool: typeof import("@/core/ai-hub/tools/growth").dormantHighValueTool;
let renewalPipelineTool: typeof import("@/core/ai-hub/tools/growth").renewalPipelineTool;
let withTenant: typeof import("@/core/tenant").withTenant;
type TenantContext = import("@/core/tenant").TenantContext;

describe("插件事实接口解耦验证 (插件缺席路径 / 开源版默认实现)", () => {
  let tenantId: string;
  let adminUserId: string;
  let customerAId: string;
  let opportunityId: string;
  let adminCtx: TenantContext;
  const rand = Math.random().toString(36).substring(2, 8);
  const ts = Date.now();

  beforeAll(async () => {
    // 先动态导入，确保 DATABASE_URL 已指向测试库
    const pluginFactsMod = await import("@/core/plugin-facts");
    defaultPluginFactsProvider = pluginFactsMod.defaultPluginFactsProvider;
    registerPluginFactsProvider = pluginFactsMod.registerPluginFactsProvider;
    getPluginFactsProvider = pluginFactsMod.getPluginFactsProvider;
    buildDailyInspectionReport = (await import("@/core/insight/daily-inspection")).buildDailyInspectionReport;
    getCustomerDetailService = (await import("@/core/customer/service")).getCustomerDetailService;
    getOpportunityFullHistoryTool = (await import("@/core/ai-hub/tools/attribution")).getOpportunityFullHistoryTool;
    const growthMod = await import("@/core/ai-hub/tools/growth");
    customerRevenueTieringTool = growthMod.customerRevenueTieringTool;
    crossSellCandidatesTool = growthMod.crossSellCandidatesTool;
    dormantHighValueTool = growthMod.dormantHighValueTool;
    renewalPipelineTool = growthMod.renewalPipelineTool;
    withTenant = (await import("@/core/tenant")).withTenant;

    await db.connect();

    const tenantRes = await db.query<{ id: string }>(
      `insert into tenants (name) values ('Facts Provider Test Tenant') returning id`
    );
    tenantId = tenantRes.rows[0].id;

    const userRes = await db.query<{ id: string }>(
      `insert into users (tenant_id, email, password_hash, name, role)
       values ($1, $2, 'hash', 'Test Admin', 'ADMIN') returning id`,
      [tenantId, `admin_facts_${ts}_${rand}@test.com`]
    );
    adminUserId = userRes.rows[0].id;

    adminCtx = {
      tenantId,
      userId: adminUserId,
      role: "ADMIN",
    };

    const custRes = await db.query<{ id: string }>(
      `insert into customers (tenant_id, name, industry, owner_user_id, last_activity_at)
       values ($1, '事实测试企业客户', '软件和信息技术', $2, now() - interval '95 days') returning id`,
      [tenantId, adminUserId]
    );
    customerAId = custRes.rows[0].id;

    const oppRes = await db.query<{ id: string }>(
      `insert into opportunities (tenant_id, customer_id, name, stage, expected_amount, owner_user_id)
       values ($1, $2, '事实测试商机', 'PROPOSAL', 6000000, $3) returning id`,
      [tenantId, customerAId, adminUserId]
    );
    opportunityId = oppRes.rows[0].id;

    await db.query(
      `insert into products (tenant_id, name, code, category, unit_price, status)
       values ($1, '智能商业套件', $2, '软件系统', 5000000, 'ACTIVE') returning id`,
      [tenantId, `PROD-FACT-${ts}`]
    );
  });

  afterAll(async () => {
    if (tenantId) {
      const tables = [
        "ai_agent_traces",
        "ai_recommendations",
        "notifications",
        "opportunities",
        "products",
        "customers",
        "users",
      ];
      for (const tbl of tables) {
        await db.query(`delete from ${tbl} where tenant_id = $1`, [tenantId]).catch(() => {});
      }
      await db.query(`delete from tenants where id = $1`, [tenantId]).catch(() => {});
    }
    await db.end();
  });

  describe("路径 1: 插件缺席路径 (走 Core 默认空实现)", () => {
    beforeAll(() => {
      // 显式注销提供者，强制走默认空实现
      registerPluginFactsProvider(null);
    });

    it("1.0 开源版不存在 @/plugin-kit/facts，惰性加载安全降级到默认提供者", async () => {
      // 惰性 require 的目标文件已随闭源插件整体移除（结构断言，避免运行期 require 语义差异）
      const fs = await import("node:fs");
      const path = await import("node:path");
      expect(fs.existsSync(path.resolve(process.cwd(), "src/plugin-kit/facts.ts"))).toBe(false);

      // 未显式注册真实提供者时，惰性加载失败必须被吞掉并回落到 core 默认实现
      registerPluginFactsProvider(undefined as never);
      const provider = getPluginFactsProvider();
      expect(provider.getExpiringContracts).toBeTypeOf("function");
      expect(provider.getCustomerCommerceFacts).toBeTypeOf("function");
      await withTenant(tenantId, async (tx) => {
        expect(await provider.getRenewalContracts(tx, tenantId, 30, 10)).toEqual([]);
      });
      // 复位为显式注销，后续用例继续走默认空实现
      registerPluginFactsProvider(null);
    });

    it("1.1 默认提供者返回空事实，且晨检报告注入空事实时不包含合同/账期/项目段落", async () => {
      // 1. 直接测试 defaultPluginFactsProvider 的各个接缝方法返回空数组/空对象
      await withTenant(tenantId, async (tx) => {
        expect(await defaultPluginFactsProvider.getExpiringContracts(tx, tenantId, "2026-10-01", 10)).toEqual([]);
        expect(await defaultPluginFactsProvider.getOverduePaymentSchedules(tx, tenantId, "2026-09-09", 10)).toEqual([]);
        expect(await defaultPluginFactsProvider.getDelayedMilestones(tx, tenantId, "2026-09-09", 10)).toEqual([]);
        expect(await defaultPluginFactsProvider.getCustomerOrderRevenues(tx, tenantId)).toEqual([]);
        expect(await defaultPluginFactsProvider.getCustomerBoughtProducts(tx, tenantId)).toEqual([]);
        expect(await defaultPluginFactsProvider.getRenewalContracts(tx, tenantId, 30, 10)).toEqual([]);
        expect(await defaultPluginFactsProvider.getOpportunityContracts(tx, tenantId, opportunityId)).toEqual([]);
        expect(await defaultPluginFactsProvider.getCustomerCommerceFacts(tx, tenantId, customerAId)).toEqual({
          contracts: [],
          orders: [],
          projects: [],
        });
      });

      // 2. 晨检报告生成函数在注入空事实时，只生成商机段，无合同/账期/里程碑段落
      const report = buildDailyInspectionReport(
        {
          riskDeals: [
            { name: "测试风险商机", ownerName: "Test Admin", stage: "PROPOSAL", amount: 6000000 },
          ],
          expiringContracts: [],
          overdueSchedules: [],
          delayedMilestones: [],
        },
        "2026-09-09",
      );

      expect(report.title).toContain("商脉AI 晨会智能巡检战报");
      expect(report.markdownContent).toContain("停滞与高风险商机");
      expect(report.markdownContent).not.toContain("临期合同");
      expect(report.markdownContent).not.toContain("逾期未回款账单");
      expect(report.markdownContent).not.toContain("延期交付里程碑");
    });

    it("1.2 Growth AI 工具在插件缺席时返回空证据且正常执行", async () => {
      // 营收分层工具：无订单数据时按 0 营收处理，不报错
      const tieringRes = (await customerRevenueTieringTool.execute(adminCtx, { limit: 10 })) as {
        result: Array<{ id: string; totalRevenue: number; tier: string }>;
      };
      expect(tieringRes).toBeDefined();
      const foundCustomer = tieringRes.result.find((c) => c.id === customerAId);
      if (foundCustomer) {
        expect(foundCustomer.totalRevenue).toBe(0);
      }

      // 交叉销售工具：无已购商品数据时返回空 boughtCodes
      const crossRes = (await crossSellCandidatesTool.execute(adminCtx, { limit: 10 })) as {
        result: Array<{ customerId: string; boughtCodes: string[] }>;
      };
      expect(crossRes).toBeDefined();

      // 沉睡客户工具：无订单营收时不会误判为高价值沉睡客户
      const dormantRes = (await dormantHighValueTool.execute(adminCtx, { limit: 10 })) as {
        result: Array<{ id: string }>;
      };
      expect(dormantRes.result.some((c) => c.id === customerAId)).toBe(false);

      // 续约管道工具：返回空列表
      const renewalRes = (await renewalPipelineTool.execute(adminCtx, { days: 30, limit: 10 })) as {
        result: Array<unknown>;
      };
      expect(renewalRes.result).toHaveLength(0);
    });

    it("1.3 客户详情与归因工具在插件缺席时返回空商业/合同事实，保持核心数据完整", async () => {
      // 客户详情：commerce.contracts, orders, projects 均为空数组
      const custDetail = await getCustomerDetailService(adminCtx, customerAId);
      expect(custDetail).toBeDefined();
      expect(custDetail.customer.id).toBe(customerAId);
      expect(custDetail.commerce).toBeDefined();
      expect(custDetail.commerce?.contracts).toHaveLength(0);
      expect(custDetail.commerce?.orders).toHaveLength(0);
      expect(custDetail.commerce?.projects).toHaveLength(0);

      // 归因全景历史工具：quotesAndContracts.contracts 为空数组
      const historyRes = (await getOpportunityFullHistoryTool.execute(adminCtx, { opportunityId })) as {
        result: {
          quotesAndContracts?: {
            contracts: unknown[];
          };
        };
      };
      expect(historyRes.result.quotesAndContracts?.contracts).toHaveLength(0);
    });
  });
});
