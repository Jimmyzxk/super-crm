export type StageProbability = {
  stage: "DISCOVERY" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST";
  probability: number;
};

export const STAGE_PROBABILITIES: Record<string, number> = {
  DISCOVERY: 0.2,
  PROPOSAL: 0.5,
  NEGOTIATION: 0.8,
  WON: 1.0,
  LOST: 0.0,
};

// 周期与维度筛选参数
export type AnalyticsPeriod = "month" | "quarter" | "year" | "last30d" | "all";

export type AnalyticsFilterParams = {
  period?: AnalyticsPeriod;
  ownerUserId?: string; // 指定销售人员
  customerType?: "ENTERPRISE" | "INDIVIDUAL"; // 客户类型
  industry?: string; // 所属行业
};

// 趋势数据点 (用于趋势折线/柱状图)
export type RevenueTrendPoint = {
  periodKey: string; // 如 "2026-03"
  label: string; // 如 "3月"
  wonAmount: number; // 分
  newDealsCount: number;
  wonCount: number;
};

// 销售速率 (Pipeline Velocity: V = (N * S * W) / T)
export type PipelineVelocityMetric = {
  activeDealsCount: number; // 活跃商机数 (N)
  avgDealSize: number; // 平均客单价 (S, 单位：分)
  winRate: number; // 历史赢单率 (W, 百分比 0-100)
  avgCycleDays: number; // 平均成单周期 (T, 单位：天)
  velocityDailyAmount: number; // 日均提炼产出金额 (单位：分/天)
  velocityMonthlyAmount: number; // 月度期望提炼产出 (单位：分/月)
};

// 三档预测模型 (Forecast Tiers)
export type ForecastTiers = {
  targetAmount: number; // 目标金额 (分)
  wonAmount: number; // 已赢单金额 (分)
  commitAmount: number; // 保底 Commit: 已赢单 + 商务谈判(80%) (分)
  weightedAmount: number; // 期望 Weighted: 综合各阶段加权 (分)
  bestCaseAmount: number; // 乐观 Best Case: 包含全部在进商机 (分)
  coverageRatio: number; // 管道覆盖率倍数 (如 2.8x)
  targetGap: number; // 距离目标的缺口金额 (分)
  // 目标唯一数据源为 sales_quotas：未配置配额时 targetAmount=0 且本标记为 false，
  // 下游必须显示「未设置目标」而不是伪装成"达成 0%"
  isTargetConfigured: boolean;
  quotaPeriodType: "MONTHLY" | "QUARTERLY" | "YEARLY" | null; // 命中��配额周期类型
  quotaPeriodKey: string | null; // 命中的配额 period_key (如 2026-M09)
};

// 商机/线索库龄分析 (Aging Buckets)
export type AgingBucket = {
  bucketKey: "0-7d" | "8-15d" | "16-30d" | "30d+";
  label: string;
  count: number;
  amount: number; // 分
  percentage: number; // 0-100
};

// 行业/业务线细分表现 (Industry & Segment)
export type IndustryMetric = {
  industry: string;
  label: string;
  totalDeals: number;
  wonCount: number;
  lostCount: number; // 输单数（赢单率分母 = won + lost，在途不进分母）
  wonAmount: number; // 分
  winRate: number; // 0-100，口径 = won / (won + lost)
  avgDealSize: number; // 分
};

// 销售运营与 SLA 响应指标 (RevOps SLA)
export type RevOpsSlaMetrics = {
  firstResponseSlaRate: number; // 24h 首响达标率 (0-100)
  avgFirstResponseHours: number; // 平均首响耗时 (小时)
  followupFrequency30d: number; // 团队近 30 天总跟进频次
  overdueTaskRate: number; // 待办逾期率 (0-100)
};

// 团队梯队人效分布 (Quota Attainment Tier)
export type TeamTierDistribution = {
  topTierCount: number; // 头部领跑 (达标率 >= 100%)
  midTierCount: number; // 中坚力量 (达标率 60% - 99%)
  rampTierCount: number; // 辅导成长 (达标率 < 60%)
  avgQuotaAttainment: number; // 团队平均达成率 (0-100)，分母为已配置配额的销售之和
  avgRepWonAmount: number; // 人均签约产出 (分)
  isTargetConfigured: boolean; // 当期是否存在任何已配置配额
};

// 团队成员选项
export type TeamMemberOption = {
  id: string;
  name: string;
  role: string;
};

// -------------------------------------------------------------
// 1. 销售个人罗盘数据 (Sales Radar)
// -------------------------------------------------------------
export type SalesRadarData = {
  forecast: ForecastTiers;
  velocity: PipelineVelocityMetric;
  estimatedCommission: number; // 预估提成奖励 (分, 按签约阶梯核算)
  activeOpportunitiesCount: number; // 活跃商机数
  myActiveLeadsCount: number; // 私海线索数
  overdueTasksCount: number; // 超期待办数
  todayTasksCount: number; // 今日待办数
  pipelineAging: AgingBucket[]; // 个人商机库龄分布
  monthlyTrends: RevenueTrendPoint[]; // 近6个月业绩趋势
  stalledOpportunities: Array<{
    id: string;
    name: string;
    customerId: string;
    customerName: string;
    stage: string;
    expectedAmount: number;
    stalledDays: number;
    lastFollowupAt: string | null;
  }>;
  topOpportunities: Array<{
    id: string;
    name: string;
    customerName: string;
    stage: string;
    expectedAmount: number;
    expectedCloseAt: string | null;
  }>;
};

// -------------------------------------------------------------
// 2. 团队效能与漏斗诊断数据 (Team Efficiency & Funnel)
// -------------------------------------------------------------
export type TeamFunnelData = {
  velocity: PipelineVelocityMetric; // 团队综合销售速率
  sla: RevOpsSlaMetrics; // 销售运营与响应质检
  tierDistribution: TeamTierDistribution; // 团队人效梯队分布
  monthlyTrends: RevenueTrendPoint[]; // 团队近6个月业绩趋势
  funnelSteps: Array<{
    stepKey: string;
    stepName: string;
    count: number;
    dropCount: number; // 该阶段损耗流失数量
    dropAmount: number; // 该阶段流失金额 (分)
    conversionRateFromPrevious: number; // 百分比 0-100
    conversionRateFromStart: number; // 百分比 0-100
  }>;
  stageVelocities: Array<{
    stage: string;
    stageName: string;
    avgDays: number;
    activeCount: number;
    activeAmount: number; // 分
  }>;
  memberMetrics: Array<{
    userId: string;
    userName: string;
    role: string;
    activeLeadsCount: number;
    activeOpportunitiesCount: number;
    monthWonAmount: number; // 分
    monthWonCount: number;
    quotaAttainment: number; // 达标率 %（分母为本人 sales_quotas 配额，未配置时为 0）
    isTargetConfigured: boolean; // 本人当期是否配置了销售目标
    targetAmount: number; // 本人当期销售目标 (分)
    recentActivitiesCount: number; // 近30天跟进次数
    overdueTasksCount: number;
  }>;
  sourceQualities: Array<{
    source: string;
    sourceName: string;
    totalLeads: number;
    qualifiedCount: number;
    convertedCount: number;
    wonAmount: number; // 分
    conversionRate: number; // 0-100
  }>;
};

// -------------------------------------------------------------
// 3. 经营大盘与营收预测数据 (Executive Forecast)
// -------------------------------------------------------------
export type ExecutiveForecastData = {
  forecast: ForecastTiers; // 季度三档预测 (Commit, Weighted, Best Case)
  velocity: PipelineVelocityMetric; // 公司全局销售速率
  avgDealSize: number; // 平均客单价 (分)
  avgSalesCycleDays: number; // 平均成单周期 (天)
  winRate: number; // 全局历史赢单率 (0-100)
  pipelineAging: AgingBucket[]; // 全公司商机库龄结构
  monthlyTrends: RevenueTrendPoint[]; // 公司近6个月营收与立项趋势
  industryMetrics: IndustryMetric[]; // 各行业/产品线效益
  customerTypeContribution: {
    enterpriseWonAmount: number; // 分
    enterpriseWonCount: number;
    enterpriseAvgDealSize: number; // 分
    individualWonAmount: number; // 分
    individualWonCount: number;
    individualAvgDealSize: number; // 分
  };
  lossAttributions: Array<{
    reason: string;
    reasonLabel: string;
    count: number;
    lostAmount: number; // 分
    percentage: number; // 0-100
  }>;
};
