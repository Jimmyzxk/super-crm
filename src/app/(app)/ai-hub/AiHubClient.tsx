"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/core/auth/types";
import type {
  AiAgentLearningLogItem,
  AiHubOverviewMetrics,
  AiPromptTemplateItem,
  AiQualityInspectionItem,
  AiInsightReportItem,
  AiInsightReportKind,
} from "@/core/ai-hub/types";
import type { ClosedOpportunityItem } from "@/core/ai-hub/service";
import type { SecurityComplianceConfigItem } from "@/core/security/service";
import {
  upsertPromptTemplateAction,
  runChampionAnalysisAction,
  runCompanyProfileAction,
  getAdoptionStatsAction,
  runDealAttributionAction,
  runGrowthOpportunityAction,
  listInsightReportsAction,
} from "@/core/ai-hub/actions";
import type { AdoptionStats } from "@/core/ai-hub/morning-copilot-service";
import type { GrowthOpportunityReport } from "@/core/ai-hub/agents/growth-opportunity";
import type { LlmTokenUsage } from "@/core/ai-gateway/client";
import { upsertSecurityComplianceConfigAction } from "@/core/security/actions";
import { testLlmConnectivityAction } from "@/core/ai-gateway/actions";
import { Button, Badge } from "@/components/ui";

interface AgentRunSummary {
  outcome: string;
  rounds: number;
  toolsUsed: string[];
  reportId?: string;
  tokenUsage?: LlmTokenUsage | number | unknown;
  evidenceCount?: number;
}

interface DealAttributionSummary extends AgentRunSummary {
  opportunityId: string;
  direction: "WON" | "LOST" | "UNKNOWN" | string;
  evidenceCount: number;
}

interface GrowthRunSummary extends AgentRunSummary {
  report?: GrowthOpportunityReport | unknown;
}

interface AiHubClientProps {
  initialOverview: AiHubOverviewMetrics;
  initialPromptTemplates: AiPromptTemplateItem[];
  initialInspections: AiQualityInspectionItem[];
  initialLearningLogs: AiAgentLearningLogItem[];
  initialSecurityConfig: SecurityComplianceConfigItem;
  initialAdoptionStats?: AdoptionStats | null;
  initialClosedOpportunities?: ClosedOpportunityItem[];
  initialInsightReports?: AiInsightReportItem[];
  currentUserRole: Role;
}

export default function AiHubClient({
  initialOverview,
  initialPromptTemplates,
  initialInspections,
  initialLearningLogs,
  initialSecurityConfig,
  initialAdoptionStats,
  initialClosedOpportunities,
  initialInsightReports,
  currentUserRole,
}: AiHubClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<
    "OVERVIEW" | "PROMPTS" | "INSPECTIONS" | "LEARNING" | "GATEWAY" | "MANAGEMENT"
  >("OVERVIEW");

  // 经营智能体运行状态（精简返回：不含全量 messages）
  const [championRunning, setChampionRunning] = useState(false);
  const [championResult, setChampionResult] = useState<AgentRunSummary | null>(null);
  const [companyProfileRunning, setCompanyProfileRunning] = useState(false);
  const [companyProfileResult, setCompanyProfileResult] = useState<AgentRunSummary | null>(null);
  const [growthRunning, setGrowthRunning] = useState(false);
  const [growthResult, setGrowthResult] = useState<GrowthRunSummary | null>(null);

  // 赢单/输单因果归因 (L1 Deal Attribution) 状态
  const [closedOpportunities] = useState<ClosedOpportunityItem[]>(
    initialClosedOpportunities ?? []
  );
  const [selectedOppId, setSelectedOppId] = useState<string>(
    initialClosedOpportunities?.[0]?.id ?? ""
  );
  const [attributionRunning, setAttributionRunning] = useState(false);
  const [attributionResult, setAttributionResult] = useState<DealAttributionSummary | null>(null);
  const [attributionError, setAttributionError] = useState<string | null>(null);

  const handleRunDealAttribution = async () => {
    if (!selectedOppId) return;
    setAttributionRunning(true);
    setAttributionError(null);
    try {
      const res = await runDealAttributionAction(selectedOppId);
      if (res.ok) {
        setAttributionResult(res.data);
      } else {
        setAttributionError(res.message);
      }
    } catch (err) {
      setAttributionError(err instanceof Error ? err.message : "归因分析执行失败");
    } finally {
      setAttributionRunning(false);
    }
  };

  // 晨会副驾驶采纳率看板状态
  const [adoptionDays, setAdoptionDays] = useState<7 | 30>(7);
  const [adoptionStats, setAdoptionStats] = useState<AdoptionStats | null>(initialAdoptionStats ?? null);
  const [loadingAdoption, setLoadingAdoption] = useState(false);

  const handleSwitchAdoptionDays = async (days: 7 | 30) => {
    setAdoptionDays(days);
    setLoadingAdoption(true);
    try {
      const res = await getAdoptionStatsAction(days);
      if (res.ok) {
        setAdoptionStats(res.data);
      }
    } finally {
      setLoadingAdoption(false);
    }
  };

  // 认知历史报告持久化归档状态
  const [insightReports, setInsightReports] = useState<AiInsightReportItem[]>(initialInsightReports ?? []);
  const [selectedReportKind, setSelectedReportKind] = useState<"ALL" | AiInsightReportKind>("ALL");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("ALL");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(
    initialInsightReports?.[0]?.id ?? null
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    const reportId = params.get("reportId");
    if (tab !== "management" && !reportId) return;
    // URL 深链仅在挂载后惰性应用一次，延迟到宏任务避免同步级联渲染
    const t = setTimeout(() => {
      if (tab === "management") setActiveTab("MANAGEMENT");
      if (reportId) setSelectedReportId(reportId);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const [promptTemplates, setPromptTemplates] = useState<AiPromptTemplateItem[]>(initialPromptTemplates);
  const [inspections] = useState<AiQualityInspectionItem[]>(initialInspections);
  const [learningLogs] = useState<AiAgentLearningLogItem[]>(initialLearningLogs);
  const [securityConfig, setSecurityConfig] = useState<SecurityComplianceConfigItem>(initialSecurityConfig);

  // 编辑提示词弹窗状态
  const [editingPrompt, setEditingPrompt] = useState<AiPromptTemplateItem | null>(null);
  const [promptForm, setPromptForm] = useState({
    name: "",
    description: "",
    systemPrompt: "",
    userPromptTemplate: "",
    isActive: true,
  });

  // 大模型网关配置表单状态
  const [gatewayForm, setGatewayForm] = useState({
    isAiCopilotEnabled: securityConfig.isAiCopilotEnabled ?? false,
    aiProvider: securityConfig.aiProvider ?? "BUILTIN",
    // 出于安全，明文 Key 不再回填表单；已保存时仅通过占位符显示掩码
    aiApiKey: "",
    aiApiEndpoint: securityConfig.aiApiEndpoint ?? "",
    aiModelName: securityConfig.aiModelName ?? "deepseek-chat",
    aiTemperature: securityConfig.aiTemperature ?? 0.3,
  });
  const [showApiKey, setShowApiKey] = useState(false);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isAdmin = currentUserRole === "ADMIN";

  function handleOpenEditPrompt(item: AiPromptTemplateItem) {
    setEditingPrompt(item);
    setPromptForm({
      name: item.name,
      description: item.description || "",
      systemPrompt: item.systemPrompt,
      userPromptTemplate: item.userPromptTemplate,
      isActive: item.isActive,
    });
  }

  function handleSavePrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPrompt) return;
    setErrorMessage(null);

    startTransition(async () => {
      const res = await upsertPromptTemplateAction({
        id: editingPrompt.id,
        scene: editingPrompt.scene,
        name: promptForm.name,
        description: promptForm.description,
        systemPrompt: promptForm.systemPrompt,
        userPromptTemplate: promptForm.userPromptTemplate,
        variables: editingPrompt.variables,
        isActive: promptForm.isActive,
      });

      if (res.ok) {
        setPromptTemplates((prev) =>
          prev.map((p) => (p.id === res.data.id ? res.data : p)),
        );
        setEditingPrompt(null);
        setFeedback("提示词策略模板已更新");
        setTimeout(() => setFeedback(null), 3000);
      } else {
        setErrorMessage(res.message);
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  }

  function handleProviderChange(provider: SecurityComplianceConfigItem["aiProvider"]) {
    setGatewayForm((prev) => {
      let endpoint = prev.aiApiEndpoint;
      let model = prev.aiModelName;
      if (provider === "DEEPSEEK") {
        endpoint = "https://api.deepseek.com/v1";
        model = "deepseek-chat";
      } else if (provider === "OPENAI") {
        endpoint = "https://api.openai.com/v1";
        model = "gpt-4o-mini";
      } else if (provider === "ZHIPU") {
        endpoint = "https://open.bigmodel.cn/api/paas/v4";
        model = "glm-4-flash";
      } else if (provider === "QWEN") {
        endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1";
        model = "qwen-plus";
      } else if (provider === "GEMINI") {
        endpoint = "https://generativelanguage.googleapis.com/v1beta/openai";
        model = "gemini-1.5-flash";
      }
      return {
        ...prev,
        aiProvider: provider,
        aiApiEndpoint: endpoint,
        aiModelName: model,
      };
    });
  }

  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs?: number;
    responsePreview?: string;
    errorMessage?: string;
  } | null>(null);

  async function handleTestLlmConnection() {
    if (!gatewayForm.aiApiKey || !gatewayForm.aiApiKey.trim()) {
      setErrorMessage(securityConfig.aiApiKeyMasked ? "已保存的 Key 不再回显，如需测试请重新输入 API Key" : "请先输入 API Key 再进行连通性测试");
      return;
    }
    setErrorMessage(null);
    setIsTestingLlm(true);
    setTestResult(null);

    const res = await testLlmConnectivityAction({
      provider: gatewayForm.aiProvider,
      apiKey: gatewayForm.aiApiKey.trim(),
      apiEndpoint: gatewayForm.aiApiEndpoint.trim() || null,
      modelName: gatewayForm.aiModelName.trim() || "deepseek-chat",
    });

    setIsTestingLlm(false);
    if (res.ok) {
      setTestResult({
        success: true,
        latencyMs: res.data.latencyMs,
        responsePreview: res.data.responsePreview,
      });
      setFeedback(`大模型网关连通正常！响应耗时 ${res.data.latencyMs}ms${res.data.aiCopilotEnabled ? "" : "（注意：AI 总开关当前为关闭状态，本次外呼为管理员显式测试，已记入审计）"}`);
      setTimeout(() => setFeedback(null), 4000);
    } else {
      setTestResult({
        success: false,
        errorMessage: res.message,
      });
      setErrorMessage(`连通性测试失败: ${res.message}`);
    }
  }

  function handleSaveGateway(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    startTransition(async () => {
      const res = await upsertSecurityComplianceConfigAction({
        isAiCopilotEnabled: gatewayForm.isAiCopilotEnabled,
        aiProvider: gatewayForm.aiProvider,
        // 留空 = 保留已保存的 Key（undefined），只有显式清空或输入新值才覆盖
        aiApiKey: gatewayForm.aiApiKey.trim() || undefined,
        aiApiEndpoint: gatewayForm.aiApiEndpoint.trim() || null,
        aiModelName: gatewayForm.aiModelName.trim() || "deepseek-chat",
        aiTemperature: gatewayForm.aiTemperature,
      });

      if (res.ok) {
        setSecurityConfig(res.data);
        setFeedback("大模型接入配置已生效");
        router.refresh();
        setTimeout(() => setFeedback(null), 3000);
      } else {
        setErrorMessage(res.message);
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  }

  async function handleRunChampionAnalysis() {
    setChampionRunning(true);
    setErrorMessage(null);
    try {
      const res = await runChampionAnalysisAction();
      if (!res.ok) {
        setErrorMessage(res.message);
      } else {
        setChampionResult(res.data);
        setFeedback("销冠解构智能体分析已生成并存档");
        const freshReports = await listInsightReportsAction();
        if (freshReports.ok) {
          setInsightReports(freshReports.data);
          if (freshReports.data.length > 0) {
            setSelectedReportId(freshReports.data[0].id);
          }
        }
        setTimeout(() => setFeedback(null), 3000);
      }
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "运行销冠解构智能体失败");
    } finally {
      setChampionRunning(false);
    }
  }

  async function handleRunCompanyProfile() {
    setCompanyProfileRunning(true);
    setErrorMessage(null);
    try {
      const res = await runCompanyProfileAction();
      if (!res.ok) {
        setErrorMessage(res.message);
      } else {
        setCompanyProfileResult(res.data);
        setFeedback("企业画像与客盘诊断智能体报告已生成并存档");
        const freshReports = await listInsightReportsAction();
        if (freshReports.ok) {
          setInsightReports(freshReports.data);
          if (freshReports.data.length > 0) {
            setSelectedReportId(freshReports.data[0].id);
          }
        }
        setTimeout(() => setFeedback(null), 3000);
      }
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "运行企业画像智能体失败");
    } finally {
      setCompanyProfileRunning(false);
    }
  }

  async function handleRunGrowth() {
    setGrowthRunning(true);
    setErrorMessage(null);
    try {
      const res = await runGrowthOpportunityAction();
      if (!res.ok) {
        setErrorMessage(res.message);
      } else {
        setGrowthResult(res.data);
        setFeedback("增量与变现智能体报告已生成");
        setTimeout(() => setFeedback(null), 3000);
      }
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "运行增量与变现智能体失败");
    } finally {
      setGrowthRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. 顶部 Header 状态栏 */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-slate-950">AI 智能体与质检中心 (AI Agent Hub)</h1>
              <Badge
                variant={securityConfig.isAiCopilotEnabled ? "emerald" : "neutral"}
                dot
                size="sm"
              >
                {securityConfig.isAiCopilotEnabled ? "智能体运行中" : "智能体已暂停"}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              销售智能体管控中枢：统一纳管提示词策略池、商机事实质检大脑、赢单自学习经验库与多模型网关
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600 font-mono bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg shadow-2xs">
            服务商: <strong className="text-slate-900">{securityConfig.aiProvider}</strong> ({securityConfig.aiModelName})
          </span>
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl font-medium shadow-2xs">
          {feedback}
        </div>
      )}

      {errorMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl font-medium shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-600 hover:text-rose-800 text-xs font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* 2. 核心 5 大 Tab 导航 */}
      <div className="flex border-b border-slate-200 overflow-x-auto gap-1 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab("OVERVIEW")}
          className={`pb-3 px-4 font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
            activeTab === "OVERVIEW"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          <span>智能体大盘与监控</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("PROMPTS")}
          className={`pb-3 px-4 font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
            activeTab === "PROMPTS"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <span>提示词策略池 ({promptTemplates.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("INSPECTIONS")}
          className={`pb-3 px-4 font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
            activeTab === "INSPECTIONS"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <span>商机事实质检 ({inspections.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("LEARNING")}
          className={`pb-3 px-4 font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
            activeTab === "LEARNING"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
          </svg>
          <span>自学习经验库 ({learningLogs.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("GATEWAY")}
          className={`pb-3 px-4 font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
            activeTab === "GATEWAY"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
          <span>模型服务网关</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("MANAGEMENT")}
          className={`pb-3 px-4 font-semibold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
            activeTab === "MANAGEMENT"
              ? "border-slate-900 text-slate-950 font-bold"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
          </svg>
          <span>经营智能体</span>
        </button>
      </div>

      {/* Tab 1: 智能体大盘与监控指标 */}
      {activeTab === "OVERVIEW" && (
        <div className="space-y-6">
          {/* 指标卡矩阵 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-1">
              <span className="text-slate-400 text-xs font-medium">累计商机质检总数</span>
              <div className="text-2xl font-mono font-bold text-slate-950">
                {initialOverview.totalInspectionsCount} <span className="text-xs text-slate-400 font-normal">次</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">自动核查 4 大成交要素</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-1">
              <span className="text-slate-400 text-xs font-medium">商机质检平均得分</span>
              <div className="text-2xl font-mono font-bold text-slate-950">
                {initialOverview.averageInspectionScore} <span className="text-xs text-slate-400 font-normal">/ 100</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-950 mt-1 font-medium">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span>全盘推进健康度良好</span>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-1">
              <span className="text-slate-400 text-xs font-medium">沉淀销冠实战策略样本</span>
              <div className="text-2xl font-mono font-bold text-slate-950">
                {initialOverview.learnedStrategiesCount} <span className="text-xs text-slate-400 font-normal">条</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">从赢单复盘中自动反哺提炼</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-1">
              <span className="text-slate-400 text-xs font-medium">一线销售 AI 建议采纳率</span>
              <div className="text-2xl font-mono font-bold text-slate-950">
                {initialOverview.feedbackAdoptionRatePercent}%
              </div>
              <p className="text-[11px] text-slate-500 mt-1">销售一线高度认可并采纳</p>
            </div>
          </div>

          {/* 智能体体系架构说明卡 */}
          <div className="bg-slate-900 rounded-xl p-6 text-white shadow-xs space-y-3 border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm flex items-center gap-2">
                <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
                <span>企业级 AI Agent 决策与质检运作机制</span>
              </span>
              <span className="text-[11px] bg-slate-800 text-slate-300 border border-slate-700 px-3 py-0.5 rounded-full font-mono">
                {"Perception -> Reasoning -> Action -> Learning"}
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed max-w-4xl">
              本系统智能体由 <strong>「提示词策略池」</strong>、<strong>「4 维客观事实质检」</strong> 与 <strong>「赢单复盘知识沉淀库」</strong> 构筑闭环。所有诊断与质检严格立足真实数据库事实（拍板人 EB、报价单 SKU、时效时钟），杜绝虚构幻觉。
            </p>
          </div>

          {/* 最近质检与学习日志 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="font-bold text-slate-950">最新商机质检流水</span>
                <button
                  type="button"
                  onClick={() => setActiveTab("INSPECTIONS")}
                  className="text-slate-950 hover:underline font-semibold text-[11px]"
                >
                  查看全部 →
                </button>
              </div>

              <div className="space-y-2.5">
                {inspections.slice(0, 4).map((item) => (
                  <div key={item.id} className="p-3 bg-slate-50/70 rounded-xl border border-slate-200/70 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900">{item.opportunityTitle || "商机质检"}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{item.customerName || "客户企业"} · {item.findings[0]}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded font-mono font-bold text-xs ${
                      item.score >= 80 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                    }`}>
                      {item.score}分
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="font-bold text-slate-950">智能体自学习沉淀样本</span>
                <button
                  type="button"
                  onClick={() => setActiveTab("LEARNING")}
                  className="text-slate-950 hover:underline font-semibold text-[11px]"
                >
                  查看知识库 →
                </button>
              </div>

              <div className="space-y-2.5">
                {learningLogs.slice(0, 4).map((item) => (
                  <div key={item.id} className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900">{item.topic}</div>
                      <div className="text-[11px] text-slate-600 mt-0.5 line-clamp-1">{item.extractedStrategy}</div>
                    </div>
                    <span className="text-[10px] text-blue-700 font-mono bg-blue-100 px-2 py-0.5 rounded font-bold shrink-0 ml-2">
                      {item.sourceType}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: 提示词策略池 (Prompt Template Pool) */}
      {activeTab === "PROMPTS" && (
        <div className="space-y-4 text-xs">
          <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200/80">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-950">AI 打单策略与话术模版库</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                支持按业务场景自定义 AI 的说话风格与应对策略。系统会自动把客户姓名、金额、跟进天数等事实填入模板
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {promptTemplates.map((item) => {
              const sceneLabel =
                item.scene === "OPPORTUNITY_DIAGNOSTIC"
                  ? "商机成单诊断"
                  : item.scene === "OBJECTION_KILLER"
                  ? "客户异议应对"
                  : item.scene === "LEAD_OUTREACH"
                  ? "新客破冰触达"
                  : item.scene === "DEAL_INSPECTION"
                  ? "商机漏项检查"
                  : "会谈纪要提取";

              return (
                <div key={item.id} className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="blue" size="sm">
                        {sceneLabel} · 版本 v{item.version}
                      </Badge>
                      <Badge
                        variant={item.isActive ? "emerald" : "neutral"}
                        dot
                        size="sm"
                      >
                        {item.isActive ? "启用中" : "已停用"}
                      </Badge>
                    </div>

                    <h3 className="font-bold text-slate-900 text-sm">{item.name}</h3>
                    <p className="text-[11px] text-slate-500 leading-relaxed">{item.description}</p>

                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      <span className="text-[10px] text-slate-400 font-bold block">系统自动填入的数据字段：</span>
                      <div className="flex flex-wrap gap-1">
                        {item.variables.map((v) => (
                          <span key={v} className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                            {`{${v}}`}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2 space-y-1">
                      <span className="text-[10px] text-slate-400 font-bold block">给 AI 设定的销售人设与原则：</span>
                      <p className="text-[11px] text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-100 line-clamp-2">
                        {item.systemPrompt}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
                    {isAdmin && (
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => handleOpenEditPrompt(item)}
                      >
                        编辑策略与话术
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 3: 商机智能质检 (Quality Inspections) */}
      {activeTab === "INSPECTIONS" && (
        <div className="space-y-4 text-xs">
          <div className="bg-white rounded-xl border border-slate-200/80 p-4">
            <h2 className="text-xl font-bold tracking-tight text-slate-950">商机推进质量与客观事实质检流水</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              质检大脑每秒比对数据库客观事实：关键拍板人 EB、报价单配置 SKU、SLA 活跃时效与停滞卡点
            </p>
          </div>

          <div className="space-y-3">
            {inspections.map((item) => (
              <div key={item.id} className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <span className="text-sm font-bold text-slate-900">{item.opportunityTitle || "商机质检"}</span>
                    <span className="text-slate-400 mx-1.5">/</span>
                    <span className="text-slate-600 font-medium">{item.customerName || "客户企业"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                      item.verdict === "PASSED"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : item.verdict === "NEEDS_ATTENTION"
                        ? "bg-amber-50 text-amber-800 border-amber-200"
                        : "bg-rose-50 text-rose-800 border-rose-200"
                    }`}>
                      {item.verdict === "PASSED" ? (
                        <>
                          <svg className="w-3 h-3 text-slate-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                          <span>质检合格</span>
                        </>
                      ) : item.verdict === "NEEDS_ATTENTION" ? (
                        <>
                          <svg className="w-3 h-3 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                          </svg>
                          <span>需关注</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <span>高危卡点</span>
                        </>
                      )}
                    </span>
                    <span className="font-mono font-bold text-slate-900 text-sm bg-slate-100 px-2 py-0.5 rounded">
                      {item.score} 分
                    </span>
                  </div>
                </div>

                {/* 4 维核验指示灯 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-100">
                    {item.dimensions?.decisionMakerVerified ? (
                      <svg className="w-3.5 h-3.5 text-slate-950 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                    )}
                    <span className="text-slate-700">关键决策人 (EB)</span>
                  </div>
                  <div className="flex items-center gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-100">
                    {item.dimensions?.pricingLineItemsConfigured ? (
                      <svg className="w-3.5 h-3.5 text-slate-950 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                    )}
                    <span className="text-slate-700">报价产品单 (SKU)</span>
                  </div>
                  <div className="flex items-center gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-100">
                    {item.dimensions?.followupSlaHealthy ? (
                      <svg className="w-3.5 h-3.5 text-slate-950 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                    )}
                    <span className="text-slate-700">跟进活跃度 (SLA)</span>
                  </div>
                  <div className="flex items-center gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-100">
                    {item.dimensions?.guardrailsCompliant ? (
                      <svg className="w-3.5 h-3.5 text-slate-950 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                    )}
                    <span className="text-slate-700">推进风控合规</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold">质检核验发现：</span>
                    <ul className="space-y-1 text-[11px] text-slate-700">
                      {item.findings.map((f, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <span className="text-slate-400">•</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-950 font-bold">AI 智能体整改指令：</span>
                    <ul className="space-y-1 text-[11px] text-indigo-900 font-medium">
                      {item.actionRecommendations.map((r, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <span className="text-indigo-500">→</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: 智能体自学习与进化知识库 (Learning Hub) */}
      {activeTab === "LEARNING" && (
        <div className="space-y-4 text-xs">
          <div className="bg-white rounded-xl border border-slate-200/80 p-4">
            <h2 className="text-xl font-bold tracking-tight text-slate-950">智能体实战经验自学习与打法反哺库</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              当销售打单赢单并完成《赢单复盘》后，智能体自主提炼成功策略沉淀于此，持续反哺全员话术生成
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {learningLogs.map((item) => (
              <div key={item.id} className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded font-bold">
                      {item.sourceType}
                    </span>
                    <span className="text-[10px] font-mono text-slate-950 font-bold">
                      打法有效度: {item.effectivenessScore}%
                    </span>
                  </div>

                  <h3 className="font-bold text-slate-900 text-sm">{item.topic}</h3>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold block">核心攻坚策略提炼：</span>
                    <p className="text-[11px] text-slate-800 leading-relaxed font-medium">
                      {item.extractedStrategy}
                    </p>
                  </div>

                  {item.sampleDialogue && (
                    <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-1">
                      <span className="text-[10px] text-indigo-700 font-bold block">销冠原声实战示范台词：</span>
                      <p className="text-[11px] text-indigo-950 font-mono italic">
                        &ldquo;{item.sampleDialogue}&rdquo;
                      </p>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                  <span>自动反哺进提示词策略池</span>
                  <span className="text-slate-950 font-semibold flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    <span>已生效</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 5: 大模型服务网关 (Model Gateway) */}
      {activeTab === "GATEWAY" && (
        <div className="bg-white rounded-xl border border-slate-200/90 p-6 shadow-2xs space-y-4 text-xs max-w-3xl">
          <div>
            <h2 className="font-bold text-slate-950 text-sm">企业大模型接入与网关配置 (Multi-Provider Gateway)</h2>
            <p className="text-[11px] text-slate-500 mt-1">
              按需接入企业自有大模型服务（DeepSeek、OpenAI、智谱、阿里通义、Google Gemini 或本地私有化端点）
            </p>
          </div>

          <form onSubmit={handleSaveGateway} className="space-y-4 pt-2">
            <div className="p-4 bg-indigo-50/40 rounded-xl border border-indigo-200/80 flex items-center justify-between">
              <div>
                <span className="font-bold text-indigo-950 text-xs block">
                  启用企业 AI 智能体打单与销冠副驾驶
                </span>
                <span className="text-[11px] text-slate-600">
                  关闭时，全员保持纯净确定性规则工作台；开启后解锁大模型赋能
                </span>
              </div>
              <input
                type="checkbox"
                checked={gatewayForm.isAiCopilotEnabled}
                onChange={(e) =>
                  setGatewayForm({ ...gatewayForm, isAiCopilotEnabled: e.target.checked })
                }
                className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-indigo-600 cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  模型服务商 (Provider)
                </label>
                <select
                  value={gatewayForm.aiProvider}
                  onChange={(e) =>
                    handleProviderChange(
                      e.target.value as SecurityComplianceConfigItem["aiProvider"],
                    )
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                >
                  <option value="BUILTIN">内置销冠实战策略规则库 (无需外部 Key，开箱即用)</option>
                  <option value="DEEPSEEK">DeepSeek 深度求索 (推荐，高性价比打单分析)</option>
                  <option value="OPENAI">OpenAI (GPT-4o / GPT-4o-mini)</option>
                  <option value="ZHIPU">智谱清言 (GLM-4 / GLM-4-Flash)</option>
                  <option value="QWEN">阿里通义千问 (Qwen-Plus / Qwen-Max)</option>
                  <option value="GEMINI">Google Gemini (1.5 Pro / Flash)</option>
                  <option value="CUSTOM">自定义 OpenAI 兼容 API 端点</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-slate-700">
                    模型名称 (Model Name)
                  </label>
                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="text-slate-400">快捷预设:</span>
                    <button
                      type="button"
                      onClick={() => setGatewayForm({ ...gatewayForm, aiModelName: gatewayForm.aiProvider === "ZHIPU" ? "glm-4-flash" : gatewayForm.aiProvider === "OPENAI" ? "gpt-4o-mini" : "deepseek-chat" })}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-medium transition"
                      title="1~2秒快速生成"
                    >
                      <svg className="w-3 h-3 text-slate-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                      </svg>
                      <span>极速打单</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setGatewayForm({ ...gatewayForm, aiModelName: gatewayForm.aiProvider === "ZHIPU" ? "glm-5.3" : gatewayForm.aiProvider === "OPENAI" ? "o3-mini" : "deepseek-reasoner" })}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 font-medium transition"
                      title="20~50秒长思维链深度推演"
                    >
                      <svg className="w-3 h-3 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                      <span>深度思考</span>
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={gatewayForm.aiModelName}
                  onChange={(e) => setGatewayForm({ ...gatewayForm, aiModelName: e.target.value })}
                  placeholder="deepseek-chat / glm-4-flash / glm-5.3"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none font-mono"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-slate-700">API 密钥 (API Key)</label>
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="text-[10px] text-slate-950 hover:underline"
                  >
                    {showApiKey ? "隐藏" : "显示明文"}
                  </button>
                </div>
                <input
                  type={showApiKey ? "text" : "password"}
                  value={gatewayForm.aiApiKey}
                  onChange={(e) => setGatewayForm({ ...gatewayForm, aiApiKey: e.target.value })}
                  placeholder={
                    gatewayForm.aiProvider === "BUILTIN"
                      ? "内置规则无需填 Key"
                      : securityConfig.aiApiKeyMasked
                        ? `已保存 ${securityConfig.aiApiKeyMasked}（留空保持不变）`
                        : "sk-************************"
                  }
                  disabled={gatewayForm.aiProvider === "BUILTIN"}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none font-mono disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">API Base URL</label>
                <input
                  type="text"
                  value={gatewayForm.aiApiEndpoint}
                  onChange={(e) => setGatewayForm({ ...gatewayForm, aiApiEndpoint: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                  disabled={gatewayForm.aiProvider === "BUILTIN"}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none font-mono disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>

              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-slate-700">
                    回答风格调节: <span className="font-mono text-indigo-700">{gatewayForm.aiTemperature}</span>
                  </label>
                  <span className="text-[10px] text-slate-400">
                    {gatewayForm.aiTemperature <= 0.3 ? "0.0~0.3: 精准严谨质检（推荐）" : gatewayForm.aiTemperature <= 0.7 ? "0.4~0.7: 平衡适中" : "0.8~1.0: 丰富生动破冰"}
                  </span>
                </div>
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.05"
                value={gatewayForm.aiTemperature}
                onChange={(e) => setGatewayForm({ ...gatewayForm, aiTemperature: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>
          </div>

          {/* 连通性测试结果反馈 */}
          {testResult && (
            <div className={`p-3 rounded-xl border text-xs space-y-1.5 ${
              testResult.success
                ? "bg-emerald-50/80 border-emerald-200 text-emerald-900"
                : "bg-rose-50/80 border-rose-200 text-rose-900"
            }`}>
              <div className="flex items-center justify-between font-bold">
                <span className="flex items-center gap-1.5">
                  {testResult.success ? (
                    <>
                      <svg className="w-4 h-4 text-slate-950 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>API 连通性校验通过 (真实 LLM 活跃)</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                      </svg>
                      <span>API 连通性校验失败</span>
                    </>
                  )}
                </span>
                {testResult.latencyMs !== undefined && (
                  <span className="font-mono text-[11px] bg-white/80 px-2 py-0.5 rounded border border-emerald-200">
                    延迟: {testResult.latencyMs} ms
                  </span>
                )}
              </div>
              {testResult.responsePreview && (
                <div className="text-[11px] text-emerald-800 bg-white/70 p-2 rounded-lg border border-emerald-100 font-mono">
                  模型实时回包验证：{testResult.responsePreview}
                </div>
              )}
              {testResult.errorMessage && (
                <div className="text-[11px] text-rose-700 bg-white/70 p-2 rounded-lg border border-rose-100 font-mono">
                  错误排查信息：{testResult.errorMessage}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <button
              type="button"
              disabled={isTestingLlm || gatewayForm.aiProvider === "BUILTIN"}
              onClick={handleTestLlmConnection}
              className="inline-flex h-8 items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 shadow-2xs gap-1.5 disabled:opacity-50 disabled:pointer-events-none"
            >
              <svg className={`w-3.5 h-3.5 ${isTestingLlm ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>{isTestingLlm ? "正在测试大模型连通性..." : "测试大模型连通性"}</span>
            </button>

            {isAdmin && (
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex h-8 items-center rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 shadow-2xs"
              >
                {isPending ? "保存中..." : "保存模型网关配置"}
              </button>
            )}
          </div>
        </form>
      </div>
    )}

    {/* Tab 6: 经营智能体矩阵 (Cognitive Agents) */}
    {/* Tab 6: 经营智能体矩阵 (Cognitive Agents) */}
    {activeTab === "MANAGEMENT" && (
      <div className="space-y-6">
        <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>经营智能体矩阵与因果归因 (Cognitive & Attribution Agents)</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200">
                  L1-L3 认知金字塔
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                基于 ReAct 自主智能体马具，调取生命周期事实与归因数据，产出带证据链与转折点的因果解释报告。
              </p>
            </div>
          </div>
        </div>

        {/* Card 0: 赢单/输单因果归因 (L1 Deal Attribution) */}
        <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-sm">商机因果归因智能体 (Deal Attribution)</span>
                <Badge variant="amber" size="sm">L1 认知层 · 因果解释</Badge>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                解释“这一单为什么赢/为什么输”：拉取阶段停留、跟进记录、战情室介入与报价偏差，提炼转折点与可复制/可避免动作。
              </p>
            </div>
          </div>

          <div className="bg-slate-50/80 rounded-xl p-3.5 border border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-[280px]">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">选择已关闭商机 (WON / LOST)</label>
              {closedOpportunities.length > 0 ? (
                <select
                  value={selectedOppId}
                  onChange={(e) => setSelectedOppId(e.target.value)}
                  disabled={attributionRunning}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                >
                  {closedOpportunities.map((opp) => (
                    <option key={opp.id} value={opp.id}>
                      [{opp.stage}] {opp.name} - {opp.customerName} ({opp.actualAmountYuan ? `¥${opp.actualAmountYuan.toLocaleString()}` : (opp.expectedAmountYuan ? `¥${opp.expectedAmountYuan.toLocaleString()}` : "未设金额")} | 负责人: {opp.ownerName})
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-slate-400">当前名下暂无已结案（赢单/输单）商机</p>
              )}
            </div>

            <Button
              variant="primary"
              size="sm"
              isLoading={attributionRunning}
              disabled={attributionRunning || !selectedOppId}
              onClick={handleRunDealAttribution}
              className="mt-auto"
            >
              <span>生成因果归因报告 (L1)</span>
            </Button>
          </div>

          {attributionError && (
            <div className="bg-rose-50 text-rose-700 text-xs px-3.5 py-2.5 rounded-xl border border-rose-200">
              {attributionError}
            </div>
          )}

          {attributionResult && (
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono">
                  执行轮数: {attributionResult.rounds} 轮
                </span>
                <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono">
                  调取工具: {attributionResult.toolsUsed.join(", ") || "无"}
                </span>
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-mono">
                  证据引用: {attributionResult.evidenceCount} 项事实来源
                </span>
              </div>
              <div className="bg-slate-50/80 rounded-xl p-4 text-xs text-slate-800 font-sans whitespace-pre-wrap leading-relaxed border border-slate-200">
                {attributionResult.outcome}
              </div>
            </div>
          )}
        </div>

        {currentUserRole !== "SALES" && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Card 1: 销冠解构智能体 */}
              <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">销冠解构智能体</span>
                        <Badge variant="emerald" size="sm">L2 打法提炼</Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        聚合头部销售业绩与成单周期，多维对比赢单 vs 丢单归因，提炼可复制的打法假设。
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-center"
                    isLoading={championRunning}
                    disabled={championRunning}
                    onClick={handleRunChampionAnalysis}
                  >
                    <span>运行销冠解构 (L2)</span>
                  </Button>
                </div>

                {championResult && (
                  <div className="space-y-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono">
                        执行轮数: {championResult.rounds} 轮
                      </span>
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono">
                        调取工具: {championResult.toolsUsed.join(", ") || "无"}
                      </span>
                    </div>
                    <div className="bg-slate-50/80 rounded-xl p-4 text-xs text-slate-800 font-sans whitespace-pre-wrap leading-relaxed border border-slate-200 overflow-auto max-h-96">
                      {championResult.outcome}
                    </div>
                  </div>
                )}
              </div>

              {/* Card 2: 企业画像与客盘诊断智能体 */}
              <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">企业画像智能体</span>
                        <Badge variant="blue" size="sm">L3 客盘透视</Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        透视客户盘子结构（行业×规模×类型）与营收贡献，识别单一依赖风险与增长机会。
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-center"
                    isLoading={companyProfileRunning}
                    disabled={companyProfileRunning}
                    onClick={handleRunCompanyProfile}
                  >
                    <span>运行企业画像 (L3)</span>
                  </Button>
                </div>

                {companyProfileResult && (
                  <div className="space-y-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono">
                        执行轮数: {companyProfileResult.rounds} 轮
                      </span>
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono">
                        调取工具: {companyProfileResult.toolsUsed.join(", ") || "无"}
                      </span>
                    </div>
                    <div className="bg-slate-50/80 rounded-xl p-4 text-xs text-slate-800 font-sans whitespace-pre-wrap leading-relaxed border border-slate-200 overflow-auto max-h-96">
                      {companyProfileResult.outcome}
                    </div>
                  </div>
                )}
              </div>

              {/* Card 3: 增量与变现智能体 */}
              <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">增量与变现智能体</span>
                        <Badge variant="purple" size="sm">L4 落地指引</Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        透视客户营收分层、已购产品交叉矩阵与临期合同，挖掘沉睡唤醒、交叉销售与续约机会。
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-center"
                    isLoading={growthRunning}
                    disabled={growthRunning}
                    onClick={handleRunGrowth}
                  >
                    <span>运行增量变现 (L4)</span>
                  </Button>
                </div>

                {growthResult && (
                  <div className="space-y-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono">
                        执行轮数: {growthResult.rounds} 轮
                      </span>
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono">
                        调取工具: {growthResult.toolsUsed.join(", ") || "无"}
                      </span>
                    </div>
                    <div className="bg-slate-50/80 rounded-xl p-4 text-xs text-slate-800 font-sans whitespace-pre-wrap leading-relaxed border border-slate-200 overflow-auto max-h-96">
                      {growthResult.outcome}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Card 3: 晨会副驾驶 · 采纳率与闭环看板 (L1 销售赋能) */}
            <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">晨会副驾驶 · 采纳率看板</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-semibold border border-purple-200">
                      L1 销售赋能 · 价值闭环
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    三维赋能之销售维度落地成效：统计每日 AI 推送建议被一线销售实际采纳、执行与忽略的闭环数据（采纳率是自治阶梯的货币）。
                  </p>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    disabled={loadingAdoption}
                    onClick={() => handleSwitchAdoptionDays(7)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                      adoptionDays === 7 ? "bg-white text-indigo-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    近 7 天
                  </button>
                  <button
                    type="button"
                    disabled={loadingAdoption}
                    onClick={() => handleSwitchAdoptionDays(30)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                      adoptionDays === 30 ? "bg-white text-indigo-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    近 30 天
                  </button>
                </div>
              </div>

              {adoptionStats ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                  <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100">
                    <span className="text-[11px] text-slate-500 font-medium">生成建议总数</span>
                    <p className="text-lg font-bold text-slate-900 mt-1 font-mono">{adoptionStats.totalGenerated}</p>
                    <span className="text-[10px] text-slate-400">晨会巡检触达</span>
                  </div>
                  <div className="bg-emerald-50/50 rounded-xl p-3 border border-emerald-100">
                    <span className="text-[11px] text-emerald-700 font-medium">销售采纳数</span>
                    <p className="text-lg font-bold text-emerald-800 mt-1 font-mono">{adoptionStats.appliedCount}</p>
                    <span className="text-[10px] text-slate-950">已转化为推进动作</span>
                  </div>
                  <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100">
                    <span className="text-[11px] text-slate-500 font-medium">忽略 / 不适用</span>
                    <p className="text-lg font-bold text-slate-700 mt-1 font-mono">{adoptionStats.dismissedCount}</p>
                    <span className="text-[10px] text-slate-400">回流飞轮调优</span>
                  </div>
                  <div className="bg-indigo-50/60 rounded-xl p-3 border border-indigo-100">
                    <span className="text-[11px] text-indigo-700 font-medium">综合采纳率</span>
                    <p className="text-lg font-bold text-indigo-800 mt-1 font-mono">{adoptionStats.adoptionRate}%</p>
                    <span className="text-[10px] text-slate-950">
                      {adoptionStats.adoptionRate >= 30 ? "已达 L1 解锁线 (≥30%)" : "目标解锁线 ≥30%"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 rounded-xl p-4 text-center text-xs text-slate-500">
                  暂无采纳率统计数据
                </div>
              )}
            </div>
          </>
        )}

        {/* Card 4: 历史认知报告归档与回溯 (Historical Reports - L2/L3) */}
        <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-sm">认知报告历史归档 (Historical Reports)</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                  L2-L3 月报与快照
                </span>
                {currentUserRole === "SALES" && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold border border-amber-200">
                    金额已脱敏
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                按月自动归档与手动触发的认知报告，支持按类型（销冠解构/企业画像）与周期回溯查阅。
              </p>
            </div>

            {/* 筛选控制器 */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedReportKind("ALL")}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                    selectedReportKind === "ALL" ? "bg-white text-indigo-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  全部类型
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedReportKind("CHAMPION_ANALYSIS")}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                    selectedReportKind === "CHAMPION_ANALYSIS" ? "bg-white text-indigo-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  销冠解构 (L2)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedReportKind("COMPANY_PROFILE")}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                    selectedReportKind === "COMPANY_PROFILE" ? "bg-white text-indigo-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  企业画像 (L3)
                </button>
              </div>

              {/* 周期筛选下拉 */}
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-indigo-600 focus:outline-none"
              >
                <option value="ALL">全部周期</option>
                {Array.from(new Set(insightReports.map((r) => r.period))).sort().reverse().map((period) => (
                  <option key={period} value={period}>
                    {period} 周期
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 报告内容展示 */}
          {(() => {
            const filteredReports = insightReports.filter((r) => {
              if (selectedReportKind !== "ALL" && r.kind !== selectedReportKind) return false;
              if (selectedPeriod !== "ALL" && r.period !== selectedPeriod) return false;
              return true;
            });

            const activeReport =
              filteredReports.find((r) => r.id === selectedReportId) ||
              filteredReports[0] ||
              null;

            if (filteredReports.length === 0) {
              return (
                <div className="bg-slate-50 rounded-xl p-8 text-center text-xs text-slate-500 border border-slate-100">
                  暂无匹配的历史认知报告（可点击上方按钮运行或等待每月 1 日系统自动归档）
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2">
                {/* 左侧列表 */}
                <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                  {filteredReports.map((report) => {
                    const isSelected = activeReport?.id === report.id;
                    return (
                      <div
                        key={report.id}
                        onClick={() => setSelectedReportId(report.id)}
                        className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                          isSelected
                            ? "bg-indigo-50/70 border-indigo-300 shadow-2xs"
                            : "bg-slate-50/60 border-slate-200/80 hover:bg-slate-100/80"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`font-semibold px-2 py-0.5 rounded text-[11px] ${
                              report.kind === "CHAMPION_ANALYSIS"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {report.kind === "CHAMPION_ANALYSIS" ? "销冠解构 (L2)" : "企业画像 (L3)"}
                          </span>
                          <span className="font-mono text-slate-500 text-[11px] font-bold">
                            {report.period}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                          <span>样本量: {report.sampleSize}</span>
                          <span
                            className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                              report.confidence === "HIGH"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : report.confidence === "MEDIUM"
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            置信度: {report.confidence}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 右侧详情 */}
                {activeReport && (
                  <div className="lg:col-span-2 bg-slate-50/90 rounded-xl p-4 border border-slate-200/90 space-y-3">
                    <div className="flex flex-wrap items-center justify-between pb-2 border-b border-slate-200/80 gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-xs">
                          {activeReport.kind === "CHAMPION_ANALYSIS" ? "销冠打法解构报告" : "企业画像与客盘诊断报告"}
                        </span>
                        <span className="font-mono text-indigo-700 text-xs bg-white px-2 py-0.5 rounded border border-indigo-100">
                          {activeReport.period}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-slate-500">样本量: {activeReport.sampleSize}</span>
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                            activeReport.confidence === "HIGH"
                              ? "bg-emerald-100 text-emerald-800"
                              : activeReport.confidence === "MEDIUM"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          置信度: {activeReport.confidence}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-slate-800 font-sans whitespace-pre-wrap leading-relaxed max-h-[380px] overflow-y-auto bg-white p-3.5 rounded-lg border border-slate-100">
                      {activeReport.content}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    )}

    {/* 编辑策略与话术 Modal */}
    {editingPrompt && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
        <div className="w-full max-w-2xl bg-white rounded-xl p-6 shadow-xl border border-slate-200 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="font-bold text-slate-950 text-sm">编辑 AI 打单策略与话术模版</span>
            <button
              type="button"
              onClick={() => setEditingPrompt(null)}
              className="text-slate-400 hover:text-slate-600 text-xs"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSavePrompt} className="space-y-4 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">模版名称</label>
              <input
                type="text"
                value={promptForm.name}
                onChange={(e) => setPromptForm({ ...promptForm, name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">使用场景与用途说明</label>
              <input
                type="text"
                value={promptForm.description}
                onChange={(e) => setPromptForm({ ...promptForm, description: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                给 AI 设定的销售人设与沟通原则 (System Prompt)
              </label>
              <textarea
                rows={4}
                value={promptForm.systemPrompt}
                onChange={(e) => setPromptForm({ ...promptForm, systemPrompt: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none font-mono"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-slate-700">
                  数据提问模版 (可在需要填数据的地方使用 {"{字段名}"})
                </label>
                <span className="text-[10px] text-slate-400 font-mono">
                  可用: {editingPrompt.variables.map(v => `{${v}}`).join(", ")}
                </span>
              </div>
              <textarea
                rows={5}
                value={promptForm.userPromptTemplate}
                onChange={(e) => setPromptForm({ ...promptForm, userPromptTemplate: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none font-mono"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingPrompt(null)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 text-xs shadow-2xs"
              >
                {isPending ? "保存中..." : "保存为新版本"}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
    </div>
  );
}
