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

let directorySyncService: typeof import("@/core/workplace/directory-sync");
let publicPoolService: typeof import("@/core/public-pool/service");
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let adminId: string;
let salesId: string;
let adminCtx: TenantContext;
let salesCtx: TenantContext;

describe("企业通讯录自动同步与公海前置节点预警机制 (Directory Sync & Recycle Warning Guard)", { timeout: 25000 }, () => {
  beforeAll(async () => {
    await owner.connect();
    directorySyncService = await import("@/core/workplace/directory-sync");
    publicPoolService = await import("@/core/public-pool/service");
    closeDb = (await import("@/db/client")).closeDb;

    const tRes = await owner.query<{ id: string }>(
      "insert into tenants (name) values ('通讯录与预警测试租户') returning id",
    );
    tenantId = tRes.rows[0].id;

    const ts = Date.now();
    const [aRes, sRes] = await Promise.all([
      owner.query<{ id: string }>(
        "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '管理员老陈', 'ADMIN') returning id",
        [tenantId, `admin-dir-${ts}@example.com`],
      ),
      owner.query<{ id: string }>(
        "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '销售小李', 'SALES') returning id",
        [tenantId, `sales-dir-${ts}@example.com`],
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
      await owner.query("delete from workplace_directory_configs where tenant_id = $1", [tenantId]);
      await owner.query("delete from activities where tenant_id = $1", [tenantId]);
      await owner.query("delete from lead_status_history where tenant_id = $1", [tenantId]);
      await owner.query("delete from leads where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1 and id not in ($2, $3)", [tenantId, adminId, salesId]);
      await owner.query("delete from departments where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await closeDb();
    await owner.end();
  });

  it("1. 管理员可配置企业微信/钉钉/飞书通讯录对接凭证，非管理员拒绝", async () => {
    // 销售专员拒绝配置
    await expect(
      directorySyncService.upsertDirectoryConfigService(salesCtx, {
        platform: "WECOM",
        corpId: "ww_corp_test_123",
        secret: "contacts_secret_mock",
      }),
    ).rejects.toThrow("权限不足");

    // 管理员配置成功
    const cfg = await directorySyncService.upsertDirectoryConfigService(adminCtx, {
      platform: "WECOM",
      corpId: "ww_corp_test_123",
      secret: "contacts_secret_mock",
      syncMode: "INCREMENTAL",
      defaultRole: "SALES",
    });

    expect(cfg.corpId).toBe("ww_corp_test_123");
    expect(cfg.platform).toBe("WECOM");

    const list = await directorySyncService.listDirectoryConfigsService(adminCtx);
    expect(list.length).toBe(1);
    expect(list[0].platform).toBe("WECOM");
  });

  it("1b. 通讯录凭据 Secret 密文落库与历史存量明文兼容", async () => {
    // 数据库中必须以 enc:v1: 存储
    const dbRow = await owner.query<{ secret: string }>(
      "select secret from workplace_directory_configs where tenant_id = $1 and platform = 'WECOM'",
      [tenantId],
    );
    expect(dbRow.rows[0].secret).toMatch(/^enc:v1:/);

    // 读取应被掩码
    const configs = await directorySyncService.listDirectoryConfigsService(adminCtx);
    const wecom = configs.find((c) => c.platform === "WECOM");
    expect(wecom?.secret).toBe("cont****mock");

    // 存量明文优雅兼容
    await owner.query(
      "update workplace_directory_configs set secret = 'plain_legacy_corp_secret' where tenant_id = $1 and platform = 'WECOM'",
      [tenantId],
    );
    const legacyConfigs = await directorySyncService.listDirectoryConfigsService(adminCtx);
    const legacyWecom = legacyConfigs.find((c) => c.platform === "WECOM");
    expect(legacyWecom?.secret).toBe("plai****cret");
  });

  it("2. 企业通讯录支持差异比对 (Diff Preview) 与一键同步入库", async () => {
    const syncEmail = `sunqiang-${Date.now()}@wecom-test.com`;
    const mockRemote = {
      departments: [
        { id: "ext-dept-1", name: "企微·华北大区业务部", order: 1 },
      ],
      users: [
        {
          id: "ext-user-1",
          name: "同步员工孙强",
          mobile: "13811002233",
          email: syncEmail,
          departmentExternalId: "ext-dept-1",
          title: "高级客户代表",
        },
      ],
    };

    // 1) 差异比对
    const diff = await directorySyncService.previewDirectorySyncDiffService(adminCtx, "WECOM", mockRemote);
    expect(diff.departmentsToAdd.length).toBe(1);
    expect(diff.departmentsToAdd[0].name).toBe("企微·华北大区业务部");
    expect(diff.usersToAdd.length).toBe(1);
    expect(diff.usersToAdd[0].name).toBe("同步员工孙强");

    // 2) 执行同步入库
    const execResult = await directorySyncService.executeDirectorySyncService(adminCtx, "WECOM", mockRemote);
    expect(execResult.createdDepartmentsCount).toBe(1);
    expect(execResult.createdUsersCount).toBe(1);

    // 3) 验证部门与用户已成功持久化至 CRM 数据库
    const deptRes = await owner.query<{ name: string }>(
      "select name from departments where tenant_id = $1 and name = '企微·华北大区业务部'",
      [tenantId],
    );
    expect(deptRes.rows.length).toBe(1);

    const userRes = await owner.query<{ name: string; phone: string }>(
      "select name, phone from users where tenant_id = $1 and email = $2",
      [tenantId, syncEmail],
    );
    expect(userRes.rows.length).toBe(1);
    expect(userRes.rows[0].phone).toBe("13811002233");
  });

  it("3. 公海回收前置预警机制：到达阈值前(第6天)生成预警与倒计时，但暂不执行回收", async () => {
    // 设置 7 天未跟进回收规则，24 小时前 (即第 6 天) 触发前置预警
    await publicPoolService.upsertPublicPoolRuleService(adminCtx, {
      ruleType: "LEAD_UNTOUCHED",
      thresholdDays: 7,
      notifyBeforeHours: 24,
      isEnabled: true,
    });

    // 插入一条 6.2 天未跟进的私海线索 (处于 6-7 天临期缓冲期内)
    const lRes = await owner.query<{ id: string }>(
      "insert into leads (tenant_id, contact_name, contact_phone, company_name, owner_user_id, status, created_at) values ($1, '临期潜客周总', '13812345678', '鼎峰科技', $2, 'NEW', now() - interval '6.2 days') returning id",
      [tenantId, salesId],
    );
    const leadId = lRes.rows[0].id;

    // 扫描临期前置预警
    const warnRes = await publicPoolService.scanPublicPoolPreRecycleWarningsService(adminCtx);
    expect(warnRes.warningCount).toBeGreaterThanOrEqual(1);

    const warning = warnRes.warnings.find((w) => w.id === leadId);
    expect(warning).toBeDefined();
    expect(warning?.ownerUserId).toBe(salesId);
    expect(warning?.hoursRemaining).toBeGreaterThan(0);

    // 验证生成了 RECYCLE_WARNING 类型的站内通知
    const notifRes = await owner.query<{ type: string; title: string }>(
      "select type, title from notifications where tenant_id = $1 and lead_id = $2",
      [tenantId, leadId],
    );
    expect(notifRes.rows.length).toBe(1);
    expect(notifRes.rows[0].type).toBe("RECYCLE_WARNING");
    expect(notifRes.rows[0].title).toContain("公海临期预警");

    // 关键验证：此阶段线索绝未被回收，owner_user_id 依然保留在销售名下
    const leadCheck = await owner.query<{ owner_user_id: string }>(
      "select owner_user_id from leads where id = $1",
      [leadId],
    );
    expect(leadCheck.rows[0].owner_user_id).toBe(salesId);
  });

  it("4. 销售记录有效沟通后，临期预警与倒计时立即打断并清零重置", async () => {
    // 针对上述临期线索，销售小李新增一条有效通话跟进
    const leadRes = await owner.query<{ id: string }>(
      "select id from leads where tenant_id = $1 and contact_name = '临期潜客周总'",
      [tenantId],
    );
    const leadId = leadRes.rows[0].id;

    await owner.query(
      "insert into activities (tenant_id, user_id, lead_id, type, outcome, summary, created_at) values ($1, $2, $3, 'CALL', 'CONNECTED', '与周总沟通产品方案，预约下周拜访', now())",
      [tenantId, salesId, leadId],
    );

    // 重新扫描临期预警，该线索不再属于临期状态
    const warnAfter = await publicPoolService.scanPublicPoolPreRecycleWarningsService(adminCtx);
    const findAgain = warnAfter.warnings.find((w) => w.id === leadId);
    expect(findAgain).toBeUndefined();
  });

  it("5. 超过 7 天最终时限且未处理的潜客正式执行公海回收与释放通知", async () => {
    // 插入一条 8 天无任何跟进的超期潜客
    const lRes = await owner.query<{ id: string }>(
      "insert into leads (tenant_id, contact_name, contact_phone, company_name, owner_user_id, status, created_at) values ($1, '超时放弃潜客赵总', '13888889999', '无极软件', $2, 'NEW', now() - interval '8 days') returning id",
      [tenantId, salesId],
    );
    const leadId = lRes.rows[0].id;

    // 执行公海回收
    const scanRes = await publicPoolService.runPublicPoolRecycleScanService(adminCtx, { dryRun: false });
    expect(scanRes.recycledLeadsCount).toBeGreaterThanOrEqual(1);

    // 验证线索已正式释放回公海池 (owner_user_id 为 null)
    const afterLead = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from leads where id = $1",
      [leadId],
    );
    expect(afterLead.rows[0].owner_user_id).toBeNull();

    // 验证生成了 RECYCLE_EXECUTED 类型的通知
    const execNotif = await owner.query<{ type: string; title: string }>(
      "select type, title from notifications where tenant_id = $1 and lead_id = $2 and type = 'RECYCLE_EXECUTED'",
      [tenantId, leadId],
    );
    expect(execNotif.rows.length).toBe(1);
    expect(execNotif.rows[0].title).toContain("公海回收通知");
  });
});
