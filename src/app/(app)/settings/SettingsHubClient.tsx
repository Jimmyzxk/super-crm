"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { LeadSourceKeyRow } from "@/core/leads/service";
import type { ScoreRuleRow } from "@/core/scoring/service";
import type { PublicPoolRuleItem } from "@/core/public-pool/types";
import type { WorkplaceIntegrationItem } from "@/core/workplace/types";
import type { SecurityComplianceConfigItem } from "@/core/security/service";
import type { CustomerCollaborationSettings as CustomerCollaborationSettingsType } from "@/core/collaboration/types";
import SecurityComplianceSettings from "./SecurityComplianceSettings";
import SettingsClient from "./SettingsClient";
import ScoreRulesSettings from "./ScoreRulesSettings";
import PublicPoolRulesSettings from "./PublicPoolRulesSettings";
import CustomerCollaborationSettings from "./CustomerCollaborationSettings";
import WorkplaceSettings from "./WorkplaceSettings";
import { Badge } from "@/components/ui";

export type SettingsDomain = "security" | "rules" | "integrations";
export type RulesSubTab = "pool" | "collaboration" | "scoring";
export type IntegrationsSubTab = "api" | "workplace" | "plugins";

interface Props {
  initialTab?: string;
  sourceKeys: LeadSourceKeyRow[];
  scoreRules: ScoreRuleRow[];
  feedbackStats: { accurate: number; inaccurate: number; total: number };
  publicPoolRules: PublicPoolRuleItem[];
  workplaceIntegrations: WorkplaceIntegrationItem[];
  securityConfig: SecurityComplianceConfigItem;
  collaborationSettings: CustomerCollaborationSettingsType;
  pluginsNode: ReactNode;
}

export default function SettingsHubClient({
  initialTab,
  sourceKeys,
  scoreRules,
  feedbackStats,
  publicPoolRules,
  workplaceIntegrations,
  securityConfig,
  collaborationSettings,
  pluginsNode,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryTab = searchParams.get("tab");
  const querySub = searchParams.get("sub");

  // 解析顶层大类与二级子标签
  const [activeDomain, setActiveDomain] = useState<SettingsDomain>(() => {
    if (queryTab === "rules" || queryTab === "scoring" || queryTab === "pool" || queryTab === "collaboration") return "rules";
    if (queryTab === "integrations" || queryTab === "api" || queryTab === "workplace" || queryTab === "plugins") return "integrations";
    if (queryTab === "security") return "security";
    if (initialTab === "rules" || initialTab === "scoring" || initialTab === "pool" || initialTab === "collaboration") return "rules";
    if (initialTab === "integrations" || initialTab === "api" || initialTab === "workplace" || initialTab === "plugins") return "integrations";
    return "security";
  });

  const [rulesSubTab, setRulesSubTab] = useState<RulesSubTab>(() => {
    if (querySub === "collaboration" || queryTab === "collaboration") return "collaboration";
    if (querySub === "scoring" || queryTab === "scoring") return "scoring";
    return "pool";
  });

  const [integrationsSubTab, setIntegrationsSubTab] = useState<IntegrationsSubTab>(() => {
    if (querySub === "workplace" || queryTab === "workplace") return "workplace";
    if (querySub === "plugins" || queryTab === "plugins") return "plugins";
    return "api";
  });

  // 监听 URL Query 参数变化，确保外部跳转与侧边栏深度链接可直接激活对应 Tab。
  // 采用 React 官方「render 期调整 state」模式（guard + 上次 query 快照），
  // 替代 effect 内同步 setState 的级联渲染写法
  const [prevQuery, setPrevQuery] = useState({ tab: queryTab, sub: querySub });
  if (prevQuery.tab !== queryTab || prevQuery.sub !== querySub) {
    setPrevQuery({ tab: queryTab, sub: querySub });
    if (queryTab === "rules" || queryTab === "scoring" || queryTab === "pool" || queryTab === "collaboration") {
      setActiveDomain("rules");
      if (querySub === "collaboration" || queryTab === "collaboration") setRulesSubTab("collaboration");
      else if (querySub === "scoring" || queryTab === "scoring") setRulesSubTab("scoring");
      else setRulesSubTab("pool");
    } else if (queryTab === "integrations" || queryTab === "api" || queryTab === "workplace" || queryTab === "plugins") {
      setActiveDomain("integrations");
      if (querySub === "workplace" || queryTab === "workplace") setIntegrationsSubTab("workplace");
      else if (querySub === "plugins" || queryTab === "plugins") setIntegrationsSubTab("plugins");
      else setIntegrationsSubTab("api");
    } else if (queryTab === "security") {
      setActiveDomain("security");
    }
  }

  const handleDomainChange = (domain: SettingsDomain) => {
    setActiveDomain(domain);
    const sub = domain === "rules" ? rulesSubTab : domain === "integrations" ? integrationsSubTab : undefined;
    const nextUrl = sub ? `/settings?tab=${domain}&sub=${sub}` : `/settings?tab=${domain}`;
    router.replace(nextUrl as Parameters<typeof router.replace>[0], { scroll: false });
  };

  const handleRulesSubChange = (sub: RulesSubTab) => {
    setRulesSubTab(sub);
    router.replace(`/settings?tab=rules&sub=${sub}` as Parameters<typeof router.replace>[0], { scroll: false });
  };

  const handleIntegrationsSubChange = (sub: IntegrationsSubTab) => {
    setIntegrationsSubTab(sub);
    router.replace(`/settings?tab=integrations&sub=${sub}` as Parameters<typeof router.replace>[0], { scroll: false });
  };

  return (
    <div className="space-y-6">
      {/* 1. 顶部 Header 与 3 大聚合领域 Tab */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="blue" size="sm">
              系统治理
            </Badge>
            <h1 className="text-xl font-bold text-slate-950 tracking-tight">
              系统配置
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            统一维护企业数据安全策略、公海流转规则、客户协同与防撞单、AI 智能评分引擎、开放接口与扩展应用生态
          </p>
        </div>

        {/* 顶层 3 大业务领域切换 */}
        <div className="flex items-center gap-1.5 bg-slate-100/90 p-1 rounded-lg border border-slate-200/70 shadow-2xs shrink-0">
          <button
            type="button"
            onClick={() => handleDomainChange("security")}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeDomain === "security"
                ? "bg-white text-slate-950 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            安全与合规
          </button>
          <button
            type="button"
            onClick={() => handleDomainChange("rules")}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeDomain === "rules"
                ? "bg-white text-slate-950 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            业务规则
          </button>
          <button
            type="button"
            onClick={() => handleDomainChange("integrations")}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeDomain === "integrations"
                ? "bg-white text-slate-950 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            开放与集成
          </button>
        </div>
      </div>

      {/* 2. 领域 A：安全与合规 */}
      {activeDomain === "security" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <SecurityComplianceSettings initialConfig={securityConfig} />
        </div>
      )}

      {/* 3. 领域 B：业务规则（公海流转 + 客户协同与防撞单 + 智能评分） */}
      {activeDomain === "rules" && (
        <div className="space-y-5 animate-in fade-in duration-150">
          {/* 二级聚合子标签 */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleRulesSubChange("pool")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  rulesSubTab === "pool"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                公海流转策略 ({publicPoolRules.length})
              </button>
              <button
                type="button"
                onClick={() => handleRulesSubChange("collaboration")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  rulesSubTab === "collaboration"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                客户协同与防撞单
              </button>
              <button
                type="button"
                onClick={() => handleRulesSubChange("scoring")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  rulesSubTab === "scoring"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                智能评分引擎 ({scoreRules.length})
              </button>
            </div>
            <span className="text-xs text-slate-400">
              {rulesSubTab === "pool"
                ? "配置私海未跟进/未转化超时自动释放与容量保护机制"
                : rulesSubTab === "collaboration"
                ? "配置允许多销售协同跟进与跨业务线商机产品防撞单排他规则"
                : "定义线索与客户多维分值权重，量化潜客价值与成单倾向"}
            </span>
          </div>

          {rulesSubTab === "pool" && (
            <PublicPoolRulesSettings initialRules={publicPoolRules} />
          )}

          {rulesSubTab === "collaboration" && (
            <CustomerCollaborationSettings initialSettings={collaborationSettings} />
          )}

          {rulesSubTab === "scoring" && (
            <ScoreRulesSettings initialRules={scoreRules} feedbackStats={feedbackStats} />
          )}
        </div>
      )}

      {/* 4. 领域 C：开放与集成（API 凭证 + 办公协同 + 扩展插件） */}
      {activeDomain === "integrations" && (
        <div className="space-y-5 animate-in fade-in duration-150">
          {/* 二级聚合子标签 */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleIntegrationsSubChange("api")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  integrationsSubTab === "api"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                API 接入凭证 ({sourceKeys.length})
              </button>
              <button
                type="button"
                onClick={() => handleIntegrationsSubChange("workplace")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  integrationsSubTab === "workplace"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                办公协同机器人 ({workplaceIntegrations.length})
              </button>
              <button
                type="button"
                onClick={() => handleIntegrationsSubChange("plugins")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  integrationsSubTab === "plugins"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                扩展应用生态
              </button>
            </div>
            <span className="text-xs text-slate-400">
              {integrationsSubTab === "api"
                ? "管理全渠道外部进线 API 鉴权密钥与调用凭证"
                : integrationsSubTab === "workplace"
                ? "配置企业微信、钉钉与飞书群消息推送与协同机器人"
                : "统一治理获客表单、企业知识库等扩展业务插件"}
            </span>
          </div>

          {integrationsSubTab === "api" && (
            <SettingsClient initialSourceKeys={sourceKeys} />
          )}

          {integrationsSubTab === "workplace" && (
            <WorkplaceSettings initialIntegrations={workplaceIntegrations} />
          )}

          {integrationsSubTab === "plugins" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
                {pluginsNode}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
