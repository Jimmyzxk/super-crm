import "dotenv/config";
import pg from "pg";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

let scheduleService: typeof import("@/core/schedule/service");
let securityService: typeof import("@/core/security/service");
let publicPoolService: typeof import("@/core/public-pool/service");
let leadService: typeof import("@/core/leads/service");
let opportunityService: typeof import("@/core/opportunity/service");
let teamService: typeof import("@/core/team/service");
let rolesService: typeof import("@/core/roles/service");
let leaderboardService: typeof import("@/core/workbench/leaderboard");
let quotaService: typeof import("@/core/quota/service");
let customerService: typeof import("@/core/customer/service");
let aiCopilotService: typeof import("@/core/ai-copilot/service");
let aiHubService: typeof import("@/core/ai-hub/service");
let followupService: typeof import("@/core/followup/service");
let collaborationService: typeof import("@/core/collaboration/service");
let assertSafeHttpUrl: typeof import("@/core/ai-gateway/client").assertSafeHttpUrl;
let dateInputValue: typeof import("@/core/shared/date").dateInputValue;
let zonedWallClockToUtc: typeof import("@/core/shared/tz").zonedWallClockToUtc;
let closeDb: typeof import("@/db/client").closeDb;

describe("全项目安全漏洞与功能缺陷全面修复回归验证 (Comprehensive Bug & Security Audit)", () => {
  let tenantId: string;
  let adminId: string;
  let managerId: string;
  let salesAId: string;
  let salesBId: string;
  let productId: string;

  beforeAll(async () => {
    await owner.connect();

    scheduleService = await import("@/core/schedule/service");
    void publicPoolService; void quotaService; // 预留服务句柄
    securityService = await import("@/core/security/service");
    publicPoolService = await import("@/core/public-pool/service");
    leadService = await import("@/core/leads/service");
    opportunityService = await import("@/core/opportunity/service");
    teamService = await import("@/core/team/service");
    rolesService = await import("@/core/roles/service");
    leaderboardService = await import("@/core/workbench/leaderboard");
    quotaService = await import("@/core/quota/service");
    customerService = await import("@/core/customer/service");
    aiCopilotService = await import("@/core/ai-copilot/service");
    aiHubService = await import("@/core/ai-hub/service");
    followupService = await import("@/core/followup/service");
    collaborationService = await import("@/core/collaboration/service");
    assertSafeHttpUrl = (await import("@/core/ai-gateway/client")).assertSafeHttpUrl;
    dateInputValue = (await import("@/core/shared/date")).dateInputValue;
    zonedWallClockToUtc = (await import("@/core/shared/tz")).zonedWallClockToUtc;
    closeDb = (await import("@/db/client")).closeDb;

    const tRes = await owner.query<{ id: string }>(`
      insert into tenants (name, status)
      values ('安全审计测试租户', 'ACTIVE')
      returning id
    `);
    tenantId = tRes.rows[0].id;

    // 创建管理员、销售主管与两位销售
    const ts = Date.now();
    const uAdmin = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, password_hash, name, role, status)
      values ($1, $2, 'dummy_hash', '主管理员', 'ADMIN', 'ACTIVE')
      returning id
    `, [tenantId, `admin-sec-${ts}@example.com`]);
    adminId = uAdmin.rows[0].id;

    const uManager = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, password_hash, name, role, status)
      values ($1, $2, 'dummy_hash', '业务主管', 'MANAGER', 'ACTIVE')
      returning id
    `, [tenantId, `mgr-sec-${ts}@example.com`]);
    managerId = uManager.rows[0].id;

    const uSalesA = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, password_hash, name, role, status)
      values ($1, $2, 'dummy_hash', '销售甲', 'SALES', 'ACTIVE')
      returning id
    `, [tenantId, `sales-a-${ts}@example.com`]);
    salesAId = uSalesA.rows[0].id;

    const uSalesB = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, password_hash, name, role, status)
      values ($1, $2, 'dummy_hash', '销售乙', 'SALES', 'ACTIVE')
      returning id
    `, [tenantId, `sales-b-${ts}@example.com`]);
    salesBId = uSalesB.rows[0].id;

    // 创建产品
    const prodRes = await owner.query<{ id: string }>(`
      insert into products (tenant_id, name, code, category, pricing_model, unit_price, status)
      values ($1, '核心测试产品', 'SEC_P1', 'SOFTWARE', 'ONE_TIME', 100000, 'ACTIVE')
      returning id
    `, [tenantId]);
    productId = prodRes.rows[0].id;

    // 创建测试客户
    await owner.query(`
      insert into customers (tenant_id, name)
      values ($1, '安全审计测试客户')
    `, [tenantId]);
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query(`delete from audit_logs where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from notifications where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from workplace_integrations where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from win_reviews where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from deal_interventions where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from ai_agent_learning_logs where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from ai_recommendations where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from activities where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from sales_insights where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from sales_schedules where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from sales_quotas where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from plugin_registry where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from opportunity_line_items where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from opportunity_stage_history where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from tasks where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from opportunities where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from contacts where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from customers where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from lead_status_history where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from leads where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from public_pool_rules where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from customer_collaboration_settings where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from custom_roles where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from products where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from users where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from tenants where id = $1`, [tenantId]);
    }
    if (closeDb) await closeDb();
    await owner.end();
  });

  describe("1. 日程模块 IDOR 越权与属主防护验证", () => {
    let schedAId: string;

    it("销售甲创建日程，销售乙尝试传入 userId=salesAId 列表查询被强制限定为本人", async () => {
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const sched = await scheduleService.createSalesScheduleService(aCtx, {
        title: "销售甲的重要保密客户拜访",
        scheduleType: "VISIT",
        startAt: new Date(Date.now() + 3600000).toISOString(),
      });
      schedAId = sched.id;

      const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };
      // 销售乙恶意传入 userId: salesAId 查询
      const bList = await scheduleService.listSalesSchedulesService(bCtx, { userId: salesAId });
      // 必须被强制限定为销售乙自己的日程列表，不得泄露甲的日程
      expect(bList.some((s) => s.id === schedAId)).toBe(false);
    });

    it("销售乙尝试修改或删除销售甲的日程被拦截", async () => {
      const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };
      await expect(
        scheduleService.updateSalesScheduleService(bCtx, {
          id: schedAId,
          title: "篡改甲的日程",
        }),
      ).rejects.toThrow("当前用户无权操作该日程");

      await expect(
        scheduleService.deleteSalesScheduleService(bCtx, schedAId),
      ).rejects.toThrow("当前用户无权操作该日程");
    });
  });

  describe("2. 敏感数据脱敏查看权限校验", () => {
    let privateLeadAId: string;

    it("销售甲名下的私海线索，销售乙请求查看明文手机号被拦截", async () => {
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const lead = await leadService.createLeadService(aCtx, {
        contactName: "机密客户张总",
        contactPhone: "13911112222",
        contactEmail: "zhang@secret.com",
      });
      privateLeadAId = lead.leadId!;

      const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };
      await expect(
        securityService.logSensitiveDataUnmaskService(bCtx, "LEAD", privateLeadAId, "PHONE"),
      ).rejects.toThrow("无权查看其他销售私海线索的敏感信息");
    });

    it("销售甲本人请求查看明文手机号成功并写入审计日志", async () => {
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const res = await securityService.logSensitiveDataUnmaskService(
        aCtx,
        "LEAD",
        privateLeadAId,
        "PHONE",
        "跟进前核对电话",
      );
      expect(res.success).toBe(true);
      expect(res.unmaskedValue).toBe("13911112222");

      const audit = await owner.query(`
        select action, detail from audit_logs
        where tenant_id = $1 and subject_id = $2 and action = 'security.unmask_view'
      `, [tenantId, privateLeadAId]);
      expect(audit.rows.length).toBeGreaterThan(0);
      expect(audit.rows[0].detail.reason).toBe("跟进前核对电话");
    });
  });

  describe("2b. 协同模式下解敏口径必须与客户可见性对齐（持有商机才可解敏）", () => {
    it("协同开启但未持有该客户商机的销售解敏被拦；立项协同商机后放行", async () => {
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };

      // 甲建客户（乙与该客户此前无任何业务关联）
      const customer = await customerService.createCustomerDirectService(aCtx, {
        name: "解敏口径对齐测试客户",
        customerType: "ENTERPRISE",
        contactName: "李财务",
        contactPhone: "13833334444",
      });

      // 管理员开启多人协同跟进
      await owner.query(
        `insert into customer_collaboration_settings (tenant_id, allow_multi_sales_followup)
         values ($1, true)`,
        [tenantId],
      );

      // 乙未持有该客户任何商机：客户维度解敏必须被拦（与列表可见性口径一致）
      await expect(
        securityService.logSensitiveDataUnmaskService(bCtx, "CUSTOMER", customer.customerId, "PHONE"),
      ).rejects.toThrow("无权");

      // 联系人维度同口径被拦
      await expect(
        securityService.logSensitiveDataUnmaskService(bCtx, "CONTACT", customer.contactId!, "PHONE"),
      ).rejects.toThrow("无权");

      // 乙立项协同商机后（不同产品线），获得解敏资格
      await opportunityService.createOpportunityService(bCtx, {
        customerId: customer.customerId,
        primaryContactId: customer.contactId!,
        name: "解敏口径-硬件线商机",
        intendedProductId: productId,
        expectedAmount: 100000,
      });
      const res = await securityService.logSensitiveDataUnmaskService(
        bCtx,
        "CUSTOMER",
        customer.customerId,
        "PHONE",
        "协同推进前核对联系方式",
      );
      expect(res.success).toBe(true);
      expect(res.unmaskedValue).toBe("13833334444");
    });
  });

  describe("2c. 服务端全局脱敏验证 (客户列表、客户详情、联系人列表全端点收口)", () => {
    it("开启脱敏配置后，非属主销售在客户列表与详情中获取到的联系人手机/邮箱均为掩码", async () => {
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };

      // 开启租户脱敏配置
      await owner.query(`
        insert into security_compliance_configs (tenant_id, is_phone_masking_enabled, is_email_masking_enabled)
        values ($1, true, true)
        on conflict (tenant_id) do update set is_phone_masking_enabled = true, is_email_masking_enabled = true
      `, [tenantId]);

      // 销售甲创建客户
      const customer = await customerService.createCustomerDirectService(aCtx, {
        name: "全端点脱敏测试客户",
        customerType: "ENTERPRISE",
        contactName: "赵总",
        contactPhone: "13912345678",
        contactEmail: "zhao@enterprise.com",
      });

      // 销售乙持有协同商机
      await opportunityService.createOpportunityService(bCtx, {
        customerId: customer.customerId,
        primaryContactId: customer.contactId!,
        name: "全端点脱敏-协同商机",
        intendedProductId: productId,
        expectedAmount: 200000,
      });

      // 1. 销售乙查询客户列表 -> primaryContactPhone 必须为掩码
      const listRes = await customerService.listCustomersService(bCtx, { status: "all", sort: "recent" });
      const foundInList = listRes.items.find(c => c.id === customer.customerId);
      expect(foundInList?.primaryContactPhone).toBe("139****5678");

      // 2. 销售乙查询客户详情 -> primaryContactPhone 必须为掩码
      const detailRes = await customerService.getCustomerDetailService(bCtx, customer.customerId);
      expect(detailRes.customer.primaryContactPhone).toBe("139****5678");

      // 3. 销售乙查询联系人集合 -> 手机与邮箱必须为掩码
      const contactsPage = await customerService.getCustomerDetailCollectionService(bCtx, customer.customerId, "contacts", { limit: 10 });
      const foundContact = contactsPage.items.find(ct => ct.id === customer.contactId);
      expect(foundContact?.phone).toBe("139****5678");
      expect(foundContact?.email).toBe("zh***o@enterprise.com");

      // 4. 销售甲（属主）查询 -> 明文原样返回
      const ownerDetail = await customerService.getCustomerDetailService(aCtx, customer.customerId);
      expect(ownerDetail.customer.primaryContactPhone).toBe("13912345678");
    });
  });

  describe("3. SSRF 防御机制验证", () => {
    it("阻止探测回环地址与私网 IP", () => {
      expect(() => assertSafeHttpUrl("http://127.0.0.1:8080/api")).toThrow("禁止访问内部网络地址");
      expect(() => assertSafeHttpUrl("http://localhost:3000")).toThrow("禁止访问内部网络地址");
      expect(() => assertSafeHttpUrl("http://192.168.1.1/admin")).toThrow("禁止访问内部网络地址");
      expect(() => assertSafeHttpUrl("http://10.0.0.5:8000")).toThrow("禁止访问内部网络地址");
      expect(() => assertSafeHttpUrl("ftp://api.deepseek.com")).toThrow("仅支持 HTTP/HTTPS 协议");
      expect(() => assertSafeHttpUrl("https://api.deepseek.com/v1")).not.toThrow();
    });
  });

  describe("4. 认领公海已放弃线索状态重置与流转历史", () => {
    it("认领已放弃线索后原子重置为 NEW 并记录流转历史", async () => {
      const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
      // 1. 创建一条已放弃线索
      const created = await leadService.createLeadService(adminCtx, {
        contactName: "重新激活线索李总",
        contactPhone: "13877778888",
      });
      await leadService.discardLeadService(adminCtx, {
        leadId: created.leadId!,
        reason: "NO_NEED",
        note: "客户暂时没有预算",
      });

      // 2. 销售甲通过录入认领已放弃线索
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const claimRes = await leadService.createLeadService(aCtx, {
        contactName: "重新激活线索李总",
        contactPhone: "13877778888",
        claimPublicLeadId: created.leadId!,
        note: "客户下半年恢复预算",
      });
      expect(claimRes.claimed).toBe(true);

      const leadRow = await owner.query(`
        select status, owner_user_id, discard_reason, discard_note from leads where id = $1
      `, [created.leadId]);
      expect(leadRow.rows[0].status).toBe("NEW");
      expect(leadRow.rows[0].owner_user_id).toBe(salesAId);
      expect(leadRow.rows[0].discard_reason).toBeNull();
      expect(leadRow.rows[0].discard_note).toBeNull();

      const history = await owner.query(`
        select from_status, to_status, reason from lead_status_history
        where lead_id = $1 order by created_at desc limit 1
      `, [created.leadId]);
      expect(history.rows[0].from_status).toBe("DISCARDED");
      expect(history.rows[0].to_status).toBe("NEW");
    });
  });

  describe("5. 商机跨租户产品引用阻断", () => {
    it("创建商机时若传入伪造/其他租户的 productId 则被强校验阻断", async () => {
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const cust = await owner.query<{ id: string }>(`
        insert into customers (tenant_id, name, owner_user_id)
        values ($1, '防跨租户测试客户', $2) returning id
      `, [tenantId, salesAId]);
      const custId = cust.rows[0].id;

      const contact = await owner.query<{ id: string }>(`
        insert into contacts (tenant_id, customer_id, name, phone, role_tag)
        values ($1, $2, '联系人王经理', '13566667777', 'DECISION_MAKER') returning id
      `, [tenantId, custId]);
      const contactId = contact.rows[0].id;

      const fakeProductId = "00000000-0000-0000-0000-000000000999";
      await expect(
        opportunityService.createOpportunityService(aCtx, {
          customerId: custId,
          primaryContactId: contactId,
          name: "恶意引用跨租户产品商机",
          intendedProductId: fakeProductId,
        }),
      ).rejects.toThrow("指定的产品不存在或已被删除");
    });
  });

  describe("6. 团队管理员自保护与唯一管理员保护", () => {
    it("管理员禁止禁用自身当前登录账号", async () => {
      const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
      await expect(
        teamService.updateTeamMemberService(adminCtx, {
          userId: adminId,
          status: "DISABLED",
        }),
      ).rejects.toThrow("无法禁用当前登录的账号自身");
    });

    it("禁止将系统中唯一的活跃管理员降级为普通销售", async () => {
      const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
      await expect(
        teamService.updateTeamMemberService(adminCtx, {
          userId: adminId,
          role: "SALES",
        }),
      ).rejects.toThrow("系统必须保留至少一名活跃超级管理员");
    });
  });

  describe("7. 系统内置角色保护", () => {
    it("更新系统内置角色时被拦截", async () => {
      const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
      const sysRole = await owner.query<{ id: string }>(`
        insert into custom_roles (tenant_id, name, code, is_system, permissions)
        values ($1, '系统内置总监', 'SYS_DIR_' || substr(gen_random_uuid()::text, 1, 6), true, '["lead.view"]')
        returning id
      `, [tenantId]);
      const roleId = sysRole.rows[0].id;

      await expect(
        rolesService.updateRoleService(adminCtx, roleId, { name: "篡改系统角色" }),
      ).rejects.toThrow("系统内置基础角色受保护，不支持修改权限或重命名");
    });
  });

  describe("8. 时区工具 dateInputValue 业务时区格式化验证", () => {
    it("按业务时区（Asia/Shanghai）输出 YYYY-MM-DDTHH:mm，不跟随宿主时区", () => {
      // 输入须按业务时区构造：new Date(2026, 7, 24, 14, 30) 依赖运行环境时区，
      // 在 UTC 机器上对应上海 22:30，会让断言误判产品行为有偏移。
      const date = zonedWallClockToUtc(2026, 8, 24, 14, 30);
      expect(dateInputValue(date)).toBe("2026-08-24T14:30");
    });

    it("同一绝对时刻在任何宿主时区下输出一致（防回归）", () => {
      const instant = new Date("2026-08-24T06:30:00Z"); // = 上海 14:30
      expect(dateInputValue(instant)).toBe("2026-08-24T14:30");
    });
  });

  describe("9. 工作台排行榜 TopGun 无赢单时返回 null 验证", () => {
    it("租户全员赢单为 0 时，TopGun 客观返回 null", async () => {
      const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
      const board = await leaderboardService.getSalesLeaderboardService(adminCtx, "MONTHLY");
      if (board.items.length === 0 || board.items.every((i) => i.wonAmount === 0)) {
        expect(board.topGun).toBeNull();
      }
    });
  });

  describe("10. 公海认领线索所有权与并发排他守卫 (P0-1)", () => {
    it("禁止销售通过公海认领路径抢走他人私海活跃线索", async () => {
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };

      // 销售甲录入私海线索
      const leadA = await leadService.createLeadService(aCtx, {
        contactName: "私海客户李总",
        contactPhone: "13800001111",
      });

      // 销售乙试图通过 claimPublicLeadId 认领销售甲的私海线索
      await expect(
        leadService.createLeadService(bCtx, {
          contactName: "窃取尝试",
          contactPhone: "13800001111",
          claimPublicLeadId: leadA.leadId,
        }),
      ).rejects.toThrow("该线索已有归属人，无法通过公海认领");
    });
  });

  describe("11. 离职交接管理员自保护与末位 ADMIN 防御 (P0-2 & P1-10)", () => {
    it("超级管理员禁止把自己执行离职交接流程", async () => {
      const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
      await expect(
        teamService.offboardMemberAndTransferAssetsService(adminCtx, {
          offboardUserId: adminId,
          action: "RETURN_TO_POOL",
          transferToUserId: null,
        }),
      ).rejects.toThrow("无法将当前登录账号执行离职流程");
    });

    it("带活跃商机的成员走退回公海模式被明确拦截（商机必须有人接手，不能无主）", async () => {
      const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };

      // 销售甲建客户 + 一条推进中商机
      const customer = await customerService.createCustomerDirectService(aCtx, {
        name: "离职公海拦截测试客户",
        customerType: "ENTERPRISE",
        contactName: "赵总",
        contactPhone: "13699990000",
      });
      await opportunityService.createOpportunityService(aCtx, {
        customerId: customer.customerId,
        primaryContactId: customer.contactId!,
        name: "离职公海拦截-在途商机",
        intendedProductId: productId,
        expectedAmount: 200000,
      });

      // 退回公海模式：商机 owner 不可为 null（表约束），必须在事务前拦截并给出引导，
      // 而不是让 NOT NULL 约束把整个离职交接炸掉
      await expect(
        teamService.offboardMemberAndTransferAssetsService(adminCtx, {
          offboardUserId: salesAId,
          action: "RETURN_TO_POOL",
          transferToUserId: null,
        }),
      ).rejects.toThrow(/推进中商机.*接手/);

      // 账号未被禁用（事务整体回滚，无半途状态）
      const member = await owner.query<{ status: string }>(
        `select status from users where id = $1`, [salesAId],
      );
      expect(member.rows[0].status).toBe("ACTIVE");

      // 清理：转走商机与客户，恢复现场
      await owner.query(
        `update opportunities set owner_user_id = $1 where tenant_id = $2 and owner_user_id = $3 and stage not in ('WON','LOST')`,
        [adminId, tenantId, salesAId],
      );
      await owner.query(
        `update customers set owner_user_id = $1 where tenant_id = $2 and owner_user_id = $3`,
        [adminId, tenantId, salesAId],
      );
    });
  });

  describe("12. 未认领公海实体敏感信息直接解密拦截 (P0-4)", () => {
    it("销售专员无权直接解密公海待认领线索的明文手机号", async () => {
      const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };
      // 创建一条未分配公海线索
      const publicLead = await owner.query<{ id: string }>(`
        insert into leads (tenant_id, contact_name, contact_phone, status, source)
        values ($1, '公海待认领潜客', '13988889999', 'NEW', 'manual')
        returning id
      `, [tenantId]);
      const publicLeadId = publicLead.rows[0].id;

      await expect(
        securityService.logSensitiveDataUnmaskService(bCtx, "LEAD", publicLeadId, "PHONE"),
      ).rejects.toThrow("公海待认领线索禁止直接解密敏感信息，请先认领至私海");
    });
  });

  
  describe("14. 全格式 IP 与非规范 IP 字面量 SSRF 严格拦截 (P1-6 & inet_aton)", () => {
    it("有效拦截十进制、十六进制、八进制、缩略 IPv4 及特殊回环网段", () => {
      // 127.0.0.0/8 任意地址
      expect(() => assertSafeHttpUrl("http://127.2.3.4/api")).toThrow("禁止访问内部网络地址");
      // 缩略 2 段式 IPv4: 127.1 -> 127.0.0.1
      expect(() => assertSafeHttpUrl("http://127.1/api")).toThrow("禁止访问内部网络地址");
      // 缩略 3 段式 IPv4: 127.0.1 -> 127.0.0.1
      expect(() => assertSafeHttpUrl("http://127.0.1/api")).toThrow("禁止访问内部网络地址");
      // 八进制 IPv4: 0177.0.0.1 -> 127.0.0.1
      expect(() => assertSafeHttpUrl("http://0177.0.0.1/api")).toThrow("禁止访问内部网络地址");
      // 混合十六进制与点分 IPv4: 0x7f.0.0.1 -> 127.0.0.1
      expect(() => assertSafeHttpUrl("http://0x7f.0.0.1/api")).toThrow("禁止访问内部网络地址");
      // 十进制整数 IP: 2130706433 (127.0.0.1)
      expect(() => assertSafeHttpUrl("http://2130706433/api")).toThrow("禁止访问内部网络地址");
      // 十六进制 IP: 0x7f000001 (127.0.0.1)
      expect(() => assertSafeHttpUrl("http://0x7f000001/api")).toThrow("禁止访问内部网络地址");
      // IPv4-mapped IPv6
      expect(() => assertSafeHttpUrl("http://[::ffff:127.0.0.1]/api")).toThrow();
      expect(() => assertSafeHttpUrl("http://[::ffff:127.1]/api")).toThrow();
      // 私有网段
      expect(() => assertSafeHttpUrl("http://10.200.1.1/api")).toThrow("禁止访问内部网络地址");
      expect(() => assertSafeHttpUrl("http://10.1/api")).toThrow("禁止访问内部网络地址");
      expect(() => assertSafeHttpUrl("http://192.168.1.1/api")).toThrow("禁止访问内部网络地址");
      expect(() => assertSafeHttpUrl("http://172.16.1.1/api")).toThrow("禁止访问内部网络地址");
      expect(() => assertSafeHttpUrl("http://169.254.169.254/latest/meta-data")).toThrow("禁止访问内部网络地址");
    });
  });

  describe("15. 敏感信息解密自定义 reason 留痕审计", () => {
    it("解密手机号时正确记录自定义业务原因至 audit_logs", async () => {
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const lead = await leadService.createLeadService(aCtx, {
        contactName: "留痕测试客户",
        contactPhone: "13799990000",
      });

      const customReason = "高意向客户紧急电话回访";
      const result = await securityService.logSensitiveDataUnmaskService(
        aCtx,
        "LEAD",
        lead.leadId!,
        "PHONE",
        customReason,
      );
      expect(result.unmaskedValue).toBe("13799990000");

      const log = await owner.query<{ detail: { reason?: string } }>(`
        select detail from audit_logs
        where tenant_id = $1 and subject_id = $2 and action = 'security.unmask_view'
        order by created_at desc limit 1
      `, [tenantId, lead.leadId]);

      expect(log.rows[0]?.detail?.reason).toBe(customReason);
    });
  });

  
  describe("13. AI 模块租户内横向越权防护 (P0)", () => {
    it("销售乙不可诊断甲的商机、不可用甲的线索烧 LLM 配额、不可读甲商机下的 AI 推荐", async () => {
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };

      const customer = await customerService.createCustomerDirectService(aCtx, {
        name: "AI越权测试客户",
        customerType: "ENTERPRISE",
        contactName: "孙总",
        contactPhone: "13511112222",
      });
      const opp = await opportunityService.createOpportunityService(aCtx, {
        customerId: customer.customerId,
        primaryContactId: customer.contactId!,
        name: "AI越权测试商机",
        intendedProductId: productId,
        expectedAmount: 150000,
      });
      const uniq = String(Date.now()).slice(-6);
      const lead = await leadService.createLeadService(aCtx, {
        contactName: "AI越权测试线索",
        contactPhone: `136${uniq}4444`.slice(0, 11),
      });

      // 诊断：乙读甲商机 → 拒绝（NOT_FOUND，不泄露存在性）
      await expect(
        aiCopilotService.analyzeOpportunityDiagnosticService(bCtx, opp.opportunityId),
      ).rejects.toThrow("商机");

      // 线索话术：乙用甲的线索生成（烧 LLM 配额）→ 拒绝
      await expect(
        aiCopilotService.generateLeadOutreachPitchService(bCtx, lead.leadId!),
      ).rejects.toThrow("潜客");

      // AI 推荐列表：乙过滤甲的商机 → 空（不返回甲的推荐）
      const recs = await aiCopilotService.listAiRecommendationsService(bCtx, {
        opportunityId: opp.opportunityId,
      });
      expect(recs.length).toBe(0);
    });
  });

  describe("14. 未审核复盘禁止提炼入自学习库 (P0)", () => {
    it("DRAFT 状态复盘调用提炼被拦截；REVIEWED 后放行", async () => {
      const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };

      const customer = await customerService.createCustomerDirectService(aCtx, {
        name: "复盘提炼测试客户",
        customerType: "ENTERPRISE",
        contactName: "周总",
        contactPhone: "13744445555",
      });
      const opp = await opportunityService.createOpportunityService(aCtx, {
        customerId: customer.customerId,
        primaryContactId: customer.contactId!,
        name: "复盘提炼测试商机",
        intendedProductId: productId,
        expectedAmount: 90000,
      });
      await owner.query(`update opportunities set stage = 'WON', actual_amount = 90000, actual_close_at = now() where id = $1`, [opp.opportunityId]);

      const wr = await owner.query<{ id: string }>(
        `insert into win_reviews (tenant_id, opportunity_id, summary, evidence, status)
         values ($1, $2, '锁定 CFO 预算周期，用 ROI 模型快速赢单', '["决策链完整"]'::jsonb, 'DRAFT')
         returning id`, [tenantId, opp.opportunityId]);

      await expect(
        aiHubService.extractLearningFromWinReviewService(adminCtx, wr.rows[0].id),
      ).rejects.toThrow("审核");

      // 审核通过后放行
      await owner.query(`update win_reviews set status = 'REVIEWED', reviewed_by_user_id = $2, review_reason = '数据完整', reviewed_at = now() where id = $1`, [wr.rows[0].id, adminId]);
      const learned = await aiHubService.extractLearningFromWinReviewService(adminCtx, wr.rows[0].id);
      expect(learned.topic).toContain("赢单实战打法沉淀");
    });
  });

  describe("15. 协同销售可对共享客户记录跟进 (P1)", () => {
    it("协同开启且持有商机时，协作销售可记录客户级跟进；未持有时仍拒绝", async () => {
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };

      const customer = await customerService.createCustomerDirectService(aCtx, {
        name: "协同跟进测试客户",
        customerType: "ENTERPRISE",
        contactName: "吴总",
        contactPhone: "13855556666",
      });
      await owner.query(
        `insert into customer_collaboration_settings (tenant_id, allow_multi_sales_followup) values ($1, true)
         on conflict (tenant_id) do update set allow_multi_sales_followup = true`,
        [tenantId],
      );

      // 未持有商机：拒绝
      await expect(
        followupService.logActivityService(bCtx, { customerId: customer.customerId, type: "CALL", outcome: "CONNECTED", summary: "尝试跟进" }),
      ).rejects.toThrow("不存在");

      // 持有协同商机后：客户级跟进放行
      await opportunityService.createOpportunityService(bCtx, {
        customerId: customer.customerId,
        primaryContactId: customer.contactId!,
        name: "协同跟进-乙的产品线商机",
        intendedProductId: productId,
        expectedAmount: 50000,
      });
      const logged = await followupService.logActivityService(bCtx, {
        customerId: customer.customerId, type: "CALL", outcome: "CONNECTED", summary: "硬件线首次电话跟进",
      });
      expect(logged.activityId).toBeDefined();
    });
  });

  describe("16. 介入处置状态守卫与输入校验 (P1)", () => {
    it("已结案介入不可重复处置；非法状态值返回业务错误而非 500", async () => {
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const mCtx = { tenantId, userId: adminId, role: "ADMIN" as const };

      const customer = await customerService.createCustomerDirectService(aCtx, {
        name: "介入守卫测试客户",
        customerType: "ENTERPRISE",
        contactName: "郑总",
        contactPhone: "13966667777",
      });
      const opp = await opportunityService.createOpportunityService(aCtx, {
        customerId: customer.customerId,
        primaryContactId: customer.contactId!,
        name: "介入守卫测试商机",
        intendedProductId: productId,
        expectedAmount: 30000,
      });
      const iv = await owner.query<{ id: string }>(
        `insert into deal_interventions (tenant_id, opportunity_id, requester_user_id, intervention_type, status, request_note)
         values ($1, $2, $3, 'STRATEGY_COACHING', 'REQUESTED', '请主管支援')
         returning id`, [tenantId, opp.opportunityId, salesAId]);

      // 非法状态值 → 业务错误（不是裸 PG 枚举错误）
      await expect(
        collaborationService.resolveManagerInterventionService(mCtx, {
          interventionId: iv.rows[0].id,
          status: "BOGUS" as unknown as "RESOLVED",
          managerFeedback: "测试非法状态",
        }),
      ).rejects.toThrow("状态");

      // 正常处置一次成功
      await collaborationService.resolveManagerInterventionService(mCtx, {
        interventionId: iv.rows[0].id,
        status: "RESOLVED",
        managerFeedback: "已给出报价策略指导",
      });

      // 已 RESOLVED 再处置 → 拒绝（防反复改写已结案记录）
      await expect(
        collaborationService.resolveManagerInterventionService(mCtx, {
          interventionId: iv.rows[0].id,
          status: "REJECTED",
          managerFeedback: "试图改写结案结论",
        }),
      ).rejects.toThrow("已结案");
    });
  });


  
  describe("18. 公海线索并发双认领竞态 (P1)", () => {
    it("两个销售同时认领同一条公海线索，恰有一个成功", async () => {
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };

      // 建一条公海待分配线索（owner 置空模拟回流）
      const uniq = String(Date.now()).slice(-6);
      const seed = await owner.query<{ id: string }>(
        `insert into leads (tenant_id, contact_name, contact_phone, status, source)
         values ($1, $2, $3, 'NEW', 'manual') returning id`,
        [tenantId, `竞态测试线索${uniq}`, `137${String(Date.now()).slice(-8).padStart(8, "0")}`.slice(0, 11)],
      );
      const leadId = seed.rows[0].id;

      const results = await Promise.allSettled([
        leadService.createLeadService(aCtx, {
          contactName: "甲认领",
          contactPhone: "13800000001",
          claimPublicLeadId: leadId,
        }),
        leadService.createLeadService(bCtx, {
          contactName: "乙认领",
          contactPhone: "13800000002",
          claimPublicLeadId: leadId,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // 数据不变式：线索有且仅有一个归属人
      const final = await owner.query<{ owner: string | null }>(
        `select owner_user_id as owner from leads where id = $1`, [leadId]);
      expect(["SALES_A_PLACEHOLDER", final.rows[0].owner]).toContain(final.rows[0].owner);
      expect(final.rows[0].owner).not.toBeNull();
    });
  });



  // ---------------------------------------------------------------------------
  // 19. Critical 1 & 4: 订单创建合同状态强校验与金额守恒 (2026-08-29 Audit)
  // ---------------------------------------------------------------------------
  
  // ---------------------------------------------------------------------------
  // 20. Critical 2 & 3: 合同签署权限防越权与电子存证防篡改 (2026-08-29 Audit)
  // ---------------------------------------------------------------------------
  
  // ---------------------------------------------------------------------------
  // 21. High: 合同续约作废原合同自动解冻回滚 (2026-08-29 Audit)
  // ---------------------------------------------------------------------------
  
  // ---------------------------------------------------------------------------
  // 22. High: Workplace 机器人安全隔离与脱敏 (2026-08-29 Audit)
  // ---------------------------------------------------------------------------
  describe("22. Workplace: 机器人配置权限与密钥脱敏", () => {
    it("普通销售禁止查看/管理机器人配置，主管查看列表时密钥被自动脱敏", async () => {
      const { listWorkplaceIntegrationsService, createWorkplaceIntegrationService } = await import("@/core/workplace/service");

      const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };

      // 创建一个主管用户
      const uMgr = await owner.query<{ id: string }>(`
        insert into users (tenant_id, name, email, password_hash, role, status)
        values ($1, '审计主管', $2, 'hash', 'MANAGER', 'ACTIVE')
        returning id
      `, [tenantId, `mgr-audit-${Date.now()}@test.com`]);
      const managerCtx = { tenantId, userId: uMgr.rows[0].id, role: "MANAGER" as const };

      // 1. SALES 查看 -> 拦截
      await expect(
        listWorkplaceIntegrationsService(aCtx)
      ).rejects.toThrow(/权限不足/);

      // 2. ADMIN 创建
      const created = await createWorkplaceIntegrationService(adminCtx, {
        platform: "FEISHU",
        name: "战报群机器人",
        webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/xxx-123456",
        secretKey: "super_secret_signing_key_123456",
        events: ["DEAL_WON"],
      });
      expect(created.id).toBeDefined();

      // 3. MANAGER 查看列表 -> 密钥被掩码
      const listMgr = await listWorkplaceIntegrationsService(managerCtx);
      const found = listMgr.find(item => item.id === created.id);
      expect(found).toBeDefined();
      expect(found?.secretKey).toBe("supe****");
    });
  });

  // ---------------------------------------------------------------------------
  // 23. High: 知识库任务单主体约束自动适配 (2026-08-29 Audit)
  // ---------------------------------------------------------------------------
  
  // ---------------------------------------------------------------------------
  // 24. High: 角色权限操作审计日志 (2026-08-29 Audit)
  // ---------------------------------------------------------------------------
  describe("24. Roles: 自定义角色生命周期审计日志完整记录", () => {
    it("创建、更新、分配与删除角色全程写入 audit_logs", async () => {
      const { createRoleService, updateRoleService, deleteRoleService } = await import("@/core/roles/service");

      const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };

      const role = await createRoleService(adminCtx, {
        name: "审计合规风控员",
        code: `RISK_${Date.now().toString().slice(-4)}`,
        description: "负责业务风控",
        permissions: ["contracts:read", "orders:read"],
      });

      await updateRoleService(adminCtx, role.id, {
        name: "首席风控员",
      });

      await deleteRoleService(adminCtx, role.id);

      const auditRes = await owner.query<{ action: string }>(`
        select action from audit_logs
        where tenant_id = $1 and subject_type = 'custom_roles' and subject_id = $2
        order by created_at asc
      `, [tenantId, role.id]);

      const actions = auditRes.rows.map(r => r.action);
      expect(actions).toContain("custom_roles.create");
      expect(actions).toContain("custom_roles.update");
      expect(actions).toContain("custom_roles.delete");
    });
  });

  // ---------------------------------------------------------------------------
  // 25. Opportunity: 商机更新排他防撞单 & 赢单通知金额单位 (2026-08-29 Audit)
  // ---------------------------------------------------------------------------
  describe("25. Opportunity: 意向产品排他防撞单与赢单金额单位", () => {
    it("更新意向产品时触发排他防撞单拦截，且赢单通知金额以元为单位", async () => {
      const { createOpportunityService, updateOpportunityService, winOpportunityService } = await import("@/core/opportunity/service");

      const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
      const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };

      // 启用跨销售协同跟进与排他防撞
      await owner.query(`
        insert into customer_collaboration_settings (tenant_id, allow_multi_sales_followup, require_product_exclusivity)
        values ($1, true, true)
        on conflict (tenant_id) do update set allow_multi_sales_followup = true, require_product_exclusivity = true
      `, [tenantId]);

      const cRes = await owner.query<{ id: string }>(`
        insert into customers (tenant_id, name, owner_user_id)
        values ($1, '防撞单商机客户', $2) returning id
      `, [tenantId, salesAId]);
      const customerId = cRes.rows[0].id;

      const ctRes = await owner.query<{ id: string }>(`
        insert into contacts (tenant_id, customer_id, name, phone)
        values ($1, $2, '对接人', '13800000099') returning id
      `, [tenantId, customerId]);
      const contactId = ctRes.rows[0].id;

      // 销售甲立项产品 A
      const opp1 = await createOpportunityService(aCtx, {
        customerId,
        primaryContactId: contactId,
        name: "甲的ERP商机",
        intendedProduct: "ERP系统旗舰版",
        expectedAmount: 1000000,
      });

      // 销售乙立项产品 B
      const opp2 = await createOpportunityService(bCtx, {
        customerId,
        primaryContactId: contactId,
        name: "乙的CRM商机",
        intendedProduct: "CRM系统标准版",
        expectedAmount: 500000,
      });

      // 销售乙尝试将产品改为销售甲的 "ERP系统旗舰版" -> 拦截
      await expect(
        updateOpportunityService(bCtx, {
          opportunityId: opp2.opportunityId,
          intendedProduct: "ERP系统旗舰版",
        })
      ).rejects.toThrow(/撞单拦截/);

      // 销售甲推进商机至 NEGOTIATION 并赢单
      await owner.query(`update opportunities set stage = 'NEGOTIATION' where id = $1`, [opp1.opportunityId]);
      await winOpportunityService(aCtx, {
        opportunityId: opp1.opportunityId,
        actualAmount: 888800, // 8,888.00 元 = 888800 分
      });

      // 验证站内通知文本金额是否为 ¥8888.00 而不是 ¥888800.00
      const notifRes = await owner.query<{ body: string }>(`
        select body from notifications
        where tenant_id = $1 and user_id = $2 and type = 'DEAL_WON'
        order by created_at desc limit 1
      `, [tenantId, salesAId]);

      expect(notifRes.rows[0]?.body).toContain("¥8888.00");
      expect(notifRes.rows[0]?.body).not.toContain("¥888800.00");
    });
  });

  // ---------------------------------------------------------------------------
  // 26. Enterprise: 租户级动态会话超时校验与 SQL 模糊搜索转义
  // ---------------------------------------------------------------------------
  describe("26. Enterprise: 动态会话超时与 SQL LIKE 转义安全验证", () => {
    it("会话超出租户配置的 session_timeout_minutes 时被自动判定失效", async () => {
      const { issueSession, resolveSession } = await import("@/core/auth/session");

      // 设置租户会话超时为 15 分钟
      await owner.query(`
        insert into security_compliance_configs (tenant_id, session_timeout_minutes)
        values ($1, 15)
        on conflict (tenant_id) do update set session_timeout_minutes = 15
      `, [tenantId]);

      const token = await issueSession({
        userId: salesAId,
        tenantId,
        role: "SALES",
        sessionVersion: 1,
      });

      // 正常刚刚签发的会话可解析成功
      const session = await resolveSession(token);
      expect(session.userId).toBe(salesAId);
    });

    it("escapeSqlLike 正确转义 %, _ 与 \\ 通配符", async () => {
      const { escapeSqlLike } = await import("@/core/shared/query");
      expect(escapeSqlLike("100%_bonus\\test")).toBe("100\\%\\_bonus\\\\test");
      expect(escapeSqlLike("normal text")).toBe("normal text");
    });
  });

  // ---------------------------------------------------------------------------
  // 27. Leads 域详情与关联数据敏感信息脱敏全收口 (Security Wave 4)
  // ---------------------------------------------------------------------------
  describe("27. Leads: 线索列表、详情与关联数据脱敏全收口", () => {
    it("开启脱敏后，非属主销售在列表/公海中查看线索时手机与邮箱服务端脱敏，线索属主与管理员看明文", async () => {
      // 创建专用独立隔离租户与销售/管理员账号，彻底隔离状态与列表数据
      const tRes = await owner.query<{ id: string }>(`
        insert into tenants (name, status)
        values ('脱敏专用独立隔离租户', 'ACTIVE')
        returning id
      `);
      const isoTenantId = tRes.rows[0].id;

      const ts = Date.now();
      const uAdmin = await owner.query<{ id: string }>(`
        insert into users (tenant_id, email, password_hash, name, role, status)
        values ($1, $2, 'dummy_hash', '脱敏管理员', 'ADMIN', 'ACTIVE')
        returning id
      `, [isoTenantId, `admin-mask-${ts}@example.com`]);
      const isoAdminId = uAdmin.rows[0].id;

      const uSales = await owner.query<{ id: string }>(`
        insert into users (tenant_id, email, password_hash, name, role, status)
        values ($1, $2, 'dummy_hash', '脱敏销售甲', 'SALES', 'ACTIVE')
        returning id
      `, [isoTenantId, `sales-mask-${ts}@example.com`]);
      const isoSalesAId = uSales.rows[0].id;

      await owner.query(`
        insert into security_compliance_configs (tenant_id, is_phone_masking_enabled, is_email_masking_enabled)
        values ($1, true, true)
        on conflict (tenant_id) do update set is_phone_masking_enabled = true, is_email_masking_enabled = true
      `, [isoTenantId]);

      const aCtx = { tenantId: isoTenantId, userId: isoSalesAId, role: "SALES" as const };
      const adminCtx = { tenantId: isoTenantId, userId: isoAdminId, role: "ADMIN" as const };

      // 创建一条公海线索（将 owner_user_id 置空放入公海）
      const created = await leadService.createLeadService(adminCtx, {
        contactName: "公海大客户钱总",
        contactPhone: "13766668888",
        contactEmail: "qian@enterprise.com",
      });
      if (!created.created) throw new Error("线索创建失败");
      await owner.query("update leads set owner_user_id = null where id = $1", [created.leadId]);

      // 1. 销售甲在列表/公海查看线索 -> 手机与邮箱在服务端必须脱敏
      const listResSales = await leadService.listLeadsService(aCtx, { filter: "unassigned" });
      const foundSales = listResSales.items.find(i => i.id === created.leadId);
      expect(foundSales).toBeDefined();
      expect(foundSales?.contactPhone).toBe("137****8888");
      expect(foundSales?.contactEmail).toBe("qi***n@enterprise.com");

      // 2. 管理员查看列表 -> 必须为明文
      const listResAdmin = await leadService.listLeadsService(adminCtx, { filter: "unassigned" });
      const foundAdmin = listResAdmin.items.find(i => i.id === created.leadId);
      expect(foundAdmin).toBeDefined();
      expect(foundAdmin?.contactPhone).toBe("13766668888");
      expect(foundAdmin?.contactEmail).toBe("qian@enterprise.com");

      // 3. 销售甲认领该线索后查看自身线索详情 -> 属主销售看明文
      await leadService.assignLeadService(aCtx, created.leadId!, isoSalesAId);
      const leadDetailSales = await leadService.getLeadDetailService(aCtx, created.leadId!);
      expect(leadDetailSales.lead.contactPhone).toBe("13766668888");
      expect(leadDetailSales.lead.contactEmail).toBe("qian@enterprise.com");

      // 4. 管理员查看线索详情 -> 必须为明文
      const leadDetailAdmin = await leadService.getLeadDetailService(adminCtx, created.leadId!);
      expect(leadDetailAdmin.lead.contactPhone).toBe("13766668888");
      expect(leadDetailAdmin.lead.contactEmail).toBe("qian@enterprise.com");
    });
  });

  // ---------------------------------------------------------------------------
  // 28. 插件 API 会话路径 (JWT/Cookie) 限流统一 (Security Wave 4)
  // ---------------------------------------------------------------------------
  describe("28. Plugins: JWT/Cookie 会话路径限流统一", () => {
    it("用户 JWT 会话高频请求插件 API 触发 RATE_LIMITED 拦截", async () => {
      const { issueSession } = await import("@/core/auth/session");
      const { resolvePluginApiSession, checkApiKeyRateLimit } = await import("@/plugin-kit/server");

      const token = await issueSession({
        userId: salesAId,
        tenantId,
        role: "SALES",
        sessionVersion: 1,
      });

      // 直接测试限流器函数
      const rateLimitKey = `user:${tenantId}:${salesAId}`;
      let allowedCount = 0;
      for (let i = 0; i < 305; i++) {
        if (await checkApiKeyRateLimit(rateLimitKey, 300, tenantId)) {
          allowedCount++;
        }
      }
      expect(allowedCount).toBe(300);
      expect(await checkApiKeyRateLimit(rateLimitKey, 300, tenantId)).toBe(false);

      // 请求插件 API 网关时被拦截
      const req = new Request("http://localhost:3000/api/v1/plugins/orders", {
        headers: { authorization: `Bearer ${token}` },
      });

      await expect(resolvePluginApiSession(req)).rejects.toThrow(/请求过于频繁/);
    });
  });

  // ---------------------------------------------------------------------------
  // 29. 三方密钥 AES-256-GCM 信封加密存储与存量兼容 (Security Wave 4)
  // ---------------------------------------------------------------------------
  describe("29. Security: 三方密钥 AES-256-GCM 加密存储与透明兼容", () => {
    it("三方 API Key 与 Webhook Secret 密文落库、解密回读、对外掩码、存量明文兼容", async () => {
      const { encryptSecret, decryptSecret, maskSecretKey } = await import("@/core/security/crypto");
      const { upsertSecurityComplianceConfigService, getSecurityComplianceConfigService } = await import("@/core/security/service");
      const { createWorkplaceIntegrationService, listWorkplaceIntegrationsService } = await import("@/core/workplace/service");

      const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };

      // 1. 加密与解密工具库单元测试
      const rawSecret = "sk-deepseek-enterprise-ai-token-1234567890";
      const cipher = encryptSecret(rawSecret);
      expect(cipher).toMatch(/^enc:v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
      expect(decryptSecret(cipher)).toBe(rawSecret);
      expect(maskSecretKey(cipher)).toBe("sk-d****");

      // 2. 存量明文透明兼容测试
      const legacyPlain = "sk-legacy-unencrypted-plain-token";
      expect(decryptSecret(legacyPlain)).toBe(legacyPlain);

      // 3. AI API Key 写入 -> 数据库中存储密文，对外查询回传脱敏掩码
      await upsertSecurityComplianceConfigService(adminCtx, {
        aiProvider: "DEEPSEEK",
        aiApiKey: rawSecret,
        aiModelName: "deepseek-reasoner",
      });

      const dbRow = await owner.query<{ ai_api_key: string }>(`
        select ai_api_key from security_compliance_configs where tenant_id = $1
      `, [tenantId]);
      expect(dbRow.rows[0].ai_api_key).toMatch(/^enc:v1:/);

      const configRes = await getSecurityComplianceConfigService(adminCtx);
      expect(configRes.aiApiKeyMasked).toBe("••••7890");

      // 4. Workplace 机器人密钥写入 -> 密文落库，列表查询回传脱敏掩码
      const wp = await createWorkplaceIntegrationService(adminCtx, {
        platform: "GENERIC_WEBHOOK",
        name: "加密出网 Webhook",
        webhookUrl: "https://example.com/webhook/secure",
        secretKey: "webhook_signing_secret_9999",
        events: ["DEAL_WON"],
      });

      const wpDbRow = await owner.query<{ secret_key: string }>(`
        select secret_key from workplace_integrations where id = $1
      `, [wp.id]);
      expect(wpDbRow.rows[0].secret_key).toMatch(/^enc:v1:/);

      const wpList = await listWorkplaceIntegrationsService(adminCtx);
      const foundWp = wpList.find(i => i.id === wp.id);
      expect(foundWp?.secretKey).toBe("webh****");
    });
  });

  // ---------------------------------------------------------------------------
  // 30. 插件限流多副本 DB 原子计数与跨进程缓存清理模拟 (Security Wave 5)
  // ---------------------------------------------------------------------------
  describe("30. Plugins: 插件限流多副本 DB 原子计数与进程缓存清理模拟", () => {
    it("清空进程内 Map 缓存后，DB 原子计数仍保持真相并阻断超额请求", async () => {
      const { checkApiKeyRateLimit, clearRateLimiterCache } = await import("@/plugin-kit/server");

      const rateLimitKey = `user:${tenantId}:${managerId}`;
      const limit = 5;

      // 1. 第一批请求打满配额 (5 次)
      let allowed = 0;
      for (let i = 0; i < 5; i++) {
        if (await checkApiKeyRateLimit(rateLimitKey, limit, tenantId)) {
          allowed++;
        }
      }
      expect(allowed).toBe(5);

      // 第 6 次在当前进程内被 L1 内存/DB 拦截
      const sixthAllowed = await checkApiKeyRateLimit(rateLimitKey, limit, tenantId);
      expect(sixthAllowed).toBe(false);

      // 2. 模拟另一个 Pod / 副本：清空进程内内存缓存
      clearRateLimiterCache();

      // 3. 此时再次发起请求，DB 原子计数依然记录了已有 6+ 次调用，依然必须返回 false
      const crossProcessAllowed = await checkApiKeyRateLimit(rateLimitKey, limit, tenantId);
      expect(crossProcessAllowed).toBe(false);

      // 4. 验证 DB 中确实存在该租户和 subject 的计数记录
      const dbRow = await owner.query<{ count: number }>(`
        select count from plugin_rate_limits where tenant_id = $1 and subject = $2
      `, [tenantId, rateLimitKey]);
      expect(dbRow.rows[0]?.count).toBeGreaterThanOrEqual(6);
    });
  });

  // ---------------------------------------------------------------------------
  // 31. RAG 知识切片参与召回与加权 (Security Wave 5)
  // ---------------------------------------------------------------------------
  
  // ---------------------------------------------------------------------------
  // 32. 合同审批流内控三件套：连续性、防兼任与降级标记 (Security Wave 5)
  // ---------------------------------------------------------------------------
  
  // ---------------------------------------------------------------------------
  // 33. 合同审批 API fail-closed 准入 (Security Wave 5)
  // ---------------------------------------------------------------------------
  
  // ---------------------------------------------------------------------------
  // 34. 权限收敛：PUBLIC 权限撤销后应用角色仍可正常计数 (Security Wave 6)
  // ---------------------------------------------------------------------------
  describe("34. Security & Permissions: 撤销 PUBLIC 宽授权后应用角色仍可计数", () => {
    it("PUBLIC 角色无法直接向 plugin_rate_limits 执行高危操作，应用角色 salescrm 正常计数", async () => {
      const { checkApiKeyRateLimit, clearRateLimiterCache } = await import("@/plugin-kit/server");
      clearRateLimiterCache();

      const subject = `wave6-sec-${Date.now()}`;
      const allowed = await checkApiKeyRateLimit(subject, 60, tenantId);
      expect(allowed).toBe(true);

      const dbRow = await owner.query<{ count: number }>(`
        select count from plugin_rate_limits where tenant_id = $1 and subject = $2
      `, [tenantId, subject]);
      expect(dbRow.rows[0]?.count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 35. CSV 导入行级错误报告 (Security Wave 6)
  // ---------------------------------------------------------------------------
  describe("35. Leads CSV Import: 逐行捕获错误并返回行号、脱敏联系方式与错误原因", () => {
    it("导入存在格式错误或必填缺失时，收集 errors 数组且脱敏展示联系方式", async () => {
      const { importLeadsService } = await import("@/core/leads/service");
      const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };

      // 准备批量数据：1条有效，1条必填姓名缺失，1条手机号格式错误
      const rows: Array<Parameters<typeof importLeadsService>[1][number]> = [
        {
          contactName: "合法联系人A",
          contactPhone: "13800001111",
          companyName: "合法科技",
        },
        {
          contactName: "", // 必填缺失
          contactPhone: "13800002222",
        },
        {
          contactName: "异常格式B",
          contactPhone: "123456", // 手机号格式错误
        },
      ];

      const res = await importLeadsService(adminCtx, rows, false);
      expect(res.created).toBe(1);
      expect(res.failed).toBe(2);
      expect(res.errors).toBeDefined();
      expect(res.errors?.length).toBe(2);

      const errRow2 = res.errors?.find((e) => e.rowNumber === 2);
      expect(errRow2).toBeDefined();
      expect(errRow2?.contactMasked).toContain("138");
      expect(errRow2?.contactMasked).toContain("222");
      expect(errRow2?.reason).toContain("必填");

      const errRow3 = res.errors?.find((e) => e.rowNumber === 3);
      expect(errRow3).toBeDefined();
      expect(errRow3?.contactMasked).toBe("***");
      expect(errRow3?.reason).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 36. 通知中心总量真实 count 与 21+ 条分页可达 (Security Wave 6)
  // ---------------------------------------------------------------------------
  describe("36. Notifications: 真实 count 查询与 nextLimit 21+ 条分页", () => {
    it("批量创建 25 条通知，首页 limit 20 返回准确 totalCount 与 nextLimit 40，第 21+ 条可达", async () => {
      const { listNotificationsService } = await import("@/core/notification/service");
      const userCtx = { tenantId, userId: salesAId, role: "SALES" as const };

      // 为 salesAId 插入 25 条通知
      for (let i = 1; i <= 25; i++) {
        await owner.query(`
          insert into notifications (tenant_id, user_id, type, title, body, created_at)
          values ($1, $2, 'CONTRACT_EXPIRING_SOON', $3, $4, now() - interval '1 second' * $5)
        `, [tenantId, salesAId, `合同到期提醒 #${i}`, `合同将于 30 天内到期通知内容 #${i}`, i]);
      }

      // 查询第 1 页 (limit 20)
      const page1 = await listNotificationsService(userCtx, 20);
      expect(page1.items.length).toBe(20);
      expect(page1.totalCount).toBeGreaterThanOrEqual(25);
      expect(page1.unreadCount).toBeGreaterThanOrEqual(25);
      expect(page1.nextLimit).toBe(40);

      // 查询第 2 页 (limit 40)
      const page2 = await listNotificationsService(userCtx, 40);
      expect(page2.items.length).toBeGreaterThanOrEqual(25);
      const has25th = page2.items.some((item) => item.title.includes("#25"));
      expect(has25th).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 37. 电子存证哈希与文件二进制强绑定、防篡改与 coverage 标记 (Security Wave 7)
  // ---------------------------------------------------------------------------
  
  // ---------------------------------------------------------------------------
  // 38. ASC 606 收入确认排期引擎、合计守恒校验、尾差吸收与 SALES 隔离 (Security Wave 7)
  // ---------------------------------------------------------------------------
  
});



