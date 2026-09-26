"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/core/auth/types";
import { createSalesPlaybookDraft, publishSalesPlaybook } from "@/core/playbook/actions";
import type {
  CustomerSize,
  PlaybookTargetStage,
  ReviewedWinSample,
  SalesPlaybook,
} from "@/core/playbook/types";
import { Button, Badge, EmptyState } from "@/components/ui";
import { localDateValue } from "@/core/shared/date";

interface Props {
  role: Role;
  initialPlaybooks: SalesPlaybook[];
  initialSamples: ReviewedWinSample[];
}

const STAGE_CONFIG: Record<PlaybookTargetStage, { label: string; variant: "blue" | "purple" | "amber" }> = {
  DISCOVERY: { label: "需求发现阶段", variant: "blue" },
  PROPOSAL: { label: "方案报价阶段", variant: "purple" },
  NEGOTIATION: { label: "商务谈判阶段", variant: "amber" },
};

function splitText(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function PlaybooksClient({ role, initialPlaybooks, initialSamples }: Props) {
  const router = useRouter();
  const canManage = role === "MANAGER" || role === "ADMIN";

  const [selectedStage, setSelectedStage] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  // 弹窗与详情状态
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailPlaybook, setDetailPlaybook] = useState<SalesPlaybook | null>(null);
  const [publishModalId, setPublishModalId] = useState<string | null>(null);
  const [publishReason, setPublishReason] = useState("");

  // 创建表单
  const [form, setForm] = useState({
    name: "",
    familyKey: "",
    targetStage: "DISCOVERY" as PlaybookTargetStage,
    industries: "智能制造, 企服IT",
    excludedIndustries: "",
    regions: "华东, 华南, 华北",
    excludedRegions: "",
    customerSizes: "21-100, 101-500",
    excludedCustomerSizes: "",
    checkpoints: "1. 明确客户数字化转型的分期预算与直接决策人\n2. 摸底现有旧系统的技术架构与核心痛点\n3. 确认本次采购的关键排期与立项时间节点",
    cadence: "• 首日：电话初筛与需求问卷发送\n• 第3天：技术架构师电话会议沟通\n• 第7天：产出定制化业务方案初稿并预约现场汇报",
    actions: "• 优先约见技术评估人与业务部门一把手\n• 提供同行业标杆客户上线收益测算对比表\n• 输出针对痛点的产品功能架构拓扑图",
    risks: "• 警惕客户仅让普通经办人对接，未触达最终决策链\n• 竞品可能采取低价倾销策略扰乱预算\n• 交付范围未在前期收敛导致后期实施拖期",
    sampleIds: [] as string[],
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const filteredPlaybooks = initialPlaybooks.filter((p) => {
    if (selectedStage !== "ALL" && p.targetStage !== selectedStage) return false;
    if (selectedStatus !== "ALL" && p.status !== selectedStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchKey = p.familyKey.toLowerCase().includes(q);
      const matchInd = p.applicableIndustries.some((ind) => ind.toLowerCase().includes(q));
      if (!matchName && !matchKey && !matchInd) return false;
    }
    return true;
  });

  const publishedCount = initialPlaybooks.filter((p) => p.status === "PUBLISHED").length;
  const draftCount = initialPlaybooks.filter((p) => p.status === "DRAFT").length;
  const samplesCount = initialSamples.length;

  const handleOpenCreate = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setForm((prev) => ({
      ...prev,
      name: "",
      familyKey: `pb-${Date.now().toString().slice(-4)}`,
      sampleIds: initialSamples.slice(0, 3).map((s) => s.id),
    }));
    setCreateModalOpen(true);
  };

  const handleCreateDraft = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!form.name.trim()) {
      setErrorMessage("请填写打法名称");
      return;
    }
    if (!form.familyKey.trim()) {
      setErrorMessage("请填写打法标识 Key");
      return;
    }
    if (form.sampleIds.length < 3) {
      setErrorMessage(`创建打法至少需要勾选 3 个已审核赢单样本`);
      return;
    }

    startTransition(async () => {
      const res = await createSalesPlaybookDraft({
        name: form.name.trim(),
        familyKey: form.familyKey.trim().toLowerCase(),
        targetStage: form.targetStage,
        applicableIndustries: splitText(form.industries),
        excludedIndustries: splitText(form.excludedIndustries),
        applicableRegions: splitText(form.regions),
        excludedRegions: splitText(form.excludedRegions),
        applicableCustomerSizes: splitText(form.customerSizes) as CustomerSize[],
        excludedCustomerSizes: splitText(form.excludedCustomerSizes) as CustomerSize[],
        checkpoints: splitText(form.checkpoints),
        recommendedCadence: splitText(form.cadence),
        effectiveActions: splitText(form.actions),
        commonRisks: splitText(form.risks),
        sampleIds: form.sampleIds,
        claimEvidence: {
          checkpoints: form.sampleIds,
          recommendedCadence: form.sampleIds,
          effectiveActions: form.sampleIds,
          commonRisks: form.sampleIds,
        },
      });

      if (!res.ok) {
        setErrorMessage(res.message || "创建打法草稿失败");
        return;
      }

      setSuccessMessage("成功创建打法草稿！主管可进一步审核后正式发布上线。");
      setCreateModalOpen(false);
      router.refresh();
    });
  };

  const handlePublish = (playbookId: string) => {
    if (!publishReason.trim()) {
      alert("请填写发布审核理由与经验概述");
      return;
    }

    startTransition(async () => {
      const res = await publishSalesPlaybook({
        playbookId,
        reason: publishReason.trim(),
      });

      if (!res.ok) {
        alert(res.message || "发布失败");
        return;
      }

      setPublishModalId(null);
      setPublishReason("");
      setSuccessMessage("打法已正式发布！在商机推进中将向匹配客户智能推荐赋能。");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {/* 顶部标题与说明 */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              智能分析
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-950">销售策略</h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 font-mono">
              {initialPlaybooks.length} 套策略
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 max-w-2xl leading-relaxed">
            由实战结案赢单样本提炼沉淀的标准化销售策略与作战 SOP。当销售跟进商机时，系统会根据客户行业与阶段自动推荐最契合的策略动作与风控避坑指南。
          </p>
        </div>

        {canManage && (
          <Button
            variant="primary"
            size="md"
            onClick={handleOpenCreate}
            leftIcon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          >
            从赢单样本沉淀新策略
          </Button>
        )}
      </header>

      {/* 统计指标卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="text-xs text-slate-500">已发布在用打法</div>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">{publishedCount} <span className="text-xs font-normal text-slate-400">套</span></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="text-xs text-slate-500">待审核草稿箱</div>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">{draftCount} <span className="text-xs font-normal text-slate-400">个</span></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="text-xs text-slate-500">已审核赢单样本</div>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">{samplesCount} <span className="text-xs font-normal text-slate-400">例</span></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="text-xs text-slate-500">版本管理保障</div>
          <div className="text-xl font-bold text-slate-900 mt-1 font-mono">100% <span className="text-xs font-normal text-emerald-600">不可篡改</span></div>
        </div>
      </div>

      {/* 提示消息 */}
      {successMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex justify-between items-center">
          <span>{successMessage}</span>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-600 font-bold hover:underline">关闭</button>
        </div>
      )}

      {/* 筛选过滤栏 */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400 font-medium mr-1">阶段:</span>
          {[
            { key: "ALL", label: "全部阶段" },
            { key: "DISCOVERY", label: "需求发现" },
            { key: "PROPOSAL", label: "方案报价" },
            { key: "NEGOTIATION", label: "商务谈判" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSelectedStage(tab.key)}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                selectedStage === tab.key
                  ? "bg-slate-900 text-white font-semibold shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}

          <span className="text-slate-400 font-medium ml-3 mr-1">状态:</span>
          {[
            { key: "ALL", label: "全部状态" },
            { key: "PUBLISHED", label: "已发布" },
            { key: "DRAFT", label: "草稿" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSelectedStatus(tab.key)}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                selectedStatus === tab.key
                  ? "bg-slate-900 text-white font-semibold shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <input
            type="text"
            placeholder="搜索打法名称、行业或标识..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:border-slate-900 focus:outline-none shadow-2xs"
          />
        </div>
      </div>

      {/* 打法卡片列表 */}
      {filteredPlaybooks.length === 0 ? (
        <EmptyState
          title="暂无符合条件的销售打法"
          description="可通过结案赢单复盘沉淀标准打法，赋能全团队复制销冠经验"
        />
      ) : (
        <div className="space-y-4">
          {filteredPlaybooks.map((playbook) => {
            const stageCfg = STAGE_CONFIG[playbook.targetStage] || { label: playbook.targetStage, variant: "blue" as const };
            return (
              <div
                key={playbook.id}
                className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs hover:border-slate-300 transition space-y-4"
              >
                {/* 头部：标题与阶段 */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    <Badge variant={stageCfg.variant} size="sm">
                      {stageCfg.label}
                    </Badge>
                    <h2 className="text-sm font-bold text-slate-900">{playbook.name}</h2>
                    <span className="font-mono text-xs text-slate-400">v{playbook.version}.0</span>
                    <Badge
                      variant={playbook.status === "PUBLISHED" ? "emerald" : "neutral"}
                      dot
                      size="sm"
                    >
                      {playbook.status === "PUBLISHED" ? "已发布在用" : "草稿待审"}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => setDetailPlaybook(playbook)}
                    >
                      查看完整打法与样本 ({playbook.sampleIds.length})
                    </Button>
                    {canManage && playbook.status === "DRAFT" && (
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={() => { setPublishModalId(playbook.id); setPublishReason(""); }}
                      >
                        审核并发布上线
                      </Button>
                    )}
                  </div>
                </div>

                {/* 适用范围标签 */}
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 bg-slate-50 p-2.5 rounded-lg">
                  <div>
                    <span className="text-slate-400">适用行业：</span>
                    <strong className="text-slate-700">{playbook.applicableIndustries.join("、") || "不限行业"}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">适用地区：</span>
                    <strong className="text-slate-700">{playbook.applicableRegions.join("、") || "不限地区"}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">客户规模：</span>
                    <strong className="text-slate-700">{playbook.applicableCustomerSizes.join("、") || "不限规模"}</strong>
                  </div>
                  <div className="ml-auto text-[11px] text-slate-400">
                    创建人: {playbook.createdByName} {playbook.publishedAt ? `· 发布于 ${localDateValue(playbook.publishedAt)}` : ""}
                  </div>
                </div>

                {/* 打法核心动作与避坑（简明展示） */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 space-y-1.5">
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0"></span> 关键有效动作
                    </div>
                    <ul className="space-y-1 text-slate-600">
                      {playbook.effectiveActions.slice(0, 3).map((act, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="text-slate-400">•</span>
                          <span>{act}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 space-y-1.5">
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <span className="text-amber-600 font-bold">!</span> 常见失误与避坑指南
                    </div>
                    <ul className="space-y-1 text-slate-600">
                      {playbook.commonRisks.slice(0, 3).map((risk, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="text-slate-400">•</span>
                          <span>{risk}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 打法详情模态窗 */}
      {detailPlaybook && (
        <ModalWrapper title={`销售打法详情: ${detailPlaybook.name}`} onClose={() => setDetailPlaybook(null)}>
          <div className="space-y-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-500">打法标识 Key:</span>
              <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">{detailPlaybook.familyKey}</span>
              <span className="font-semibold text-slate-500 ml-2">版本:</span>
              <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">v{detailPlaybook.version}.0</span>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div><span className="text-slate-400">适用行业：</span>{detailPlaybook.applicableIndustries.join("、") || "不限"}</div>
              <div><span className="text-slate-400">适用地区：</span>{detailPlaybook.applicableRegions.join("、") || "不限"}</div>
              <div><span className="text-slate-400">客户规模：</span>{detailPlaybook.applicableCustomerSizes.join("、") || "不限"}</div>
              <div><span className="text-slate-400">排除行业：</span>{detailPlaybook.excludedIndustries.join("、") || "无"}</div>
            </div>

            <div className="space-y-3">
              <div>
                <h4 className="font-bold text-slate-800 mb-1">核心检查点 (Checkpoints)</h4>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 whitespace-pre-line text-slate-700">
                  {detailPlaybook.checkpoints.join("\n")}
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 mb-1">推进节奏建议 (Recommended Cadence)</h4>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 whitespace-pre-line text-slate-700">
                  {detailPlaybook.recommendedCadence.join("\n")}
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 mb-1">关键有效动作 (Effective Actions)</h4>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 whitespace-pre-line text-slate-700">
                  {detailPlaybook.effectiveActions.join("\n")}
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 mb-1">常见失误与风险防范 (Common Risks)</h4>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 whitespace-pre-line text-slate-700">
                  {detailPlaybook.commonRisks.join("\n")}
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 mb-1">支撑赢单样本 ({detailPlaybook.sampleIds.length} 个)</h4>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 space-y-1">
                  {detailPlaybook.sampleIds.map((id, idx) => (
                    <div key={id} className="text-slate-600">
                      样本 #{idx + 1}: <span className="font-mono text-slate-500">{id}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setDetailPlaybook(null)}
                className="px-4 py-1.5 bg-slate-900 text-white rounded-lg font-semibold"
              >
                关闭
              </button>
            </div>
          </div>
        </ModalWrapper>
      )}

      {/* 创建打法草稿模态窗 */}
      {createModalOpen && (
        <ModalWrapper title="从结案赢单样本沉淀销售打法" onClose={() => setCreateModalOpen(false)}>
          <form onSubmit={handleCreateDraft} className="space-y-4 text-xs">
            {errorMessage && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg">
                {errorMessage}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">打法名称 *</label>
                <input
                  required
                  placeholder="如: 智能制造大客户初访推进打法"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg p-2 bg-slate-50"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">目标商机阶段 *</label>
                <select
                  value={form.targetStage}
                  onChange={(e) => setForm({ ...form, targetStage: e.target.value as PlaybookTargetStage })}
                  className="w-full border border-slate-200 rounded-lg p-2 bg-slate-50"
                >
                  <option value="DISCOVERY">需求发现阶段 (DISCOVERY)</option>
                  <option value="PROPOSAL">方案报价阶段 (PROPOSAL)</option>
                  <option value="NEGOTIATION">商务谈判阶段 (NEGOTIATION)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">打法标识 Key *</label>
                <input
                  required
                  placeholder="如: mfg-discovery"
                  value={form.familyKey}
                  onChange={(e) => setForm({ ...form, familyKey: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg p-2 bg-slate-50 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">适用行业 (逗号分隔)</label>
                <input
                  value={form.industries}
                  onChange={(e) => setForm({ ...form, industries: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg p-2 bg-slate-50"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-1">关键有效动作 (每行一项) *</label>
              <textarea
                rows={2}
                required
                value={form.actions}
                onChange={(e) => setForm({ ...form, actions: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 bg-slate-50"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">常见失误与风险指南 (每行一项) *</label>
              <textarea
                rows={2}
                required
                value={form.risks}
                onChange={(e) => setForm({ ...form, risks: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 bg-slate-50"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">核心检查点 (Checkpoints)</label>
              <textarea
                rows={2}
                value={form.checkpoints}
                onChange={(e) => setForm({ ...form, checkpoints: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 bg-slate-50"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">推进节奏建议 (Recommended Cadence)</label>
              <textarea
                rows={2}
                value={form.cadence}
                onChange={(e) => setForm({ ...form, cadence: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 bg-slate-50"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">
                选择支撑事实赢单案例 (至少 3 例，已选 {form.sampleIds.length} 例) *
              </label>
              <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50 space-y-1.5">
                {initialSamples.length === 0 ? (
                  <p className="text-slate-400">暂无已审核赢单案例，请先完成结案复盘审核</p>
                ) : (
                  initialSamples.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-100 p-1 rounded">
                      <input
                        type="checkbox"
                        checked={form.sampleIds.includes(s.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setForm({ ...form, sampleIds: [...form.sampleIds, s.id] });
                          } else {
                            setForm({ ...form, sampleIds: form.sampleIds.filter((id) => id !== s.id) });
                          }
                        }}
                      />
                      <span><strong>{s.opportunityName}</strong> ({s.customerIndustry || "通用行业"} · {s.customerRegion || "通用地区"})</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-1.5 bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-800"
              >
                {isPending ? "保存中..." : "创建打法草稿"}
              </button>
            </div>
          </form>
        </ModalWrapper>
      )}

      {/* 审核发布模态窗 */}
      {publishModalId && (
        <ModalWrapper title="审核并正式发布销售打法" onClose={() => setPublishModalId(null)}>
          <div className="space-y-3 text-xs">
            <p className="text-slate-600 leading-relaxed">
              发布后，该打法将进入生产环境打法库，在销售推进对应阶段和行业的商机时，系统将智能向其推送标准有效动作。
            </p>
            <div>
              <label className="block font-semibold mb-1">审核意见与发布说明 *</label>
              <textarea
                rows={3}
                required
                placeholder="说明打法适用场景与实战复盘验证情况..."
                value={publishReason}
                onChange={(e) => setPublishReason(e.target.value)}
                className="w-full border border-slate-200 rounded-lg p-2 bg-slate-50"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setPublishModalId(null)}
                className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={() => handlePublish(publishModalId)}
                disabled={isPending}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
              >
                {isPending ? "发布中..." : "确认发布上线"}
              </button>
            </div>
          </div>
        </ModalWrapper>
      )}
    </div>
  );
}

function ModalWrapper({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
