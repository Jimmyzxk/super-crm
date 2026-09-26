import { sql } from "drizzle-orm";
import type { TenantContext } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";

function requireManagerOrAdmin(ctx: TenantContext): void {
  if (ctx.role !== "MANAGER" && ctx.role !== "ADMIN") {
    throw new BusinessError("FORBIDDEN", "你没有权限注入团队演示数据");
  }
}

export async function generateAnalyticsDemoDataService(ctx: TenantContext): Promise<{ success: boolean; message: string }> {
  requireManagerOrAdmin(ctx);
  return withTenant(ctx.tenantId, async (tx) => {
    // 1. 获取当前租户下的所有有效用户
    const usersRes = await tx.execute<{ id: string; name: string; role: string }>(sql`
      select id, name, role::text as role from users where tenant_id = ${ctx.tenantId} and status = 'ACTIVE' order by created_at asc
    `);

    const users = usersRes.rows;
    if (users.length === 0) {
      return { success: false, message: "未找到当前租户的用户" };
    }

    const u1 = users[0].id;
    const u2 = users[1]?.id ?? u1;
    const u3 = users[2]?.id ?? u1;

    // 2. 软删除旧的历史测试业务数据（仅限 DEMO_ 前缀的数据）
    await tx.execute(sql`update tasks set status = 'CANCELLED' where tenant_id = ${ctx.tenantId} and status = 'OPEN' and (lead_id in (select id from leads where tenant_id = ${ctx.tenantId} and contact_name like '【演示】%') or opportunity_id in (select id from opportunities where tenant_id = ${ctx.tenantId} and name like '【演示】%'))`);
    await tx.execute(sql`update opportunities set deleted_at = now() where tenant_id = ${ctx.tenantId} and name like '【演示】%' and deleted_at is null`);
    await tx.execute(sql`update customers set deleted_at = now() where tenant_id = ${ctx.tenantId} and name like '【演示】%' and deleted_at is null`);
    await tx.execute(sql`update leads set deleted_at = now() where tenant_id = ${ctx.tenantId} and contact_name like '【演示】%' and deleted_at is null`);

    // 3. 批量插入多行业企业客户与个人客户
    const custInputs = [
      { name: "【演示】未来智造工业集团", type: "ENTERPRISE", ind: "智能制造", scale: "501-1000", owner: u1 },
      { name: "【演示】云端数智信息科技", type: "ENTERPRISE", ind: "企服IT", scale: "101-500", owner: u2 },
      { name: "【演示】恒康生物医药股份", type: "ENTERPRISE", ind: "医疗健康", scale: "1000+", owner: u3 },
      { name: "【演示】极速互联物流科技", type: "ENTERPRISE", ind: "智能制造", scale: "101-500", owner: u1 },
      { name: "【演示】新潮零售供应链", type: "ENTERPRISE", ind: "零售消费", scale: "21-100", owner: u2 },
      { name: "【演示】鼎盛金融资管中心", type: "ENTERPRISE", ind: "金融服务", scale: "501-1000", owner: u3 },
      { name: "【演示】陈立峰 (个人创业者)", type: "INDIVIDUAL", ind: "企服IT", scale: null, owner: u1 },
      { name: "【演示】赵雅琪 (独立投资人)", type: "INDIVIDUAL", ind: "金融服务", scale: null, owner: u2 },
    ];

    const customerIds: string[] = [];
    for (const c of custInputs) {
      const res = await tx.execute<{ id: string }>(sql`
        insert into customers (tenant_id, name, customer_type, industry, size, owner_user_id)
        values (${ctx.tenantId}, ${c.name}, ${c.type}, ${c.ind}, ${c.scale}, ${c.owner})
        returning id
      `);
      customerIds.push(res.rows[0].id);
    }

    // 4. 为客户插入联系人
    for (let i = 0; i < customerIds.length; i++) {
      const cId = customerIds[i];
      const phoneNum = `1390000100${i}`;
      await tx.execute(sql`
        insert into contacts (tenant_id, customer_id, name, phone, role_tag, is_primary)
        values
          (${ctx.tenantId}, ${cId}, ${`【演示】联系人${i + 1}`}, ${phoneNum}, ${i % 2 === 0 ? "DECISION_MAKER" : "TECH_EVALUATOR"}, true)
      `);
    }

    // 5. 插入跨 6 个月历史的真实商机数据（包含 WON、LOST、NEGOTIATION、PROPOSAL、DISCOVERY）
    type DemoOppItem = {
      cIdx: number;
      name: string;
      stage: "DISCOVERY" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST";
      amt: number;
      closeMonth?: number;
      owner: string;
      reason?: string;
      note?: string;
    };

    const oppsData: DemoOppItem[] = [
      // 近6个月已赢单 (WON) 真实历史分布
      { cIdx: 0, name: "【演示】工业物联网平台一期", stage: "WON", amt: 12800000, closeMonth: 5, owner: u1 }, // 5个月前
      { cIdx: 1, name: "【演示】企业中台微服务重构", stage: "WON", amt: 8500000, closeMonth: 4, owner: u2 },  // 4个月前
      { cIdx: 2, name: "【演示】智慧医疗数据湖项目", stage: "WON", amt: 26000000, closeMonth: 3, owner: u3 }, // 3个月前
      { cIdx: 3, name: "【演示】智能仓储自动化改造", stage: "WON", amt: 14500000, closeMonth: 2, owner: u1 }, // 2个月前
      { cIdx: 4, name: "【演示】全渠道会员营销系统", stage: "WON", amt: 7200000, closeMonth: 1, owner: u2 },  // 上个月
      { cIdx: 6, name: "【演示】个人技术咨询年框", stage: "WON", amt: 3600000, closeMonth: 0, owner: u1 },   // 当月已赢单
      { cIdx: 5, name: "【演示】金融风控模型私有化部署", stage: "WON", amt: 19800000, closeMonth: 0, owner: u3 }, // 当月已赢单

      // 商务谈判阶段 (NEGOTIATION - 80% 概率，纳入 Commit)
      { cIdx: 0, name: "【演示】工业物联网二期扩容", stage: "NEGOTIATION", amt: 15000000, closeMonth: 0, owner: u1 },
      { cIdx: 1, name: "【演示】数据安全合规审计系统", stage: "NEGOTIATION", amt: 9000000, closeMonth: 0, owner: u2 },

      // 方案报价阶段 (PROPOSAL - 50% 概率)
      { cIdx: 2, name: "【演示】医药冷链温控物联系统", stage: "PROPOSAL", amt: 18000000, closeMonth: 0, owner: u3 },
      { cIdx: 3, name: "【演示】AGV搬运机器人调度中枢", stage: "PROPOSAL", amt: 11000000, closeMonth: 0, owner: u1 },

      // 发现需求阶段 (DISCOVERY - 20% 概率)
      { cIdx: 4, name: "【演示】零售门店AI客流分析", stage: "DISCOVERY", amt: 6500000, closeMonth: 0, owner: u2 },
      { cIdx: 7, name: "【演示】量化投资分析工作站", stage: "DISCOVERY", amt: 4800000, closeMonth: 0, owner: u2 },

      // 输单项目 (LOST - 多维归因分布)
      { cIdx: 0, name: "【演示】旧版MES升级改造", stage: "LOST", amt: 8000000, reason: "COMPETITOR", note: "客户选择老牌低价竞品", owner: u1 },
      { cIdx: 1, name: "【演示】海外业务多语言站点", stage: "LOST", amt: 5000000, reason: "NO_BUDGET", note: "总公司预算缩减暂缓立项", owner: u2 },
      { cIdx: 5, name: "【演示】区块链存证探索项目", stage: "LOST", amt: 12000000, reason: "TIMING", note: "采购时机不成熟", owner: u3 },
    ];

    for (const opp of oppsData) {
      const cId = customerIds[opp.cIdx];
      const isWon = opp.stage === "WON";
      const isLost = opp.stage === "LOST";

      // 计算创建与结单时间
      const mOffset = opp.closeMonth ?? 0;
      const createdDaysAgo = mOffset * 30 + 25;
      const closeDaysAgo = mOffset * 30 + 5;

      const oppRes = await tx.execute<{ id: string }>(sql`
        insert into opportunities (
          tenant_id, customer_id, owner_user_id, name, stage,
          expected_amount, actual_amount,
          stage_entered_at, actual_close_at,
          lost_reason, lost_note,
          created_at, updated_at
        ) values (
          ${ctx.tenantId}, ${cId}, ${opp.owner}, ${opp.name}, ${opp.stage},
          ${opp.amt},
          ${isWon ? opp.amt : null},
          now() - (${createdDaysAgo} * interval '1 day'),
          ${isWon ? sql`now() - (${closeDaysAgo} * interval '1 day')` : null},
          ${isLost ? (opp.reason || null) : null},
          ${isLost ? (opp.note || null) : null},
          now() - (${createdDaysAgo} * interval '1 day'),
          now() - (${isWon ? closeDaysAgo : 1} * interval '1 day')
        ) returning id
      `);

      const oppId = oppRes.rows[0].id;

      // 记录商机历史阶段变更流水
      await tx.execute(sql`
        insert into opportunity_stage_history (tenant_id, opportunity_id, from_stage, to_stage, operator_user_id, created_at)
        values
          (${ctx.tenantId}, ${oppId}, null, 'DISCOVERY', ${opp.owner}, now() - (${createdDaysAgo} * interval '1 day')),
          (${ctx.tenantId}, ${oppId}, 'DISCOVERY', 'PROPOSAL', ${opp.owner}, now() - (${createdDaysAgo - 10} * interval '1 day'))
      `);

      if (opp.stage === "NEGOTIATION" || isWon) {
        await tx.execute(sql`
          insert into opportunity_stage_history (tenant_id, opportunity_id, from_stage, to_stage, operator_user_id, created_at)
          values (${ctx.tenantId}, ${oppId}, 'PROPOSAL', 'NEGOTIATION', ${opp.owner}, now() - (${createdDaysAgo - 18} * interval '1 day'))
        `);
      }

      if (isWon) {
        await tx.execute(sql`
          insert into opportunity_stage_history (tenant_id, opportunity_id, from_stage, to_stage, operator_user_id, created_at)
          values (${ctx.tenantId}, ${oppId}, 'NEGOTIATION', 'WON', ${opp.owner}, now() - (${closeDaysAgo} * interval '1 day'))
        `);
      }
    }

    // 6. 插入多渠道进线线索 (展示渠道质量 ROI 与 7 步漏斗)
    const leadsData = [
      { name: "【演示】智能装配咨询-周工", phone: "13811112201", src: "form:00000000-0000-4000-8000-000000000001", status: "NEW", owner: u1 },
      { name: "【演示】企业SaaS试用-李经理", phone: "13811112202", src: "api:landing_page", status: "CONTACTED", owner: u2 },
      { name: "【演示】医疗影像合作-郭主任", phone: "13811112203", src: "form:00000000-0000-4000-8000-000000000001", status: "QUALIFIED", owner: u3 },
      { name: "【演示】冷链监控采购-王总", phone: "13811112204", src: "manual", status: "CONVERTED", owner: u1 },
      { name: "【演示】零售会员系统-张店长", phone: "13811112205", src: "form:00000000-0000-4000-8000-000000000001", status: "CONVERTED", owner: u2 },
      { name: "【演示】量化风控需求-林总监", phone: "13811112206", src: "api:partner_traffic", status: "CONVERTED", owner: u3 },
      { name: "【演示】离散制造MES-徐总", phone: "13811112207", src: "import", status: "QUALIFIED", owner: u1 },
      { name: "【演示】云原生改造-黄总", phone: "13811112208", src: "manual", status: "CONTACTED", owner: u2 },
    ];

    for (const l of leadsData) {
      const lRes = await tx.execute<{ id: string }>(sql`
        insert into leads (tenant_id, contact_name, contact_phone, source, status, owner_user_id, created_at, updated_at)
        values (${ctx.tenantId}, ${l.name}, ${l.phone}, ${l.src}, ${l.status}, ${l.owner}, now() - interval '10 days', now() - interval '2 days')
        returning id
      `);
      const leadId = lRes.rows[0].id;

      // 插入跟进记录与任务 (验证 SLA)
      await tx.execute(sql`
        insert into activities (tenant_id, lead_id, user_id, type, outcome, summary, occurred_at)
        values (${ctx.tenantId}, ${leadId}, ${l.owner}, 'CALL', 'CONNECTED', '【演示】电话初步沟通需求与采购排期', now() - interval '8 days')
      `);

      await tx.execute(sql`
        insert into tasks (tenant_id, lead_id, assignee_user_id, type, status, due_at, completed_at, created_at)
        values (${ctx.tenantId}, ${leadId}, ${l.owner}, 'FIRST_RESPONSE', 'DONE', now() - interval '9 days', now() - interval '9 days', now() - interval '10 days')
      `);
    }

    return { success: true, message: "成功注入 20+ 条全链路多行业真实商业演示数据！" };
  });
}

export async function clearAnalyticsDemoDataService(ctx: TenantContext): Promise<{ success: boolean; message: string }> {
  requireManagerOrAdmin(ctx);
  return withTenant(ctx.tenantId, async (tx) => {
    await tx.execute(sql`update tasks set status = 'CANCELLED' where tenant_id = ${ctx.tenantId} and status = 'OPEN' and (lead_id in (select id from leads where tenant_id = ${ctx.tenantId} and contact_name like '【演示】%') or opportunity_id in (select id from opportunities where tenant_id = ${ctx.tenantId} and name like '【演示】%'))`);
    await tx.execute(sql`update opportunities set deleted_at = now() where tenant_id = ${ctx.tenantId} and name like '【演示】%' and deleted_at is null`);
    await tx.execute(sql`update customers set deleted_at = now() where tenant_id = ${ctx.tenantId} and name like '【演示】%' and deleted_at is null`);
    await tx.execute(sql`update leads set deleted_at = now() where tenant_id = ${ctx.tenantId} and contact_name like '【演示】%' and deleted_at is null`);
    return { success: true, message: "已清空所有演示数据！" };
  });
}
