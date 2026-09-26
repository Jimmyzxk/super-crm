import "dotenv/config";
import pg from "pg";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * 开源版（AGPL-3.0）核心完整性回归 —— 由原「插件体系数据库迁移 / RLS / 离职交接」与
 * 「三大插件综合集成」两个文件剥离而来，只保留**核心**断言：
 *   - plugin_registry / plugin_rate_limits 两张插件框架基础设施表仍可用
 *   - 插件装配点为空框架时，上游调用点（导航 / 详情挂载 / 设置分区）优雅降级
 *   - 无任何已注册离职交接钩子时，offboard 流程不报错
 *   - lead_source_keys 结构化列 + OpenAPI Scope 鉴权
 *   - leads 结构化渠道与 UTM 归因
 * 已随闭源插件（合同 / 订单 / 项目 / 表单采集 / 知识库 / 智能分发 / BI）移除的
 * 表级断言不再验证：这些表在本仓库的迁移中根本不存在。
 */

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

let withTenant: typeof import("@/core/tenant").withTenant;
let offboardMemberAndTransferAssetsService: typeof import("@/core/team/service").offboardMemberAndTransferAssetsService;
type TenantContext = import("@/core/tenant").TenantContext;

describe("开源版核心完整性：插件框架基础设施 + OpenAPI 鉴权 + 渠道归因", () => {
  let tenantAId: string;
  let adminAId: string;
  let salesA1Id: string;
  const ts = Date.now();

  beforeAll(async () => {
    await owner.connect();

    const tenantModule = await import("@/core/tenant");
    withTenant = tenantModule.withTenant;

    const teamModule = await import("@/core/team/service");
    offboardMemberAndTransferAssetsService = teamModule.offboardMemberAndTransferAssetsService;

    const tARes = await owner.query<{ id: string }>(`
      insert into tenants (name, status) values ('开源版核心测试租户A', 'ACTIVE') returning id
    `);
    tenantAId = tARes.rows[0].id;

    const adminRes = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, name, role, status, password_hash)
      values ($1, $2, '租户A管理员', 'ADMIN', 'ACTIVE', 'hashed') returning id
    `, [tenantAId, `admin_oss_${ts}@test.com`]);
    adminAId = adminRes.rows[0].id;

    const sales1Res = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, name, role, status, password_hash)
      values ($1, $2, '销售甲', 'SALES', 'ACTIVE', 'hashed') returning id
    `, [tenantAId, `sales_oss_1_${ts}@test.com`]);
    salesA1Id = sales1Res.rows[0].id;
  });

  afterAll(async () => {
    if (tenantAId) {
      await owner.query(`delete from audit_logs where tenant_id = $1`, [tenantAId]);
      await owner.query(`delete from opportunities where tenant_id = $1`, [tenantAId]);
      await owner.query(`delete from customers where tenant_id = $1`, [tenantAId]);
      await owner.query(`delete from tasks where tenant_id = $1`, [tenantAId]);
      await owner.query(`delete from lead_status_history where tenant_id = $1`, [tenantAId]);
      await owner.query(`delete from leads where tenant_id = $1`, [tenantAId]);
      await owner.query(`delete from lead_source_keys where tenant_id = $1`, [tenantAId]);
      await owner.query(`delete from users where tenant_id = $1`, [tenantAId]);
      await owner.query(`delete from plugin_registry where tenant_id = $1`, [tenantAId]);
      await owner.query(`delete from tenants where id = $1`, [tenantAId]);
    }
    await owner.end();
  });

  describe("1. 插件框架基础设施表（plugin_registry / plugin_rate_limits）", () => {
    it("plugin_registry 仍由迁移建出且 RLS 强制开启（非插件实现，属框架启停开关）", async () => {
      const r = await owner.query<{ rls: boolean; forced: boolean }>(`
        select c.relrowsecurity as rls, c.relforcerowsecurity as forced
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'plugin_registry'
      `);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].rls).toBe(true);
      expect(r.rows[0].forced).toBe(true);
    });

    it("plugin_rate_limits 仍由迁移建出（多副本原子限流基础设施）", async () => {
      const r = await owner.query<{ n: number }>(`
        select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_name = 'plugin_rate_limits'
      `);
      expect(r.rows[0].n).toBe(1);
    });

    it("已移除的 23 张业务插件表在开源版数据库中确实不存在", async () => {
      const removed = [
        "plugin_contracts", "plugin_contract_approvals", "plugin_contract_revisions", "plugin_contract_templates",
        "plugin_orders", "plugin_order_items", "plugin_order_invoices", "plugin_order_payment_schedules",
        "plugin_order_payment_transactions", "plugin_order_revenue_schedules",
        "plugin_projects", "plugin_project_order_links", "plugin_project_milestones",
        "plugin_ai_bi_reports",
        "plugin_form_definitions", "plugin_form_submissions", "plugin_form_submission_links",
        "knowledge_base_articles", "knowledge_base_article_likes", "knowledge_base_categories",
        "knowledge_base_chunks", "knowledge_base_tags",
        "lead_routing_rules", "lead_routing_logs",
      ];
      const r = await owner.query<{ table_name: string }>(`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any($1::text[])
      `, [removed]);
      expect(r.rows).toEqual([]);
    });

    it("核心表仍然齐备（抽样断言：线索/客户/商机/用户/租户/审计）", async () => {
      const kept = ["tenants", "users", "leads", "customers", "opportunities", "audit_logs", "tasks"];
      const r = await owner.query<{ table_name: string }>(`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any($1::text[])
      `, [kept]);
      expect(r.rows.map((x) => x.table_name).sort()).toEqual([...kept].sort());
    });

    it("插件启停写入仍走 plugin_registry，且启停状态可被 getPluginEnabledState 读取", async () => {
      const { togglePluginAction } = await import("@/plugin-kit/actions");
      const { getPluginEnabledState, ALL_REGISTERED_PLUGIN_KEYS } = await import("@/plugin-kit/server");

      // 开源版不编译任何业务插件，故注册表 key 全集为空
      expect(ALL_REGISTERED_PLUGIN_KEYS).toEqual([]);

      const adminCtx: TenantContext = { tenantId: tenantAId, userId: adminAId, role: "ADMIN" };
      const { sql } = await import("drizzle-orm");
      await withTenant(tenantAId, async (tx) => {
        await tx.execute(sql`insert into plugin_registry (tenant_id, plugin_key, enabled) values (${tenantAId}::uuid, 'demo-plugin', true)`);
      });
      expect(await getPluginEnabledState(tenantAId, "demo-plugin")).toBe(true);
      expect(typeof togglePluginAction).toBe("function");
      expect(adminCtx.role).toBe("ADMIN");

      // 清理演示注册行，避免污染后续「无启用插件」断言
      await owner.query(`delete from plugin_registry where tenant_id = $1 and plugin_key = 'demo-plugin'`, [tenantAId]);
    });
  });

  describe("2. 空插件框架的优雅降级", () => {
    it("listCompiledPlugins 为空，所有挂载/导航/设置分区查询返回空数组", async () => {
      const registry = await import("@/plugin-kit/registry");
      expect(registry.listCompiledPlugins()).toEqual([]);
      expect(registry.listEnabledPluginNavigation(["contracts", "orders"], "ADMIN")).toEqual([]);
      expect(registry.listEnabledPluginNavigation([], "ADMIN")).toEqual([]);
      expect(registry.listEnabledLeadDetailPanels(["knowledge-base"])).toEqual([]);
      expect(registry.listEnabledOpportunityDetailTabs(["orders"])).toEqual([]);
      expect(registry.listPluginSettingsSections()).toEqual([]);
    });

    it("listEnabledPluginKeys 在无启用插件时返回空数组（导航不出现幽灵入口）", async () => {
      const { listEnabledPluginKeys } = await import("@/plugin-kit/server");
      const ctx: TenantContext = { tenantId: tenantAId, userId: adminAId, role: "ADMIN" };
      await expect(listEnabledPluginKeys(ctx)).resolves.toEqual([]);
    });

    it("无已注册离职交接钩子时，offboard 流程正常完成且不产生插件迁移记录", async () => {
      const { runPluginOffboardHooks } = await import("@/plugin-kit/server");
      const adminCtx: TenantContext = { tenantId: tenantAId, userId: adminAId, role: "ADMIN" };

      const before = await owner.query<{ n: number }>(`select count(*)::int as n from opportunities where tenant_id = $1`, [tenantAId]);

      const result = await withTenant(tenantAId, async (tx) =>
        runPluginOffboardHooks(tx, adminCtx, salesA1Id, adminAId),
      );
      expect(result).toEqual([]);

      const after = await owner.query<{ n: number }>(`select count(*)::int as n from opportunities where tenant_id = $1`, [tenantAId]);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });
  });

  describe("3. Open API 凭证列完整性验证 (lead_source_keys)", () => {
    it("lead_source_keys 包含 scopes, rate_limit_per_minute, allowed_ip_ranges 列", async () => {
      const crypto = await import("node:crypto");
      const validHash = crypto.createHash("sha256").update(`token_${ts}`).digest("hex");
      const tokenRes = await owner.query<{ id: string; scopes: string[]; rate_limit_per_minute: number; allowed_ip_ranges: string | null }>(`
        insert into lead_source_keys (tenant_id, name, source_key, token_hash, created_by_user_id, scopes, rate_limit_per_minute, allowed_ip_ranges)
        values ($1, '官网API', $2, $3, $4, '["leads:write", "reports:read"]'::jsonb, 120, '192.168.1.0/24')
        returning id, scopes, rate_limit_per_minute, allowed_ip_ranges
      `, [tenantAId, `src_${ts}`, validHash, adminAId]);

      expect(tokenRes.rows[0].scopes).toEqual(["leads:write", "reports:read"]);
      expect(tokenRes.rows[0].rate_limit_per_minute).toBe(120);
      expect(tokenRes.rows[0].allowed_ip_ranges).toBe("192.168.1.0/24");
    });
  });

  describe("4. 结构化渠道与 UTM 归因落库全流程验证", () => {
    it("创建线索服务支持结构化落库 channel 与 utm 字段", async () => {
      const adminCtx: TenantContext = {
        tenantId: tenantAId,
        userId: adminAId,
        role: "ADMIN",
      };

      const leadsModule = await import("@/core/leads/service");
      const createRes = await leadsModule.createLeadService(adminCtx, {
        contactName: "渠道归因测试线索",
        contactPhone: "13800138099",
        channel: "baidu_ads",
        utmSource: "baidu_search",
        utmMedium: "cpc",
        utmCampaign: "q3_promo",
      });

      expect(createRes.created).toBe(true);
      const leadId = createRes.leadId!;

      const leadRow = await owner.query<{ channel: string; utm_source: string; utm_medium: string; utm_campaign: string }>(`
        select channel, utm_source, utm_medium, utm_campaign from leads where id = $1
      `, [leadId]);

      expect(leadRow.rows[0].channel).toBe("baidu_ads");
      expect(leadRow.rows[0].utm_source).toBe("baidu_search");
      expect(leadRow.rows[0].utm_medium).toBe("cpc");
      expect(leadRow.rows[0].utm_campaign).toBe("q3_promo");

      const detail = await leadsModule.getLeadDetailService(adminCtx, leadId);
      expect(detail.lead.channel).toBe("baidu_ads");
      expect(detail.lead.utmSource).toBe("baidu_search");
      expect(detail.lead.utmMedium).toBe("cpc");
      expect(detail.lead.utmCampaign).toBe("q3_promo");
    });
  });

  describe("5. 统一外部 API 鉴权双轨制解析 (resolvePluginApiSession)", () => {
    it("支持通过 API Key (Bearer 或 x-api-key) 解析租户与身份上下文", async () => {
      const { createLeadSourceKeyService } = await import("@/core/leads/service");
      const { resolvePluginApiSession } = await import("@/plugin-kit/server");

      const adminCtx: TenantContext = { tenantId: tenantAId, userId: adminAId, role: "ADMIN" };
      const keyRes = await createLeadSourceKeyService(adminCtx, {
        name: "ERP集成对接凭证",
        sourceKey: `erp_sys_${ts}`,
      });

      const reqWithBearer = new Request("http://localhost:3000/api/v1/leads", {
        headers: { authorization: `Bearer ${keyRes.token}` },
      });
      const resolvedCtx1 = await resolvePluginApiSession(reqWithBearer);
      expect(resolvedCtx1.tenantId).toBe(tenantAId);
      expect(resolvedCtx1.userId).toBe(adminAId);

      const reqWithApiKey = new Request("http://localhost:3000/api/v1/leads", {
        headers: { "x-api-key": keyRes.token },
      });
      const resolvedCtx2 = await resolvePluginApiSession(reqWithApiKey);
      expect(resolvedCtx2.tenantId).toBe(tenantAId);
      expect(resolvedCtx2.userId).toBe(adminAId);
    });

    it("API Key 必须具备有效角色，未知或无效 Key 时拒绝访问", async () => {
      const { resolvePluginApiSession } = await import("@/plugin-kit/server");
      const fakeToken = `sk_live_unknown_token_${ts}`;
      const req = new Request("http://localhost:3000/api/v1/leads", {
        headers: { authorization: `Bearer ${fakeToken}` },
      });
      await expect(resolvePluginApiSession(req)).rejects.toThrow();
    });

    it("API Key 超过 rate_limit_per_minute 时返回 RATE_LIMITED 拦截（plugin_rate_limits 生效）", async () => {
      const { resolvePluginApiSession } = await import("@/plugin-kit/server");
      const crypto = await import("node:crypto");
      const limitedToken = `sk_live_limited_${ts}`;
      const tokenHash = crypto.createHash("sha256").update(limitedToken).digest("hex");

      await owner.query(`
        insert into lead_source_keys (tenant_id, name, source_key, token_hash, created_by_user_id, rate_limit_per_minute)
        values ($1, '低频限流Key', $2, $3, $4, 2)
      `, [tenantAId, `limited_${ts}`, tokenHash, adminAId]);

      const req = new Request("http://localhost:3000/api/v1/leads", {
        headers: { authorization: `Bearer ${limitedToken}` },
      });

      await expect(resolvePluginApiSession(req)).resolves.toBeDefined();
      await expect(resolvePluginApiSession(req)).resolves.toBeDefined();
      await expect(resolvePluginApiSession(req)).rejects.toThrow(/超出配额限制/);
    });

    it("OpenAPI Scope 鉴权与横向越权防御：按 Scope 严格鉴权与拦截", async () => {
      const { createLeadSourceKeyService } = await import("@/core/leads/service");
      const { resolvePluginApiSession, invalidateLeadSourceKeyCache } = await import("@/plugin-kit/server");

      const keyTs = Date.now() + Math.floor(Math.random() * 100000);
      const keyResult = await createLeadSourceKeyService(adminCtxFor(tenantAId, adminAId, "ADMIN"), {
        name: "官方网站营销线索落地页",
        sourceKey: `official_site_${keyTs}`,
      });
      const rawToken = keyResult.token;

      // 默认只有 ["leads:write"]，用它访问 reports:write 必须被拒
      const deniedReq = new Request("http://localhost:3000/api/v1/reports", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawToken}`, "Content-Type": "application/json" },
      });
      await expect(resolvePluginApiSession(deniedReq, "reports:write")).rejects.toThrow(/缺少访问权限/);

      const deniedReq2 = new Request("http://localhost:3000/api/v1/reports", {
        method: "GET",
        headers: { Authorization: `Bearer ${rawToken}` },
      });
      await expect(
        resolvePluginApiSession(deniedReq2, ["reports:read", "reports:write"]),
      ).rejects.toThrow(/缺少访问权限/);

      // 显式授予 scope 后放行
      await owner.query(`
        update lead_source_keys set scopes = '["reports:write", "reports:read"]'::jsonb where id = $1
      `, [keyResult.sourceKeyId]);
      invalidateLeadSourceKeyCache(tenantAId, keyResult.sourceKeyId);

      const passReq = new Request("http://localhost:3000/api/v1/reports", {
        headers: { Authorization: `Bearer ${rawToken}` },
      });
      const ctx = await resolvePluginApiSession(passReq, "reports:write");
      expect(ctx.tenantId).toBe(tenantAId);

      const passReq2 = new Request("http://localhost:3000/api/v1/reports", {
        headers: { Authorization: `Bearer ${rawToken}` },
      });
      const ctx2 = await resolvePluginApiSession(passReq2, ["reports:read", "reports:write"]);
      expect(ctx2.tenantId).toBe(tenantAId);
    });
  });

  describe("6. 离职交接主流程在无插件钩子时仍可完成", () => {
    it("销售名下线索/客户/商机原子交接给接手人，离职者账号被禁用", async () => {
      const adminCtx: TenantContext = { tenantId: tenantAId, userId: adminAId, role: "ADMIN" };

      const leadRes = await owner.query<{ id: string }>(`
        insert into leads (tenant_id, contact_name, contact_phone, source, status, owner_user_id)
        values ($1, '离职交接线索', '13900000001', 'manual', 'NEW', $2) returning id
      `, [tenantAId, salesA1Id]);
      const custRes = await owner.query<{ id: string }>(`
        insert into customers (tenant_id, name, owner_user_id)
        values ($1, '离职交接客户', $2) returning id
      `, [tenantAId, salesA1Id]);
      const oppRes = await owner.query<{ id: string }>(`
        insert into opportunities (tenant_id, name, customer_id, owner_user_id, stage)
        values ($1, '离职交接商机', $2, $3, 'DISCOVERY') returning id
      `, [tenantAId, custRes.rows[0].id, salesA1Id]);

      const res = await offboardMemberAndTransferAssetsService(adminCtx, {
        offboardUserId: salesA1Id,
        action: "TRANSFER",
        transferToUserId: adminAId,
      });
      expect(res.transferredLeads).toBeGreaterThanOrEqual(1);
      expect(res.transferredCustomers).toBeGreaterThanOrEqual(1);
      expect(res.transferredDeals).toBeGreaterThanOrEqual(1);

      const lead = await owner.query<{ owner_user_id: string }>(`select owner_user_id from leads where id = $1`, [leadRes.rows[0].id]);
      expect(lead.rows[0].owner_user_id).toBe(adminAId);
      const cust = await owner.query<{ owner_user_id: string }>(`select owner_user_id from customers where id = $1`, [custRes.rows[0].id]);
      expect(cust.rows[0].owner_user_id).toBe(adminAId);
      const opp = await owner.query<{ owner_user_id: string }>(`select owner_user_id from opportunities where id = $1`, [oppRes.rows[0].id]);
      expect(opp.rows[0].owner_user_id).toBe(adminAId);

      const user = await owner.query<{ status: string }>(`select status from users where id = $1`, [salesA1Id]);
      expect(user.rows[0].status).toBe("DISABLED");
    });
  });
});

function adminCtxFor(tenantId: string, userId: string, role: TenantContext["role"]): TenantContext {
  return { tenantId, userId, role };
}
