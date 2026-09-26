"use client";

import { useState, useTransition } from "react";
import {
  createWorkplaceIntegrationAction,
  deleteWorkplaceIntegrationAction,
  listWorkplaceIntegrationsAction,
  testWorkplaceIntegrationAction,
} from "@/core/workplace/actions";
import type {
  CreateWorkplaceIntegrationInput,
  WorkplaceEventType,
  WorkplaceIntegrationItem,
  WorkplacePlatform,
} from "@/core/workplace/types";

const PLATFORM_CONFIG: Record<
  WorkplacePlatform,
  { label: string; bg: string; text: string; border: string; iconBg: string }
> = {
  WECOM: {
    label: "企业微信群机器人",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    iconBg: "bg-blue-600",
  },
  DINGTALK: {
    label: "钉钉自定义机器人",
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    border: "border-indigo-200",
    iconBg: "bg-indigo-600",
  },
  FEISHU: {
    label: "飞书自定义机器人",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    iconBg: "bg-emerald-600",
  },
  GENERIC_WEBHOOK: {
    label: "通用 HTTP Webhook (HMAC 签名)",
    bg: "bg-purple-50",
    text: "text-purple-700",
    border: "border-purple-200",
    iconBg: "bg-purple-600",
  },
};

const AVAILABLE_EVENTS: Array<{ key: WorkplaceEventType; label: string; desc: string }> = [
  { key: "DEAL_WON", label: "赢单结案喜报", desc: "当一线销售成功签约结案时，自动向群内播发全员战报喜讯" },
  { key: "ORDER_CONFIRMED", label: "销售订单生效", desc: "销售订单审核确认生效时触发推送" },
  { key: "CONTRACT_SIGNED", label: "合同盖章签署", desc: "合同双方法定签署与电子印章存证完成时触发" },
  { key: "PAYMENT_RECEIVED", label: "回款入账到账", desc: "财务录入分期款项或结清打款时实时推送" },
  { key: "PROJECT_DELIVERED", label: "项目交付初验", desc: "实施团队完成里程碑节点验收交付时通报" },
  { key: "LEAD_ROUTED", label: "智能线索分流", desc: "外部新线索经过规则引擎自动分流认领时通知" },
  { key: "INTERVENTION_REQUESTED", label: "战情室协同求援", desc: "销售呼叫高层陪访或底价特批时，实时同步给群内主管" },
  { key: "OPPORTUNITY_CREATED", label: "重点商机立项", desc: "线索转化产生新商机时，第一时间通报立项动态" },
  { key: "LEAD_COLLISION_ALERT", label: "撞单冲突预警", desc: "检测到多渠道线索手机/企业撞单风险时，预警给业务团队" },
  { key: "PUBLIC_POOL_RECYCLED", label: "公海自动回收播报", desc: "超期停滞私海潜客被释放回公海池时，向团队通报流转" },
  { key: "AI_INSPECTION_ALERT", label: "AI 晨会巡检预警", desc: "每日 08:30 AI 智能巡检发现停滞商机与合同应收风险时汇总通报" },
];

export default function WorkplaceSettings({
  initialIntegrations,
}: {
  initialIntegrations: WorkplaceIntegrationItem[];
}) {
  const [integrations, setIntegrations] =
    useState<WorkplaceIntegrationItem[]>(initialIntegrations);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  // 新建弹窗状态
  const [showAddModal, setShowAddModal] = useState(false);
  const [newForm, setNewForm] = useState<CreateWorkplaceIntegrationInput>({
    platform: "WECOM",
    name: "",
    webhookUrl: "",
    events: ["DEAL_WON", "INTERVENTION_REQUESTED", "OPPORTUNITY_CREATED"],
  });

  function reloadIntegrations() {
    startTransition(async () => {
      const res = await listWorkplaceIntegrationsAction();
      if (res.ok) setIntegrations(res.data);
    });
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newForm.name.trim()) return alert("请输入机器人名称");
    if (!newForm.webhookUrl.trim()) return alert("请输入 Webhook 地址");

    startTransition(async () => {
      const res = await createWorkplaceIntegrationAction(newForm);
      if (res.ok) {
        setShowAddModal(false);
        setNewForm({
          platform: "WECOM",
          name: "",
          webhookUrl: "",
          events: ["DEAL_WON", "INTERVENTION_REQUESTED", "OPPORTUNITY_CREATED"],
        });
        setFeedback("群机器人添加成功");
        reloadIntegrations();
        setTimeout(() => setFeedback(null), 3000);
      } else {
        alert(res.message);
      }
    });
  }

  function handleTest(id: string) {
    startTransition(async () => {
      const res = await testWorkplaceIntegrationAction(id);
      if (res.ok) {
        alert(res.data.message || "测试消息发送成功");
      } else {
        alert(res.message || "测试消息发送失败");
      }
    });
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`确认删除机器人【${name}】吗？`)) return;
    startTransition(async () => {
      const res = await deleteWorkplaceIntegrationAction(id);
      if (res.ok) {
        setIntegrations((prev) => prev.filter((i) => i.id !== id));
        setFeedback("机器人集成已删除");
        setTimeout(() => setFeedback(null), 3000);
      } else {
        alert(res.message);
      }
    });
  }

  function toggleEvent(key: WorkplaceEventType) {
    setNewForm((prev) => {
      const exists = prev.events.includes(key);
      return {
        ...prev,
        events: exists ? prev.events.filter((e) => e !== key) : [...prev.events, key],
      };
    });
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      {/* 头部控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
              通讯协同
            </span>
            <h2 className="text-sm font-bold text-slate-950">
              企业通讯生态连接器 (Workplace Connectors: 企微 / 钉钉 / 飞书)
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            无缝对接企业微信群、钉钉群与飞书群，在关键战报签约、战情室协同与商机立项时自动播送高质感卡片
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex h-8 items-center justify-center rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white hover:bg-slate-800 shadow-2xs gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span>添加群机器人</span>
        </button>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg font-medium shadow-2xs">
          {feedback}
        </div>
      )}

      {/* 机器人列表 */}
      <div className="space-y-3">
        {integrations.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
            暂未配置企业通讯机器人，点击右上角「添加群机器人」接入企微、钉钉或飞书
          </div>
        ) : (
          integrations.map((item) => {
            const pCfg = PLATFORM_CONFIG[item.platform] || PLATFORM_CONFIG.WECOM;

            return (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4 text-xs"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${pCfg.bg} ${pCfg.text} border ${pCfg.border} shrink-0`}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{item.name}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${pCfg.bg} ${pCfg.text} ${pCfg.border}`}>
                        {pCfg.label}
                      </span>
                    </div>

                    <p className="font-mono text-slate-400 text-[11px] truncate max-w-md">
                      Webhook: {item.webhookUrl.slice(0, 32)}...{item.webhookUrl.slice(-8)}
                    </p>

                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                      <span className="text-slate-400 text-[10px]">订阅事件：</span>
                      {item.events.map((evt) => {
                        const evtMeta = AVAILABLE_EVENTS.find((e) => e.key === evt);
                        return (
                          <span
                            key={evt}
                            className="rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-medium text-slate-700"
                          >
                            {evtMeta?.label || evt}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleTest(item.id)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs flex items-center gap-1"
                  >
                    <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>连通性测试</span>
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleDelete(item.id, item.name)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                    title="删除该机器人配置"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 新建群机器人弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl border border-slate-200/80 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-950">添加企业通讯群机器人</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">选择平台类型 *</label>
                <div className="grid grid-cols-4 gap-2">
                  {(["WECOM", "DINGTALK", "FEISHU", "GENERIC_WEBHOOK"] as WorkplacePlatform[]).map((p) => {
                    const isSelected = newForm.platform === p;
                    const pCfg = PLATFORM_CONFIG[p];

                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setNewForm({ ...newForm, platform: p })}
                        className={`p-2.5 rounded-xl border text-center font-semibold transition ${
                          isSelected
                            ? `${pCfg.bg} ${pCfg.text} ${pCfg.border} ring-2 ring-blue-600/20 shadow-2xs`
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {p === "WECOM" ? "企微群" : p === "DINGTALK" ? "钉钉群" : p === "FEISHU" ? "飞书群" : "HTTP Hook"}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">机器人 / Webhook 名称 *</label>
                <input
                  type="text"
                  required
                  value={newForm.name}
                  onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                  placeholder="例如：销售部战报群机器人 或 企业出网 Webhook 引擎"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Webhook 地址 *</label>
                <input
                  type="url"
                  required
                  value={newForm.webhookUrl}
                  onChange={(e) => setNewForm({ ...newForm, webhookUrl: e.target.value })}
                  placeholder="https://qyapi.weixin.qq.com/... 或 https://api.yourcompany.com/webhook"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none font-mono"
                />
              </div>

              {newForm.platform === "GENERIC_WEBHOOK" && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">HMAC 签名密钥 (Secret Key，可选)</label>
                  <input
                    type="password"
                    value={newForm.secretKey || ""}
                    onChange={(e) => setNewForm({ ...newForm, secretKey: e.target.value })}
                    placeholder="用于生成 X-CRM-Signature (HMAC-SHA256) 请求头校验"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">留空则不签名，填写后将在每次 HTTP 请求附加 SHA-256 防篡改签名</p>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1.5">订阅触发事件</label>
                <div className="space-y-2 border border-slate-100 rounded-xl p-3 bg-slate-50/50">
                  {AVAILABLE_EVENTS.map((evt) => {
                    const isChecked = newForm.events.includes(evt.key);
                    return (
                      <label key={evt.key} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleEvent(evt.key)}
                          className="rounded border-slate-300 text-blue-600 mt-0.5"
                        />
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-900 block">{evt.label}</span>
                          <span className="text-slate-500 text-[11px] block">{evt.desc}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-1.5 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isPending ? "保存中..." : "确认添加"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
