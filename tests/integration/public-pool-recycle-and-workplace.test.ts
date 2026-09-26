import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

let publicPoolService: typeof import("@/core/public-pool/service");
let workplaceService: typeof import("@/core/workplace/service");
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let adminId: string;
let salesId: string;
let adminCtx: TenantContext;
let salesCtx: TenantContext;

describe("公海池自动回收规则引擎与企业通讯协同 (Public Pool Recycle & Workplace Connectors)", { timeout: 25000 }, () => {
  beforeAll(async () => {
    await owner.connect();
    publicPoolService = await import("@/core/public-pool/service");
    workplaceService = await import("@/core/workplace/service");
    closeDb = (await import("@/db/client")).closeDb;

    const tRes = await owner.query<{ id: string }>(
      "insert into tenants (name) values ('公海规则测试租户') returning id",
    );
    tenantId = tRes.rows[0].id;

    const ts = Date.now();
    const [aRes, sRes] = await Promise.all([
      owner.query<{ id: string }>(
        "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '系统管理员', 'ADMIN') returning id",
        [tenantId, `admin-pool-${ts}@example.com`],
      ),
      owner.query<{ id: string }>(
        "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '销售小赵', 'SALES') returning id",
        [tenantId, `sales-pool-${ts}@example.com`],
      ),
    ]);

    adminId = aRes.rows[0].id;
    salesId = sRes.rows[0].id;
    adminCtx = { tenantId, userId: adminId, role: "ADMIN" };
    salesCtx = { tenantId, userId: salesId, role: "SALES" };
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from notifications where tenant_id = $1", [tenantId]);
      await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
      await owner.query("delete from public_pool_rules where tenant_id = $1", [tenantId]);
      await owner.query("delete from workplace_integrations where tenant_id = $1", [tenantId]);
      await owner.query("delete from tasks where tenant_id = $1", [tenantId]);
      await owner.query("delete from activities where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunities where tenant_id = $1", [tenantId]);
      await owner.query("delete from customers where tenant_id = $1", [tenantId]);
      await owner.query("delete from lead_status_history where tenant_id = $1", [tenantId]);
      await owner.query("delete from sales_insights where tenant_id = $1", [tenantId]);
      await owner.query("delete from leads where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await closeDb();
    await owner.end();
  });

  it("1. 管理员可配置公海池自动回收规则，非管理员拒绝配置", async () => {
    // 销售角色配置应当拒绝
    await expect(
      publicPoolService.upsertPublicPoolRuleService(salesCtx, {
        ruleType: "LEAD_UNTOUCHED",
        thresholdDays: 5,
        isEnabled: true,
      }),
    ).rejects.toThrow("权限不足");

    // 管理员配置成功
    const rule = await publicPoolService.upsertPublicPoolRuleService(adminCtx, {
      ruleType: "LEAD_UNTOUCHED",
      thresholdDays: 5,
      protectWindowDays: 2,
      isEnabled: true,
    });

    expect(rule.ruleType).toBe("LEAD_UNTOUCHED");
    expect(rule.thresholdDays).toBe(5);
    expect(rule.protectWindowDays).toBe(2);

    const list = await publicPoolService.listPublicPoolRulesService(adminCtx);
    expect(list.length).toBe(3);
    const untouched = list.find((r) => r.ruleType === "LEAD_UNTOUCHED");
    expect(untouched?.thresholdDays).toBe(5);
  });

  it("2. 私海线索超过未跟进阈值被自动扫描并释放回公海池 (带 Dry-Run 与实际执行)", async () => {
    // 插入一条 10 天前领入且无任何跟进的私海线索
    const lRes = await owner.query<{ id: string }>(
      "insert into leads (tenant_id, contact_name, contact_phone, company_name, owner_user_id, status, created_at) values ($1, '停滞线索A', '13800000001', '未来科技', $2, 'NEW', now() - interval '10 days') returning id",
      [tenantId, salesId],
    );
    const leadId = lRes.rows[0].id;

    // 1) 试运行 Dry Run 扫描
    const dryRunRes = await publicPoolService.runPublicPoolRecycleScanService(adminCtx, { dryRun: true });
    expect(dryRunRes.totalEligibleLeads).toBeGreaterThanOrEqual(1);
    expect(dryRunRes.recycledLeadsCount).toBe(0); // dryRun 不执行写入

    const preview = dryRunRes.previewItems.find((p) => p.id === leadId);
    expect(preview).toBeDefined();
    expect(preview?.isProtected).toBe(false);

    // 2) 实际执行回收
    const actualRes = await publicPoolService.runPublicPoolRecycleScanService(adminCtx, { dryRun: false });
    expect(actualRes.recycledLeadsCount).toBeGreaterThanOrEqual(1);

    // 校验线索已重置为公海 (owner_user_id 为 null)
    const afterRes = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from leads where id = $1",
      [leadId],
    );
    expect(afterRes.rows[0].owner_user_id).toBeNull();
  });

  it("3. 免回收保护期内的潜客在扫描时受到保护不被释放", async () => {
    // 插入一条 8 天前创建、但 1 天前刚有跟进活动的线索
    const lRes = await owner.query<{ id: string }>(
      "insert into leads (tenant_id, contact_name, contact_phone, company_name, owner_user_id, status, created_at) values ($1, '新捞取线索B', '13800000002', '星辰智联', $2, 'CONTACTED', now() - interval '8 days') returning id",
      [tenantId, salesId],
    );
    const leadId = lRes.rows[0].id;
    await owner.query(
      "insert into activities (tenant_id, user_id, lead_id, type, outcome, summary, created_at) values ($1, $2, $3, 'CALL', 'CONNECTED', '昨日电话拜访沟通需求', now() - interval '1 day')",
      [tenantId, salesId, leadId],
    );

    const scan = await publicPoolService.runPublicPoolRecycleScanService(adminCtx, { dryRun: false });
    const preview = scan.previewItems.find((p) => p.id === leadId);
    expect(preview).toBeUndefined();

    // 验证线索仍然留在销售名下
    const checkRes = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from leads where id = $1",
      [leadId],
    );
    expect(checkRes.rows[0].owner_user_id).toBe(salesId);
  });

  it("4. 沉睡客户超过 60 天无活跃跟进被自动释放回公海客户池", async () => {
    // 插入一条 90 天前创建且无任何跟进的沉睡客户
    const cRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, owner_user_id, created_at) values ($1, '沉睡企业C', $2, now() - interval '90 days') returning id",
      [tenantId, salesId],
    );
    const custId = cRes.rows[0].id;

    const actual = await publicPoolService.runPublicPoolRecycleScanService(adminCtx, { dryRun: false });
    expect(actual.recycledCustomersCount).toBeGreaterThanOrEqual(1);

    const checkCust = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from customers where id = $1",
      [custId],
    );
    expect(checkCust.rows[0].owner_user_id).toBeNull();
  });

  it("4a. 客户回收联动：有在途商机的客户不被回收；刚认领的沉睡客户受保护期保护", async () => {
    // 场景 1：沉睡客户名下有在途商机 → 不回收（商机归属不能跟着客户跑）
    const oRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, owner_user_id, created_at) values ($1, '带在途商机客户', $2, now() - interval '90 days') returning id",
      [tenantId, salesId],
    );
    const oppCustId = oRes.rows[0].id;
    await owner.query(
      "insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount) values ($1, $2, $3, '长期在途项目', 'PROPOSAL', 5000000)",
      [tenantId, oppCustId, salesId],
    );

    // 场景 2：沉睡客户刚被认领（claimed_at = now）→ 保护期内不回收
    const nRes = await owner.query<{ id: string }>(
      `insert into customers (tenant_id, name, owner_user_id, created_at, claimed_at)
       values ($1, '刚认领的沉睡客户', $2, now() - interval '90 days', now()) returning id`,
      [tenantId, salesId],
    );
    const freshCustId = nRes.rows[0].id;

    const scan = await publicPoolService.runPublicPoolRecycleScanService(adminCtx, { dryRun: false });

    // 场景 1：客户未被回收（商机仍在推进中）
    const oppCust = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from customers where id = $1", [oppCustId],
    );
    expect(oppCust.rows[0].owner_user_id).toBe(salesId);

    // 场景 2：客户受保护（预览可见 isProtected）
    const freshPreview = scan.previewItems.find((p) => p.id === freshCustId);
    expect(freshPreview?.isProtected).toBe(true);
    const freshCust = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from customers where id = $1", [freshCustId],
    );
    expect(freshCust.rows[0].owner_user_id).toBe(salesId);

    // 场景 2b：认领时间拨回保护期外（>7 天）→ 可回收
    await owner.query("update customers set claimed_at = now() - interval '10 days' where id = $1", [freshCustId]);
    await publicPoolService.runPublicPoolRecycleScanService(adminCtx, { dryRun: false });
    const freshAfter = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from customers where id = $1", [freshCustId],
    );
    expect(freshAfter.rows[0].owner_user_id).toBeNull();
  });

  it("5. 企业通讯机器人 (企微/钉钉/飞书) 支持完整 CRUD 与 Markdown 载荷多平台格式适配", async () => {
    const created = await workplaceService.createWorkplaceIntegrationService(adminCtx, {
      platform: "WECOM",
      name: "销售战报大群机器人",
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=mock-test-key",
      events: ["DEAL_WON", "INTERVENTION_REQUESTED"],
    });

    expect(created.id).toBeDefined();
    expect(created.platform).toBe("WECOM");
    expect(created.events).toContain("DEAL_WON");

    // 验证多平台格式转换器
    const msg = {
      title: "赢单喜报",
      markdownContent: "**张三** 成功签约 ¥500,000",
      event: "DEAL_WON" as const,
    };

    const wecomPayload = workplaceService.formatWorkplacePayload("WECOM", msg) as { msgtype?: string; markdown?: { content?: string } };
    expect(wecomPayload.msgtype).toBe("markdown");
    expect(wecomPayload.markdown?.content ?? "").toContain("张三");

    const dingPayload = workplaceService.formatWorkplacePayload("DINGTALK", msg) as { msgtype?: string; markdown?: { title?: string } };
    expect(dingPayload.msgtype).toBe("markdown");
    expect(dingPayload.markdown?.title ?? "").toBe("赢单喜报");

    const feishuPayload = workplaceService.formatWorkplacePayload("FEISHU", msg) as { msg_type?: string; card?: { header?: { title?: { content?: string } } } };
    expect(feishuPayload.msg_type).toBe("interactive");
    expect(feishuPayload.card?.header?.title?.content ?? "").toBe("赢单喜报");

    await workplaceService.deleteWorkplaceIntegrationService(adminCtx, created.id);
    const afterList = await workplaceService.listWorkplaceIntegrationsService(adminCtx);
    expect(afterList.find((i) => i.id === created.id)).toBeUndefined();
  });

  it("6. 全租户定时回收：无可用操作人的租户被安全跳过，单租户失败不拖垮整轮", async () => {
    // 主租户：再造一条逾期私海线索，验证整轮编排仍会真实回收
    const lRes = await owner.query<{ id: string }>(
      "insert into leads (tenant_id, contact_name, contact_phone, company_name, owner_user_id, status, created_at) values ($1, '整轮编排逾期线索', '13800000009', '整轮科技', $2, 'NEW', now() - interval '10 days') returning id",
      [tenantId, salesId],
    );
    const leadId = lRes.rows[0].id;

    // 一个没有任何用户的租户（模拟历史残留/测试数据）
    const emptyRes = await owner.query<{ id: string }>(
      "insert into tenants (name) values ('无用户租户-回收编排测试') returning id",
    );
    const emptyTenantId = emptyRes.rows[0].id;

    try {
      const summaries = await publicPoolService.runPublicPoolRecycleForAllTenantsService({
        listActiveTenantIds: async () => ["boom-fake-tenant", emptyTenantId, tenantId],
        resolveActorUserId: async (tid) => {
          if (tid === "boom-fake-tenant") throw new Error("数据库连接抖动");
          if (tid === emptyTenantId) return null;
          return adminId;
        },
      });

      expect(summaries).toHaveLength(3);

      const failed = summaries.find((s) => s.tenantId === "boom-fake-tenant");
      expect(failed?.status).toBe("FAILED");

      const skipped = summaries.find((s) => s.tenantId === emptyTenantId);
      expect(skipped?.status).toBe("SKIPPED");
      expect(skipped?.detail).toContain("NO_ACTOR_USER");

      const recycled = summaries.find((s) => s.tenantId === tenantId);
      expect(recycled?.status).toBe("RECYCLED");
      expect(recycled?.recycledLeadsCount).toBeGreaterThanOrEqual(1);

      const afterRes = await owner.query<{ owner_user_id: string | null }>(
        "select owner_user_id from leads where id = $1",
        [leadId],
      );
      expect(afterRes.rows[0].owner_user_id).toBeNull();
    } finally {
      await owner.query("delete from tenants where id = $1", [emptyTenantId]);
    }
  });

  it("7. 回收联动完整：按认领时间保护、取消幽灵任务、留状态历史", async () => {
    // 线索 10 天前创建（超 7 天未跟进阈值）、但刚刚才被认领
    const lRes = await owner.query<{ id: string }>(
      `insert into leads (tenant_id, contact_name, contact_phone, company_name, owner_user_id, status, created_at, claimed_at)
       values ($1, '刚认领的老线索', '13800000077', '认领科技', $2, 'NEW', now() - interval '10 days', now()) returning id`,
      [tenantId, salesId],
    );
    const leadId = lRes.rows[0].id;

    // 第一轮：认领保护期内（<3 天）不得回收
    const protectedRes = await publicPoolService.runPublicPoolRecycleScanService(adminCtx, { dryRun: false });
    const protectedPreview = protectedRes.previewItems.find((p) => p.id === leadId);
    expect(protectedPreview).toBeDefined();
    expect(protectedPreview?.isProtected).toBe(true);
    const stillOwned = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from leads where id = $1", [leadId],
    );
    expect(stillOwned.rows[0].owner_user_id).toBe(salesId);

    // 第二轮：把认领时间拨回 5 天前（保护期外、仍超 7 天未跟进）→ 应回收
    await owner.query("update leads set claimed_at = now() - interval '5 days' where id = $1", [leadId]);
    await owner.query(
      `insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
       values ($1, $2, $3, 'FOLLOW_UP', now() + interval '1 day')`,
      [tenantId, leadId, salesId],
    );

    const recycled = await publicPoolService.runPublicPoolRecycleScanService(adminCtx, { dryRun: false });
    expect(recycled.recycledLeadsCount).toBeGreaterThanOrEqual(1);

    const after = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from leads where id = $1", [leadId],
    );
    expect(after.rows[0].owner_user_id).toBeNull();

    // 幽灵任务被取消，不留 OPEN 残留
    const task = await owner.query<{ status: string }>(
      "select status from tasks where lead_id = $1 order by created_at desc limit 1", [leadId],
    );
    expect(task.rows[0]?.status).toBe("CANCELLED");

    // 状态历史留痕（可追溯回收事件）
    const history = await owner.query<{ reason: string }>(
      "select reason from lead_status_history where lead_id = $1 order by created_at desc limit 1", [leadId],
    );
    expect(history.rows[0]?.reason).toContain("公海");
  });

  it("W10-4 回收锁定 owner 快照并跳过已被重新认领的线索", async () => {
    const { assignLeadService } = await import("@/core/leads/service");
    const stale = await owner.query<{ id: string }>(
      `insert into leads (tenant_id, contact_name, contact_phone, company_name, owner_user_id, status, created_at, claimed_at)
       values ($1, '回收竞态线索', '13800000110', '竞态科技', $2, 'NEW', now() - interval '10 days', now() - interval '10 days') returning id`,
      [tenantId, salesId],
    );
    const staleId = stale.rows[0].id;
    const staleTask = await owner.query<{ id: string }>(
      `insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
       values ($1, $2, $3, 'FOLLOW_UP', now() + interval '1 day') returning id`,
      [tenantId, staleId, salesId],
    );
    let reassigned = false;
    const raceResult = await publicPoolService.runPublicPoolRecycleScanService(adminCtx, {
      dryRun: false,
      afterCandidateScan: async () => {
        if (!reassigned) {
          reassigned = true;
          await assignLeadService(adminCtx, staleId, adminId);
        }
      },
    });

    expect(raceResult.recycledLeadIds).not.toContain(staleId);
    const racedLead = await owner.query<{ owner_user_id: string }>(
      "select owner_user_id from leads where id = $1",
      [staleId],
    );
    expect(racedLead.rows[0].owner_user_id).toBe(adminId);
    const racedTask = await owner.query<{ status: string }>(
      "select status from tasks where id = $1",
      [staleTask.rows[0].id],
    );
    expect(racedTask.rows[0].status).toBe("OPEN");

    const normal = await owner.query<{ id: string }>(
      `insert into leads (tenant_id, contact_name, contact_phone, company_name, owner_user_id, status, created_at, claimed_at)
       values ($1, '回收正常线索', '13800000111', '正常科技', $2, 'NEW', now() - interval '10 days', now() - interval '10 days') returning id`,
      [tenantId, salesId],
    );
    const normalId = normal.rows[0].id;
    const normalTask = await owner.query<{ id: string }>(
      `insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
       values ($1, $2, $3, 'FOLLOW_UP', now() + interval '1 day') returning id`,
      [tenantId, normalId, salesId],
    );
    const normalResult = await publicPoolService.runPublicPoolRecycleScanService(adminCtx, { dryRun: false });
    expect(normalResult.recycledLeadIds).toContain(normalId);
    const normalLead = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from leads where id = $1",
      [normalId],
    );
    expect(normalLead.rows[0].owner_user_id).toBeNull();
    const normalTaskState = await owner.query<{ status: string }>(
      "select status from tasks where id = $1",
      [normalTask.rows[0].id],
    );
    expect(normalTaskState.rows[0].status).toBe("CANCELLED");
  });

  it("8. 编排联动：临期线索收到预警通知，回收后洞察即时刷新", async () => {
    // 显式声明前提：7 天阈值 + 提前 24h 预警（测试 1 会把阈值改为 5 天且不还原，
    // 本测试不依赖其他测试的残留状态）
    await publicPoolService.upsertPublicPoolRuleService(adminCtx, {
      ruleType: "LEAD_UNTOUCHED",
      thresholdDays: 7,
      protectWindowDays: 3,
      notifyBeforeHours: 24,
      isEnabled: true,
    });

    // 线索 A：超期待回收（认领 5 天前，无跟进），预插一条活跃洞察
    const leadA = await owner.query<{ id: string }>(
      `insert into leads (tenant_id, contact_name, contact_phone, company_name, owner_user_id, status, created_at, claimed_at)
       values ($1, '回收刷洞察', '13800000088', '洞察科技', $2, 'CONTACTED', now() - interval '10 days', now() - interval '5 days') returning id`,
      [tenantId, salesId],
    );
    await owner.query(
      `insert into sales_insights (tenant_id, lead_id, code, severity, title, summary, suggested_action, source_version)
       values ($1, $2, 'NO_NEXT_STEP', 'ATTENTION', '旧建议', '旧建议', '旧建议', 'rules-v1')`,
      [tenantId, leadA.rows[0].id],
    );

    // 线索 B：临期未超期（6.5 天未跟进，阈值 7 天、提前 24h 预警）→ 应收到预警而非被回收
    const leadB = await owner.query<{ id: string }>(
      `insert into leads (tenant_id, contact_name, contact_phone, company_name, owner_user_id, status, created_at, claimed_at)
       values ($1, '临期预警线索', '13800000099', '预警科技', $2, 'CONTACTED', now() - interval '6 days 12 hours', now() - interval '6 days 12 hours') returning id`,
      [tenantId, salesId],
    );

    const summaries = await publicPoolService.runPublicPoolRecycleForAllTenantsService({
      listActiveTenantIds: async () => [tenantId],
      resolveActorUserId: async () => adminId,
    });
    expect(summaries[0]?.status).toBe("RECYCLED");

    // 线索 A 被回收，旧洞察被刷新为 EXPIRED（不残留过时建议）
    const ownerAfter = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from leads where id = $1", [leadA.rows[0].id],
    );
    expect(ownerAfter.rows[0].owner_user_id).toBeNull();
    const insight = await owner.query<{ status: string }>(
      "select status from sales_insights where lead_id = $1", [leadA.rows[0].id],
    );
    expect(insight.rows[0]?.status).toBe("EXPIRED");

    // 线索 B 保留在私海并收到预警通知（此前预警扫描零调用方，纯摆设）
    const ownerB = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from leads where id = $1", [leadB.rows[0].id],
    );
    expect(ownerB.rows[0].owner_user_id).toBe(salesId);
    const warning = await owner.query<{ type: string }>(
      "select type from notifications where tenant_id = $1 and lead_id = $2 and type = 'RECYCLE_WARNING'",
      [tenantId, leadB.rows[0].id],
    );
    expect(warning.rowCount).toBe(1);
  });

  it("10. 沉睡客户回收至公海池时联动取消持有人关联的 OPEN 任务 (对齐线索回收逻辑)", async () => {
    // 启用客户沉睡回收规则
    await publicPoolService.upsertPublicPoolRuleService(adminCtx, {
      ruleType: "CUSTOMER_INACTIVE",
      thresholdDays: 30,
      protectWindowDays: 0,
      isEnabled: true,
    });

    // 创建沉睡客户（40天无活动推进）
    const custRes = await owner.query<{ id: string }>(
      `insert into customers (tenant_id, name, customer_type, owner_user_id, created_at, claimed_at, updated_at)
       values ($1, '沉睡待回收客户', 'ENTERPRISE', $2, now() - interval '40 days', now() - interval '40 days', now() - interval '40 days') returning id`,
      [tenantId, salesId],
    );
    const custId = custRes.rows[0].id;

    // 为该客户创建销售员名下的 OPEN 待办跟进任务
    const taskRes = await owner.query<{ id: string }>(
      `insert into tasks (tenant_id, customer_id, assignee_user_id, type, status, due_at)
       values ($1, $2, $3, 'FOLLOW_UP', 'OPEN', now() + interval '1 day') returning id`,
      [tenantId, custId, salesId],
    );
    const taskId = taskRes.rows[0].id;

    // 执行公海自动回收（真实执行，非 dryRun）
    const result = await publicPoolService.runPublicPoolRecycleScanService(adminCtx, { dryRun: false });
    expect(result.recycledCustomersCount).toBe(1);

    // 断言客户已回收到公海
    const custAfter = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from customers where id = $1",
      [custId],
    );
    expect(custAfter.rows[0].owner_user_id).toBeNull();

    // 断言关联的 OPEN 任务已被联动取消为 CANCELLED，防止销售工作台残留幽灵任务
    const taskAfter = await owner.query<{ status: string }>(
      "select status from tasks where id = $1",
      [taskId],
    );
    expect(taskAfter.rows[0].status).toBe("CANCELLED");
  });

  it("11. 全租户回收 cron 默认 resolveActorUserId 经 withTenant 在 RLS 下正确解析 actorUser，不空转 SKIPPED", async () => {
    // 不注入 mock resolveActorUserId，使用默认实现走 users 表查询
    const summaries = await publicPoolService.runPublicPoolRecycleForAllTenantsService({
      listActiveTenantIds: async () => [tenantId],
    });
    expect(summaries.length).toBe(1);
    expect(summaries[0].status).toBe("RECYCLED");
    expect(summaries[0].detail).toBeUndefined();
  });
});
