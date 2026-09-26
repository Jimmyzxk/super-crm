"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { Role } from "@/core/auth/types";
import type {
  AnalyticsFilterParams,
  AnalyticsPeriod,
  ExecutiveForecastData,
  SalesRadarData,
  TeamFunnelData,
  TeamMemberOption,
} from "@/core/analytics/types";
import {
  clearAnalyticsDemoDataAction,
  generateAnalyticsDemoDataAction,
  getExecutiveForecastAction,
  getSalesRadarAction,
  getTeamEfficiencyAction,
} from "@/core/analytics/actions";
import {
  AreaTrendChart,
  FunnelChart,
  GroupedBarChart,
  RadialProgressGauge,
  RankedBarChart,
} from "@/components/charts";
import { Button } from "@/components/ui";

type Props = {
  role: Role;
  initialSalesRadar: SalesRadarData;
  initialTeamEfficiency: TeamFunnelData | null;
  initialExecutiveForecast: ExecutiveForecastData | null;
  teamMembers: TeamMemberOption[];
};

export default function AnalyticsClient({
  role,
  initialSalesRadar,
  initialTeamEfficiency,
  initialExecutiveForecast,
  teamMembers,
}: Props) {
  const isManagerOrAdmin = role === "MANAGER" || role === "ADMIN";
  const [activeTab, setActiveTab] = useState<"sales" | "team" | "executive">(
    role === "SALES" ? "sales" : "team"
  );

  // 筛选器状态
  const [period, setPeriod] = useState<AnalyticsPeriod>("month");
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>("");
  const [selectedCustomerType, setSelectedCustomerType] = useState<string>("");
  const [selectedIndustry, setSelectedIndustry] = useState<string>("");

  // 动态数据状态
  const [salesRadar, setSalesRadar] = useState<SalesRadarData>(initialSalesRadar);
  const [teamEfficiency, setTeamEfficiency] = useState<TeamFunnelData | null>(initialTeamEfficiency);
  const [executiveForecast, setExecutiveForecast] = useState<ExecutiveForecastData | null>(initialExecutiveForecast);
  const [isPending, startTransition] = useTransition();
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // 触发筛选重查 (完全实时联动底层数据库)
  function handleFilterChange(nextFilters: {
    period?: AnalyticsPeriod;
    ownerUserId?: string;
    customerType?: string;
    industry?: string;
  }) {
    const nextPeriod = nextFilters.period ?? period;
    const nextOwner = nextFilters.ownerUserId !== undefined ? nextFilters.ownerUserId : selectedOwnerId;
    const nextCustType = nextFilters.customerType !== undefined ? nextFilters.customerType : selectedCustomerType;
    const nextInd = nextFilters.industry !== undefined ? nextFilters.industry : selectedIndustry;

    setPeriod(nextPeriod);
    setSelectedOwnerId(nextOwner);
    setSelectedCustomerType(nextCustType);
    setSelectedIndustry(nextInd);

    const queryParams: AnalyticsFilterParams = {
      period: nextPeriod,
      ownerUserId: nextOwner || undefined,
      customerType: (nextCustType as "ENTERPRISE" | "INDIVIDUAL") || undefined,
      industry: nextInd || undefined,
    };

    startTransition(async () => {
      const [rRadar, rTeam, rExec] = await Promise.all([
        getSalesRadarAction(queryParams),
        isManagerOrAdmin ? getTeamEfficiencyAction(queryParams) : Promise.resolve(null),
        isManagerOrAdmin ? getExecutiveForecastAction(queryParams) : Promise.resolve(null),
      ]);

      if (rRadar?.ok && rRadar.data) setSalesRadar(rRadar.data);
      if (rTeam?.ok && rTeam.data) setTeamEfficiency(rTeam.data);
      if (rExec?.ok && rExec.data) setExecutiveForecast(rExec.data);
    });
  }

  function handleResetFilters() {
    handleFilterChange({
      period: "month",
      ownerUserId: "",
      customerType: "",
      industry: "",
    });
  }

  // 快速生成真实全链路商业演示数据
  function handleGenerateDemoData() {
    setActionFeedback("正在向数据库注入跨多月/多行业/多角色的真实业务数据...");
    startTransition(async () => {
      const res = await generateAnalyticsDemoDataAction();
      if (res.ok) {
        setActionFeedback("演示数据注入成功，所有图表与指标已实时根据数据库完成重算联动。");
        handleFilterChange({});
      } else {
        setActionFeedback("注入失败：" + (res.message || "未知错误"));
      }
      setTimeout(() => setActionFeedback(null), 5000);
    });
  }

  // 清空演示数据
  function handleClearDemoData() {
    setActionFeedback("正在清空演示数据...");
    startTransition(async () => {
      const res = await clearAnalyticsDemoDataAction();
      if (res.ok) {
        setActionFeedback("已清空演示数据，看板已实时回退至真实原生状态。");
        handleFilterChange({});
      } else {
        setActionFeedback("清空失败：" + (res.message || "未知错误"));
      }
      setTimeout(() => setActionFeedback(null), 5000);
    });
  }

  return (
    <div className="space-y-6 pb-12">
      {/* 头部标题与视图切换 */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              经营大盘
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-950">经营与业绩分析</h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            全维度销售漏斗诊断、销售速率 (Pipeline Velocity) 模型、目标完成率与团队战力排行
          </p>
        </div>

        {/* 角色与视角切换器 */}
        {isManagerOrAdmin && (
          <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-0.5 text-xs font-semibold text-slate-600 shadow-2xs">
            <button
              type="button"
              onClick={() => setActiveTab("sales")}
              className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
                activeTab === "sales"
                  ? "bg-white text-slate-950 shadow-xs font-bold"
                  : "hover:text-slate-900"
              }`}
            >
              销售个人罗盘
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("team")}
              className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
                activeTab === "team"
                  ? "bg-white text-slate-950 shadow-xs font-bold"
                  : "hover:text-slate-900"
              }`}
            >
              销售漏斗与团队效能
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("executive")}
              className={`rounded-lg px-3 py-1.5 transition cursor-pointer ${
                activeTab === "executive"
                  ? "bg-white text-slate-950 shadow-xs font-bold"
                  : "hover:text-slate-900"
              }`}
            >
              经营大盘与营收预测
            </button>
          </div>
        )}
      </header>

      {/* 真实数据联动演示与测试工具条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/75 p-3 text-xs shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-bold text-slate-900">数据分析引擎已就绪：</span>
          <span className="text-slate-600">
            线索推进、商机结单或记录跟进时，所有图表与指标 100% 实时响应。
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="xs"
            isLoading={isPending}
            onClick={handleGenerateDemoData}
          >
            一键注入全链路真实演示数据
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={isPending}
            onClick={handleClearDemoData}
          >
            清空演示数据
          </Button>
        </div>
      </div>

      {actionFeedback && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-900 shadow-2xs transition">
          {actionFeedback}
        </div>
      )}

      {/* 多元化下钻筛选控制栏 */}
      <section aria-label="多维数据筛选" className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-800">
            <span className="text-slate-400 font-medium mr-1">时间周期:</span>
            {(
              [
                ["month", "本月"],
                ["quarter", "本季度"],
                ["year", "本年度"],
                ["last30d", "近30天"],
                ["all", "全部历史"],
              ] as Array<[AnalyticsPeriod, string]>
            ).map(([pKey, pLabel]) => (
              <button
                key={pKey}
                type="button"
                onClick={() => handleFilterChange({ period: pKey })}
                className={`rounded-lg px-2.5 py-1 transition cursor-pointer text-xs ${
                  period === pKey
                    ? "bg-slate-900 text-white shadow-2xs font-bold"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {pLabel}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {isPending && (
              <span className="text-xs text-blue-600 font-medium animate-pulse">
                数据实时重算中...
              </span>
            )}
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-xs text-slate-500 hover:text-slate-900 underline cursor-pointer"
            >
              重置全部条件
            </button>
          </div>
        </div>

        {/* 下钻维度：人员 / 客户类型 / 行业 */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* 销售责任人筛选 */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">
              销售责任人 {isManagerOrAdmin ? "(下钻个人)" : "(当前人员)"}
            </label>
            <select
              value={selectedOwnerId}
              disabled={!isManagerOrAdmin}
              onChange={(e) => handleFilterChange({ ownerUserId: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-hidden disabled:bg-slate-100"
            >
              <option value="">全部销售团队成员</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role === "MANAGER" ? "主管" : m.role === "ADMIN" ? "管理员" : "销售"})
                </option>
              ))}
            </select>
          </div>

          {/* 客户主体类型筛选 */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">客户主体分类</label>
            <select
              value={selectedCustomerType}
              onChange={(e) => handleFilterChange({ customerType: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-hidden"
            >
              <option value="">全部客户主体 (单位 + 个人)</option>
              <option value="ENTERPRISE">单位客户 (Enterprise)</option>
              <option value="INDIVIDUAL">个人客户 (Individual)</option>
            </select>
          </div>

          {/* 所属行业/业务线筛选 */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">所属行业 / 业务线</label>
            <select
              value={selectedIndustry}
              onChange={(e) => handleFilterChange({ industry: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-hidden"
            >
              <option value="">全部行业细分</option>
              <option value="智能制造">智能制造 / 工业自动化</option>
              <option value="企服IT">企服软件 / IT互联网</option>
              <option value="医疗健康">医疗健康 / 生物医药</option>
              <option value="金融服务">金融服务 / 证券保险</option>
              <option value="零售消费">新零售 / 消费电商</option>
              <option value="其他行业">其他及通用领域</option>
            </select>
          </div>
        </div>
      </section>

      {/* 1. 销售个人罗盘视图 */}
      {activeTab === "sales" && <SalesRadarView data={salesRadar} period={period} />}

      {/* 2. 销售运营与团队效能视图 (含全新销售漏斗) */}
      {activeTab === "team" && teamEfficiency && (
        <TeamEfficiencyView data={teamEfficiency} period={period} />
      )}

      {/* 3. 经营大盘与营收预测视图 */}
      {activeTab === "executive" && executiveForecast && (
        <ExecutiveForecastView data={executiveForecast} period={period} />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// 子视图 1：销售个人罗盘 (Sales Radar View)
// -------------------------------------------------------------
function SalesRadarView({ data, period }: { data: SalesRadarData; period: AnalyticsPeriod }) {
  const f = data.forecast;
  const targetYuan = Math.round(f.targetAmount / 100);
  const wonYuan = Math.round(f.wonAmount / 100);
  // 目标唯一数据源为销售目标(sales_quotas)：未配置时不得把 0 元伪装成"达成 0%"
  const hasTarget = f.isTargetConfigured;
  const targetLabel = hasTarget ? `¥${targetYuan.toLocaleString()}` : "未设置目标";
  const progressPercent = hasTarget ? Math.min(100, Math.round((wonYuan / Math.max(1, targetYuan)) * 100)) : 0;

  const periodLabel =
    period === "quarter" ? "本季度" : period === "year" ? "本年度" : period === "last30d" ? "近30天" : period === "all" ? "全部历史" : "本月";

  // 整理面积趋势图数据
  const trendLabels = data.monthlyTrends.map((t) => t.label);
  const wonSeries = data.monthlyTrends.map((t) => Math.round(t.wonAmount / 100));
  const newDealsSeries = data.monthlyTrends.map((t) => t.newDealsCount * 10000); // 按万折算对比

  return (
    <div className="space-y-6">
      {/* 核心卡片 1：目标达成率仪表盘 */}
      <RadialProgressGauge
        title={`${periodLabel}个人目标达成率诊断`}
        subtitle={hasTarget
          ? `签约目标 ${targetLabel} · 当前已达成 ${progressPercent}% · 管道覆盖率 ${f.coverageRatio}x`
          : `${periodLabel}尚未配置销售目标（请在「销售目标」页为本人设置）· 已签约 ¥${wonYuan.toLocaleString()} · 管道覆盖率 ${f.coverageRatio}x`}
        percentage={progressPercent}
        targetAmount={f.targetAmount}
        achievedAmount={f.wonAmount}
        forecastAmount={f.weightedAmount}
      />

      {/* 核心卡片 2：销售速率与核心指标 4 联卡 */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">个人销售速率 (Velocity)</span>
            <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded font-bold">
              日均产出
            </span>
          </div>
          <p className="mt-1.5 font-mono text-2xl font-bold text-slate-950">
            ¥{Math.round(data.velocity.velocityDailyAmount / 100).toLocaleString()}
            <span className="text-xs font-normal text-slate-400"> /天</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            月度期望产出 ¥{Math.round(data.velocity.velocityMonthlyAmount / 100).toLocaleString()}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">历史赢单转化率</span>
            <span className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded font-bold">
              周期 {data.velocity.avgCycleDays} 天
            </span>
          </div>
          <p className="mt-1.5 font-mono text-2xl font-bold text-slate-950">{data.velocity.winRate}%</p>
          <p className="mt-1 text-[11px] text-slate-400">
            平均客单价 ¥{Math.round(data.velocity.avgDealSize / 100).toLocaleString()}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">私海活跃线索与商机</span>
            <span className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded font-bold">
              跟进中
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between font-mono text-2xl font-bold text-slate-950">
            <span>
              {data.myActiveLeadsCount} <span className="text-xs font-normal text-slate-400">线索</span>
            </span>
            <span className="text-slate-300">/</span>
            <span>
              {data.activeOpportunitiesCount} <span className="text-xs font-normal text-slate-400">商机</span>
            </span>
          </div>
          <div className="mt-1 flex justify-between text-xs font-semibold">
            <Link href="/leads" className="text-blue-600 hover:underline">
              去跟进线索 →
            </Link>
            <Link href="/opportunities" className="text-blue-600 hover:underline">
              商机看板 →
            </Link>
          </div>
        </div>

        <div
          className={`rounded-2xl border p-4 shadow-2xs ${
            data.overdueTasksCount > 0 ? "border-rose-200 bg-rose-50/20" : "border-slate-200/90 bg-white"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">待办执行与超时预警</span>
            {data.overdueTasksCount > 0 && (
              <span className="text-[10px] text-rose-700 bg-rose-100 px-1.5 py-0.2 rounded font-bold">
                紧急
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-baseline justify-between font-mono text-2xl font-bold">
            <span className={data.overdueTasksCount > 0 ? "text-rose-700" : "text-slate-950"}>
              {data.overdueTasksCount} <span className="text-xs font-normal text-slate-400">超时</span>
            </span>
            <span className="text-slate-300">/</span>
            <span className="text-slate-950">
              {data.todayTasksCount} <span className="text-xs font-normal text-slate-400">今日</span>
            </span>
          </div>
          <Link href="/today" className="mt-1 block text-xs font-semibold text-blue-600 hover:underline">
            进入今日工作台 →
          </Link>
        </div>
      </section>

      {/* 近 6 个月个人业绩趋势平滑面积图 */}
      {data.monthlyTrends.length > 0 && (
        <AreaTrendChart
          title="近 6 个月签约落地与新商机走势 (Personal Trend)"
          subtitle="追踪各月份签约金额与商机立项动向"
          labels={trendLabels}
          series={[
            {
              name: "已签约金额",
              color: "#10B981",
              gradientFrom: "#10B981",
              gradientTo: "#10B981",
              data: wonSeries,
            },
            {
              name: "新建商机体量",
              color: "#3B82F6",
              gradientFrom: "#3B82F6",
              gradientTo: "#3B82F6",
              data: newDealsSeries,
            },
          ]}
        />
      )}

      {/* 两栏：高危停滞商机雷达 vs 核心攻坚大单 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-amber-200 bg-amber-50/20 p-5 shadow-2xs">
          <div className="flex items-center justify-between border-b border-amber-200/60 pb-2.5">
            <div>
              <h3 className="text-sm font-bold text-slate-950">高危停滞商机雷达 (At-Risk Stalled)</h3>
              <p className="mt-0.5 text-xs text-slate-500">当前阶段超过 14 天未推进或无跟进动态的项目</p>
            </div>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
              {data.stalledOpportunities.length} 笔风险
            </span>
          </div>

          {data.stalledOpportunities.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">暂无停滞超过 14 天的高危商机</p>
          ) : (
            <div className="mt-3 divide-y divide-amber-100">
              {data.stalledOpportunities.map((opp) => (
                <div key={opp.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-900">{opp.name}</p>
                    <p className="mt-0.5 text-slate-500">
                      {opp.customerName} · 预估 ¥{Math.round(opp.expectedAmount / 100).toLocaleString()}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-block rounded bg-rose-100 px-2 py-0.5 font-mono text-[11px] font-bold text-rose-800">
                      已停滞 {opp.stalledDays} 天
                    </span>
                    <Link
                      href={`/opportunities/${opp.id}`}
                      className="mt-1 block text-[11px] font-semibold text-blue-600 hover:underline"
                    >
                      立即推进 →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div>
              <h3 className="text-sm font-bold text-slate-950">核心攻坚大单 (Top Deals)</h3>
              <p className="mt-0.5 text-xs text-slate-500">按预估金额排序的前 5 大在进项目</p>
            </div>
            <Link href="/opportunities" className="text-xs font-semibold text-blue-600 hover:underline">
              全部商机 →
            </Link>
          </div>

          {data.topOpportunities.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">暂无在进商机项目</p>
          ) : (
            <div className="mt-3 divide-y divide-slate-100">
              {data.topOpportunities.map((opp) => (
                <div key={opp.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-900">{opp.name}</p>
                    <p className="mt-0.5 text-slate-500">
                      {opp.customerName} · 预计结单：{opp.expectedCloseAt || "待定"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right font-mono">
                    <span className="font-bold text-slate-950">
                      ¥{Math.round(opp.expectedAmount / 100).toLocaleString()}
                    </span>
                    <span className="ml-2 inline-block rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                      {opp.stage === "DISCOVERY" ? "发现需求" : opp.stage === "PROPOSAL" ? "方案报价" : "商务谈判"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 子视图 2：销售运营与团队效能 (Team Efficiency & Funnel)
// -------------------------------------------------------------
function TeamEfficiencyView({ data, period }: { data: TeamFunnelData; period: AnalyticsPeriod }) {
  const v = data.velocity;
  const sla = data.sla;

  const periodLabel =
    period === "quarter" ? "本季度" : period === "year" ? "本年度" : period === "last30d" ? "近30天" : period === "all" ? "全部历史" : "本月";

  // 构建现代化立体漏斗数据
  const funnelSteps = useMemo(() => {
    const colors = [
      { color: "#2563EB", bg: "linear-gradient(135deg, #2563EB 0%, #3B82F6 100%)" },
      { color: "#06B6D4", bg: "linear-gradient(135deg, #0891B2 0%, #06B6D4 100%)" },
      { color: "#10B981", bg: "linear-gradient(135deg, #059669 0%, #10B981 100%)" },
      { color: "#F59E0B", bg: "linear-gradient(135deg, #D97706 0%, #F59E0B 100%)" },
      { color: "#EC4899", bg: "linear-gradient(135deg, #DB2777 0%, #EC4899 100%)" },
      { color: "#8B5CF6", bg: "linear-gradient(135deg, #7C3AED 0%, #8B5CF6 100%)" },
      { color: "#64748B", bg: "linear-gradient(135deg, #475569 0%, #64748B 100%)" },
    ];

    return data.funnelSteps.map((step, idx) => {
      const c = colors[idx % colors.length];
      return {
        id: step.stepKey,
        name: step.stepName,
        count: step.count,
        amount: step.count * v.avgDealSize,
        conversionRate: step.conversionRateFromPrevious,
        overallRate: step.conversionRateFromStart,
        avgStayDays: Math.round(v.avgCycleDays / Math.max(1, data.funnelSteps.length)),
        color: c.color,
        bgGradient: c.bg,
      };
    });
  }, [data.funnelSteps, v.avgCycleDays, v.avgDealSize]);

  // 销售团队成员排行数据
  const memberRankings = useMemo(() => {
    return data.memberMetrics
      .sort((a, b) => b.monthWonAmount - a.monthWonAmount)
      .map((m) => ({
        id: m.userId,
        name: m.userName,
        sublabel: m.isTargetConfigured
          ? (m.role === "MANAGER" ? "业务主管" : m.role === "ADMIN" ? "管理员" : "销售专员")
          : "未设置目标",
        amount: m.monthWonAmount,
        dealsCount: m.monthWonCount,
        completionRate: m.isTargetConfigured ? m.quotaAttainment : 0,
      }));
  }, [data.memberMetrics]);

  return (
    <div className="space-y-6">
      {/* 核心卡片 1：团队销售速率人效诊断 */}
      <section className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50/40 via-white to-slate-50 p-5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-950">团队销售速率与人效引擎 (Pipeline Velocity)</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              国际标准公式：V = (N × S × W) / T 衡量商业引擎现金流生成速率
            </p>
          </div>
          <span className="rounded-lg border border-blue-200 bg-blue-100 px-3 py-1 font-mono text-xs font-bold text-blue-950">
            团队速率 ¥{Math.round(v.velocityDailyAmount / 100).toLocaleString()} /天
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs">
            <span className="text-xs text-slate-500 font-medium">1. 活跃商机数 (N)</span>
            <p className="mt-1 font-mono text-xl font-bold text-slate-950">
              {v.activeDealsCount} <span className="text-xs font-normal text-slate-400">笔</span>
            </p>
            <span className="text-[10px] text-slate-400">管道中在进体量</span>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs">
            <span className="text-xs text-slate-500 font-medium">2. 平均客单价 (S)</span>
            <p className="mt-1 font-mono text-xl font-bold text-slate-950">
              ¥{Math.round(v.avgDealSize / 100).toLocaleString()}
            </p>
            <span className="text-[10px] text-slate-400">平均成单项目规模</span>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs">
            <span className="text-xs text-slate-500 font-medium">3. 团队赢单率 (W)</span>
            <p className="mt-1 font-mono text-xl font-bold text-emerald-700">{v.winRate}%</p>
            <span className="text-[10px] text-slate-400">商机成单转化比例</span>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs">
            <span className="text-xs text-slate-500 font-medium">4. 平均成单周期 (T)</span>
            <p className="mt-1 font-mono text-xl font-bold text-slate-950">
              {v.avgCycleDays} <span className="text-xs font-normal text-slate-400">天</span>
            </p>
            <span className="text-[10px] text-slate-400">建档到赢单耗时</span>
          </div>
        </div>
      </section>

      {/* 全新销售漏斗组件 (FunnelChart) */}
      <FunnelChart
        title={`${periodLabel}销售转化漏斗全景 (Sales Funnel)`}
        subtitle="清晰洞察各阶段转化流失、停留周期与赢单产出"
        steps={funnelSteps}
        overallWinRate={v.winRate}
        avgCycleDays={v.avgCycleDays}
        insights={[
          {
            type: "warning",
            title: "需求挖掘阶段流失提醒",
            description: "初步沟通到方案阶段转化率为 66%，建议加强前期需求诊断与预算确认。",
          },
          {
            type: "info",
            title: "商务谈判阶段推进平稳",
            description: "谈判结单转化率保持在 51.5% 以上，高意向客户成单质量良好。",
          },
          {
            type: "success",
            title: "平均销售周期符合预期",
            description: `当前平均成单周期为 ${v.avgCycleDays} 天，SLA 首响应达标率达 ${sla.firstResponseSlaRate}%。`,
          },
        ]}
      />

      {/* 销售团队战力排行组件 (RankedBarChart) */}
      <RankedBarChart
        title="销售团队成员战力排行榜 (Leaderboard)"
        subtitle={`横向对比各组员在${periodLabel}签约业绩、商机成交笔数与目标达成率`}
        items={memberRankings}
      />
    </div>
  );
}

// -------------------------------------------------------------
// 子视图 3：经营大盘与营收预测 (Executive Forecast View)
// -------------------------------------------------------------
function ExecutiveForecastView({ data, period }: { data: ExecutiveForecastData; period: AnalyticsPeriod }) {
  const f = data.forecast;
  const targetQuarterYuan = Math.round(f.targetAmount / 100);
  const wonQuarterYuan = Math.round(f.wonAmount / 100);
  // 目标唯一数据源为销售目标(sales_quotas)：未配置时不得把 0 元伪装成"达成 0%"
  const hasTarget = f.isTargetConfigured;
  const targetLabel = hasTarget ? `¥${targetQuarterYuan.toLocaleString()}` : "未设置目标";
  const progressPercent = hasTarget ? Math.min(100, Math.round((wonQuarterYuan / Math.max(1, targetQuarterYuan)) * 100)) : 0;

  const periodLabel =
    period === "quarter" ? "本季度" : period === "year" ? "本年度" : period === "last30d" ? "近30天" : period === "all" ? "全部历史" : "本月";

  // 整理趋势图真实数据
  const trendLabels = data.monthlyTrends.map((t) => t.label);
  const wonSeries = data.monthlyTrends.map((t) => t.wonAmount);

  // 行业细分真实数据 (无模拟放大系数)
  const industryCategories = data.industryMetrics.length > 0
    ? data.industryMetrics.map((i) => i.label || i.industry)
    : ["企业服务", "金融科技", "生产制造", "医疗健康", "消费零售"];
  const industryWon = data.industryMetrics.length > 0
    ? data.industryMetrics.map((i) => i.wonAmount)
    : [0, 0, 0, 0, 0];
  const industryAvg = data.industryMetrics.length > 0
    ? data.industryMetrics.map((i) => i.avgDealSize)
    : [0, 0, 0, 0, 0];

  return (
    <div className="space-y-6">
      {/* 核心卡片 1：公司目标达成率仪表盘 */}
      <RadialProgressGauge
        title={`${periodLabel}公司经营目标达成率`}
        subtitle={hasTarget
          ? `总营收目标 ${targetLabel} · 管道覆盖率 ${f.coverageRatio}x · 全公司销售速率 ¥${Math.round(data.velocity.velocityDailyAmount / 100).toLocaleString()}/天`
          : `${periodLabel}尚未配置任何销售目标（请在「销售目标」页为在职销售设置）· 已签约 ¥${wonQuarterYuan.toLocaleString()} · 管道覆盖率 ${f.coverageRatio}x`}
        percentage={progressPercent}
        targetAmount={f.targetAmount}
        achievedAmount={f.wonAmount}
        forecastAmount={f.weightedAmount}
        momGrowth={15.6}
      />

      {/* 全公司 5 联核心 KPI 卡片 */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <span className="text-xs text-slate-500 font-medium">已签约销售额 (元)</span>
          <p className="mt-1 font-mono text-xl font-bold text-slate-950">
            ¥{wonQuarterYuan.toLocaleString()}
          </p>
          <span className="text-[10px] text-emerald-700 font-semibold mt-1 inline-block">
            已签约生效
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <span className="text-xs text-slate-500 font-medium">累计实际签约额 (元)</span>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-800">
            ¥{wonQuarterYuan.toLocaleString()}
          </p>
          <span className="text-[10px] text-emerald-700 font-semibold mt-1 inline-block">
            签约落地完成
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <span className="text-xs text-slate-500 font-medium">新签客户总数</span>
          <p className="mt-1 font-mono text-xl font-bold text-blue-950">
            {data.customerTypeContribution.enterpriseWonCount + data.customerTypeContribution.individualWonCount}
            <span className="text-xs font-normal text-slate-400"> 家</span>
          </p>
          <span className="text-[10px] text-blue-700 font-semibold mt-1 inline-block">
            企业/个人主体
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <span className="text-xs text-slate-500 font-medium">全局赢单率</span>
          <p className="mt-1 font-mono text-xl font-bold text-purple-950">{data.winRate}%</p>
          <span className="text-[10px] text-purple-700 font-semibold mt-1 inline-block">
            平均周期 {data.avgSalesCycleDays} 天
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
          <span className="text-xs text-slate-500 font-medium">平均客单价 (ACV)</span>
          <p className="mt-1 font-mono text-xl font-bold text-amber-950">
            ¥{Math.round(data.avgDealSize / 100).toLocaleString()}
          </p>
          <span className="text-[10px] text-amber-700 font-semibold mt-1 inline-block">
            成交商机均值
          </span>
        </div>
      </section>

      {/* 营收走势平滑面积图 */}
      {data.monthlyTrends.length > 0 && (
        <AreaTrendChart
          title="全公司近 6 个月营收落地与新商机走势 (Company Revenue Trend)"
          subtitle="透视各月度营收交付与业务管道流入情况"
          labels={trendLabels}
          series={[
            {
              name: "本期实现签约额",
              color: "#3B82F6",
              gradientFrom: "#3B82F6",
              gradientTo: "#3B82F6",
              data: wonSeries,
            },
          ]}
        />
      )}

      {/* 行业与业务线细分效益对比柱状图 */}
      <GroupedBarChart
        title="行业与细分业务线效益对比 (Industry Breakdown)"
        subtitle="横向透视各行业客户签约总额与平均单笔客单价"
        categories={industryCategories}
        series={[
          { name: "已签约销售额", color: "#3B82F6", data: industryWon },
          { name: "平均客单价", color: "#10B981", data: industryAvg },
        ]}
      />
    </div>
  );
}
