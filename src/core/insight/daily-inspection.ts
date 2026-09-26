import { sql } from "drizzle-orm";
import { withTenant, listActiveTenantIdsWithoutTenant } from "@/core/tenant";
import { dispatchWorkplaceNotificationService } from "@/core/workplace/service";
import { getShanghaiDateString, addShanghaiDays } from "@/core/shared/date";
import { zonedWallClock } from "@/core/shared/tz";
import { createNotificationInTransaction } from "@/core/notification/service";
import { getPluginFactsProvider } from "@/core/plugin-facts";
import { runMorningCopilotAgent } from "@/core/ai-hub/agents/morning-copilot";
import type { TenantContext } from "@/core/tenant";

export interface DailyAiInspectionResult {
  elapsedMs: number;
  scannedTenants: number;
  totalRiskDeals: number;
  totalExpiringContracts: number;
  totalOverdueSchedules: number;
  totalDelayedMilestones: number;
  totalMorningCopilotRuns: number;
  alertsDispatched: number;
  details: Array<{
    tenantId: string;
    riskDealsCount: number;
    expiringContractsCount: number;
    overdueSchedulesCount: number;
    delayedMilestonesCount: number;
    morningCopilotRuns: number;
    alertSent: boolean;
  }>;
}

export interface DailyInspectionReportData {
  riskDeals: Array<{
    name: string;
    ownerName: string;
    stage: string;
    amount: number;
  }>;
  expiringContracts: Array<{
    title: string;
    contractNo: string;
    endDate: string;
    totalAmount: number;
  }>;
  overdueSchedules: Array<{
    orderNo: string;
    periodIndex: number;
    dueDate: string;
    plannedAmount: number;
    paidAmount: number;
  }>;
  delayedMilestones: Array<{
    projectName: string;
    milestoneTitle: string;
    plannedFinishDate: string;
  }>;
}

export function buildDailyInspectionReport(
  report: DailyInspectionReportData,
  todayStr: string,
): { title: string; markdownContent: string } {
  const sections: string[] = [];
  const riskDealsCount = report.riskDeals.length;
  const expiringContractsCount = report.expiringContracts.length;
  const overdueSchedulesCount = report.overdueSchedules.length;
  const delayedMilestonesCount = report.delayedMilestones.length;

  if (riskDealsCount > 0) {
    const dealList = report.riskDeals
      .map(
        (d) =>
          `- **${d.name}** (负责人: ${d.ownerName} | 阶段: ${d.stage} | 金额: ¥${(d.amount / 100).toFixed(2)})`,
      )
      .join("\n");
    sections.push(`### 1. 停滞与高风险商机 (${riskDealsCount}笔)\n${dealList}`);
  }

  if (expiringContractsCount > 0) {
    const contractList = report.expiringContracts
      .map(
        (c) =>
          `- **${c.title}** (${c.contractNo} | 到期日: ${c.endDate} | 金额: ¥${(c.totalAmount / 100).toFixed(2)})`,
      )
      .join("\n");
    sections.push(`### 2. 30天内临期合同 (${expiringContractsCount}份)\n${contractList}`);
  }

  if (overdueSchedulesCount > 0) {
    const schedList = report.overdueSchedules
      .map(
        (s) =>
          `- **订单 ${s.orderNo}** (第${s.periodIndex}期 | 应付日: ${s.dueDate} | 待回款: ¥${((s.plannedAmount - s.paidAmount) / 100).toFixed(2)})`,
      )
      .join("\n");
    sections.push(`### 3. 逾期未回款账单 (${overdueSchedulesCount}笔)\n${schedList}`);
  }

  if (delayedMilestonesCount > 0) {
    const msList = report.delayedMilestones
      .map(
        (m) =>
          `- **${m.projectName}** (里程碑: ${m.milestoneTitle} | 计划完成日: ${m.plannedFinishDate})`,
      )
      .join("\n");
    sections.push(`### 4. 延期交付里程碑 (${delayedMilestonesCount}个)\n${msList}`);
  }

  const suggestionParts: string[] = [];
  if (expiringContractsCount > 0) suggestionParts.push("临期合同续约");
  if (overdueSchedulesCount > 0) suggestionParts.push("逾期回款跟进");
  if (delayedMilestonesCount > 0) suggestionParts.push("延期里程碑推进");
  if (riskDealsCount > 0) suggestionParts.push("停滞商机陪访");
  const suggestionText =
    suggestionParts.length > 0
      ? `建议战情室重点跟进：${suggestionParts.join("、")}，并及时安排主管陪访或特批。`
      : "建议战情室及时跟进并安排下一步行动。";
  sections.push(`> **AI 行动建议**：${suggestionText}`);

  return {
    title: `商脉AI 晨会智能巡检战报 (${todayStr})`,
    markdownContent: sections.join("\n\n"),
  };
}

export interface DailyAiInspectionDeps {
  runMorningCopilotAgent?: typeof runMorningCopilotAgent;
  now?: Date;
}

export async function runDailyAiInspectionService(
  nowInput: Date = new Date(),
  deps: DailyAiInspectionDeps = {},
): Promise<DailyAiInspectionResult> {
  const now = deps.now ?? nowInput;
  const runCopilot = deps.runMorningCopilotAgent ?? runMorningCopilotAgent;
  const startTime = Date.now();
  const activeTenantIds = await listActiveTenantIdsWithoutTenant();

  const todayStr = getShanghaiDateString(now);
  const d30Str = addShanghaiDays(30, now);
  const d7AgoStr = new Date(now.getTime() - 7 * 86400000).toISOString();

  let totalRiskDeals = 0;
  let totalExpiringContracts = 0;
  let totalOverdueSchedules = 0;
  let totalDelayedMilestones = 0;
  let totalMorningCopilotRuns = 0;
  let alertsDispatched = 0;
  const details: DailyAiInspectionResult["details"] = [];

  for (const tenantId of activeTenantIds) {
    const adminUser = await withTenant(tenantId, async (tx) => {
      const res = await tx.execute<{ id: string; role: "ADMIN" | "MANAGER" | "SALES" }>(sql`
        select id, role from users u
        where tenant_id = ${tenantId} and status = 'ACTIVE' 
        order by case when role = 'ADMIN' then 1 when role = 'MANAGER' then 2 else 3 end, u.id asc
        limit 1
      `);
      return res.rows[0];
    }).catch(() => null);

    const adminCtx: TenantContext | null = adminUser
      ? {
          tenantId,
          userId: adminUser.id,
          role: adminUser.role,
        }
      : null;

    try {
      // 6. 为该租户下每位 ACTIVE 的 SALES 用户执行「晨会副驾驶」智能体巡检并推送个性化建议
      const activeSalesUsers = await withTenant(tenantId, async (tx) => {
        const uRes = await tx.execute<{ id: string; name: string }>(sql`
          select id, name from users where tenant_id = ${tenantId} and role = 'SALES' and status = 'ACTIVE'
        `);
        return uRes.rows;
      }).catch(() => []);

      let morningCopilotRuns = 0;
      const CONCURRENCY_LIMIT = 3;
      const salesQueue = [...activeSalesUsers];

      const copilotWorkers = Array.from(
        { length: Math.min(CONCURRENCY_LIMIT, salesQueue.length) },
        async () => {
          while (salesQueue.length > 0) {
            const salesUser = salesQueue.shift();
            if (!salesUser) break;
            try {
              // 服务端幂等闸门：检查今日是否已为该销售生成过晨会建议或完成巡检
              const alreadyGeneratedToday = await withTenant(tenantId, async (tx) => {
                const checkRes = await tx.execute<{ id: string }>(sql`
                  select id from ai_recommendations
                  where tenant_id = ${tenantId}::uuid
                    and user_id = ${salesUser.id}::uuid
                    and recommendation_type = 'MORNING_COPILOT'
                    and (created_at at time zone 'Asia/Shanghai')::date = ${todayStr}::date
                  union all
                  select id from notifications
                  where tenant_id = ${tenantId}::uuid
                    and user_id = ${salesUser.id}::uuid
                    and type = 'MORNING_COPILOT'
                    and (created_at at time zone 'Asia/Shanghai')::date = ${todayStr}::date
                  limit 1
                `);
                return checkRes.rows.length > 0;
              }).catch(() => false);

              if (alreadyGeneratedToday) {
                continue;
              }

              const copilotCtx: TenantContext = {
                tenantId,
                userId: salesUser.id,
                role: "SALES",
              };
              await runCopilot(copilotCtx, salesUser.id, now);
              morningCopilotRuns++;
            } catch (userErr) {
              // 逐人隔离：单人报错绝不影响其他销售或整个巡检批次
              console.error(
                `[Morning Copilot] Failed for user ${salesUser.id} (${salesUser.name}) in tenant ${tenantId}:`,
                userErr,
              );
            }
          }
        },
      );

      await Promise.all(copilotWorkers);
      totalMorningCopilotRuns += morningCopilotRuns;

      // 7. 每月 1 日 08:30 自动跑 L2 (销冠解构) + L3 (企业画像) 认知报告并存档
      const wall = zonedWallClock(now);
      const isFirstDayOfMonth = wall.day === 1;
      const isAfterMorningGate = wall.hour >= 8;
      if (isFirstDayOfMonth && isAfterMorningGate && adminCtx) {
        try {
          const prevYear = wall.month === 1 ? wall.year - 1 : wall.year;
          const prevMonth = wall.month === 1 ? 12 : wall.month - 1;
          const monthlyPeriod = `${prevYear}-${String(prevMonth).padStart(2, "0")}`; // 复盘上一个自然月
          // 预检查重闸门：在调用 Agent 前检查该月报告是否已生成，避免重复消耗大模型 Token
          const existingReports = await withTenant(tenantId, async (tx) => {
            const res = await tx.execute<{ kind: string }>(sql`
              select kind::text as kind from ai_insight_reports
              where tenant_id = ${tenantId}::uuid
                and period = ${monthlyPeriod}
                and kind in ('CHAMPION_ANALYSIS', 'COMPANY_PROFILE')
            `);
            return new Set(res.rows.map((r) => r.kind));
          }).catch(() => new Set<string>());

          const { runChampionAnalysisAgent } = await import("@/core/ai-hub/agents/champion-analysis");
          const { runCompanyProfileAgent } = await import("@/core/ai-hub/agents/company-profile");
          const { saveInsightReportService } = await import("@/core/ai-hub/service");

          if (!existingReports.has("CHAMPION_ANALYSIS")) {
            const champRes = await runChampionAnalysisAgent(adminCtx);
            let champSampleSize = 0;
            for (const m of champRes.messages) {
              if (m.role === "tool" && m.content) {
                try {
                  const parsed = JSON.parse(m.content);
                  const sz = parsed?.result?.sampleSize ?? parsed?.result?.totalWonSamples ?? parsed?.result?.totalClosedSamples;
                  if (typeof sz === "number") champSampleSize = Math.max(champSampleSize, sz);
                } catch {}
              }
            }
            await saveInsightReportService(adminCtx, {
              kind: "CHAMPION_ANALYSIS",
              period: monthlyPeriod,
              content: champRes.outcome,
              sampleSize: champSampleSize,
              confidence: champSampleSize >= 20 ? "HIGH" : champSampleSize >= 10 ? "MEDIUM" : "LOW",
            });
          }

          if (!existingReports.has("COMPANY_PROFILE")) {
            const compRes = await runCompanyProfileAgent(adminCtx);
            let compSampleSize = 0;
            for (const m of compRes.messages) {
              if (m.role === "tool" && m.content) {
                try {
                  const parsed = JSON.parse(m.content);
                  const sz = parsed?.result?.sampleSize ?? parsed?.result?.totalCustomers ?? parsed?.result?.totalSampleCount;
                  if (typeof sz === "number") compSampleSize = Math.max(compSampleSize, sz);
                } catch {}
              }
            }
            await saveInsightReportService(adminCtx, {
              kind: "COMPANY_PROFILE",
              period: monthlyPeriod,
              content: compRes.outcome,
              sampleSize: compSampleSize,
              confidence: compSampleSize >= 20 ? "HIGH" : compSampleSize >= 10 ? "MEDIUM" : "LOW",
            });
          }
        } catch (monthlyErr) {
          console.error(`[Monthly Insight Reports] Failed for tenant ${tenantId}:`, monthlyErr);
        }
      }

      const tenantReport = await withTenant(tenantId, async (tx) => {
        // 1. 停滞/高风险商机扫描 (7天无跟进或超期)
        const riskDealsRes = await tx.execute<{
          id: string;
          name: string;
          stage: string;
          amount: number;
          ownerName: string;
        }>(sql`
          select
            o.id,
            o.name,
            o.stage,
            coalesce(o.expected_amount, 0) as amount,
            coalesce(u.name, '未分配') as "ownerName"
          from opportunities o
          left join users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
          where o.tenant_id = ${tenantId}
            and o.deleted_at is null
            and o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
            and (
              o.updated_at < ${d7AgoStr}::timestamptz
              or (o.expected_close_at is not null and o.expected_close_at < ${todayStr})
            )
          limit 10
        `);

        const factsProvider = getPluginFactsProvider();

        // 2. 临期未续约合同扫描 (30天内到期且仍在履约)
        const expiringContracts = await factsProvider
          .getExpiringContracts(tx, tenantId, d30Str, 10)
          .catch(() => []);

        // 3. 逾期未回款订单分期计划扫描
        const overdueSchedules = await factsProvider
          .getOverduePaymentSchedules(tx, tenantId, todayStr, 10)
          .catch(() => []);

        // 4. 延期交付项目里程碑扫描
        const delayedMilestones = await factsProvider
          .getDelayedMilestones(tx, tenantId, todayStr, 10)
          .catch(() => []);

        // 5. 定向推送销售个人待办提醒（临期合同与逾期回款）—— 增加同日去重闸门，杜绝 5 分钟轮询重复刷通知
        for (const c of expiringContracts) {
          if (c.ownerUserId) {
            // 闭源 contracts 插件路由；插件缺席（开源版）时 expiringContracts 恒为空，本分支不进入
            const link = `/p/contracts?contractId=${c.id}`;
            const existing = await tx.execute<{ id: string }>(sql`
              select id from notifications
              where tenant_id = ${tenantId}::uuid
                and user_id = ${c.ownerUserId}::uuid
                and type = 'CONTRACT_EXPIRING_SOON'
                and link = ${link}
                and (created_at at time zone 'Asia/Shanghai')::date = ${todayStr}::date
              limit 1
            `);
            if (existing.rows.length === 0) {
              await createNotificationInTransaction(tx, {
                tenantId,
                userId: c.ownerUserId,
                type: "CONTRACT_EXPIRING_SOON",
                title: `【合同临期提醒】合同【${c.contractNo}·${c.title}】即将到期`,
                body: `您名下的商务合同【${c.contractNo}·${c.title}】将于 ${c.endDate} 到期，请及时跟进客户续约或续签合同。`,
                link,
                createdAt: now,
              }).catch(() => {});
            }
          }
        }

        for (const s of overdueSchedules) {
          if (s.ownerUserId) {
            // 闭源 orders 插件路由；插件缺席（开源版）时 overdueSchedules 恒为空，本分支不进入
            const link = `/p/orders?orderId=${s.orderId}`;
            const title = `【分期回款逾期提醒】订单【${s.orderNo}】第 ${s.periodIndex} 期回款已逾期`;
            const existing = await tx.execute<{ id: string }>(sql`
              select id from notifications
              where tenant_id = ${tenantId}::uuid
                and user_id = ${s.ownerUserId}::uuid
                and type = 'SCHEDULE_PAYMENT_OVERDUE'
                and title = ${title}
                and (created_at at time zone 'Asia/Shanghai')::date = ${todayStr}::date
              limit 1
            `);
            if (existing.rows.length === 0) {
              const unpaidAmountYuan = ((Number(s.plannedAmount) - Number(s.paidAmount)) / 100).toFixed(2);
              await createNotificationInTransaction(tx, {
                tenantId,
                userId: s.ownerUserId,
                type: "SCHEDULE_PAYMENT_OVERDUE",
                title,
                body: `您名下的销售订单【${s.orderNo}】第 ${s.periodIndex} 期回款（应收金额：¥${unpaidAmountYuan}）原定应于 ${s.dueDate} 结清，现已逾期，请及时跟进催款。`,
                link,
                createdAt: now,
              }).catch(() => {});
            }
          }
        }

        return {
          riskDeals: riskDealsRes.rows,
          expiringContracts,
          overdueSchedules,
          delayedMilestones,
        };
      });

      const riskDealsCount = tenantReport.riskDeals.length;
      const expiringContractsCount = tenantReport.expiringContracts.length;
      const overdueSchedulesCount = tenantReport.overdueSchedules.length;
      const delayedMilestonesCount = tenantReport.delayedMilestones.length;

      totalRiskDeals += riskDealsCount;
      totalExpiringContracts += expiringContractsCount;
      totalOverdueSchedules += overdueSchedulesCount;
      totalDelayedMilestones += delayedMilestonesCount;

      const hasRisk =
        riskDealsCount > 0 ||
        expiringContractsCount > 0 ||
        overdueSchedulesCount > 0 ||
        delayedMilestonesCount > 0;

      let alertSent = false;

      if (hasRisk && adminCtx) {
        // 服务端每日广播闸门：检查今日是否已成功推送过 AI_INSPECTION_ALERT 巡检战报（补 user_id 条件利用复合索引）
        const alreadyAlertedToday = await withTenant(tenantId, async (tx) => {
          const check = await tx.execute<{ id: string }>(sql`
            select id from notifications
            where tenant_id = ${tenantId}::uuid
              and user_id = ${adminCtx.userId}::uuid
              and title like '【群播已发送】%'
              and (created_at at time zone 'Asia/Shanghai')::date = ${todayStr}::date
            limit 1
          `);
          return check.rows.length > 0;
        }).catch(() => false);

        if (!alreadyAlertedToday) {
          const { title, markdownContent } = buildDailyInspectionReport(tenantReport, todayStr);

          const pushMsg = {
            title,
            markdownContent,
            event: "AI_INSPECTION_ALERT" as const,
            data: {
              inspectionDate: todayStr,
              riskDealsCount,
              expiringContractsCount,
              overdueSchedulesCount,
              delayedMilestonesCount,
            },
          };

          const pushResults = await dispatchWorkplaceNotificationService(adminCtx, pushMsg);
          alertSent = pushResults.some((r) => r.success);
          if (alertSent) {
            alertsDispatched++;
            // 写入当日群播已发送标记记录
            await withTenant(tenantId, async (tx) => {
              await tx.execute(sql`
                insert into notifications (
                  tenant_id, user_id, type, title, body, link, created_at
                ) values (
                  ${tenantId}::uuid, ${adminCtx.userId}::uuid, 'TASK_DUE_SOON'::notification_type,
                  ${`【群播已发送】商脉AI 晨会智能巡检战报 (${todayStr})`},
                  ${`已于 ${todayStr} 向已配置的企业通讯群机器人推送每日晨会巡检战报。`},
                  null,
                  ${now.toISOString()}::timestamptz
                )
              `);
            }).catch(() => {});
          }
        }
      }

      details.push({
        tenantId,
        riskDealsCount,
        expiringContractsCount,
        overdueSchedulesCount,
        delayedMilestonesCount,
        morningCopilotRuns,
        alertSent,
      });
    } catch (err) {
      console.error(`AI daily inspection failed for tenant ${tenantId}:`, err);
    }
  }

  const elapsedMs = Date.now() - startTime;
  return {
    elapsedMs,
    scannedTenants: activeTenantIds.length,
    totalRiskDeals,
    totalExpiringContracts,
    totalOverdueSchedules,
    totalDelayedMilestones,
    totalMorningCopilotRuns,
    alertsDispatched,
    details,
  };
}
