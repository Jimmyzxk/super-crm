"use client";

import { useState, useTransition } from "react";
import {
  listPublicPoolRulesAction,
  runPublicPoolRecycleScanAction,
  upsertPublicPoolRuleAction,
} from "@/core/public-pool/actions";
import type {
  PublicPoolRecycleScanResult,
  PublicPoolRuleItem,
  PublicPoolRuleType,
} from "@/core/public-pool/types";

const RULE_TITLES: Record<PublicPoolRuleType, { title: string; desc: string; defaultDays: number }> = {
  LEAD_UNTOUCHED: {
    title: "私海线索未跟进自动回收",
    desc: "销售领入私海后超过指定天数无新增有效跟进纪要，自动释放回公共线索池",
    defaultDays: 7,
  },
  LEAD_UNCONVERTED: {
    title: "私海线索长期未立项转化回收",
    desc: "线索转入私海后超过指定天数仍未转化为正式客户/商机，自动释放回公海池",
    defaultDays: 30,
  },
  CUSTOMER_INACTIVE: {
    title: "沉睡客户长期无活跃沟通回收",
    desc: "已签约/跟进客户超过指定天数无任何商务活动记录，自动释放回公海客户池",
    defaultDays: 60,
  },
};

export default function PublicPoolRulesSettings({
  initialRules,
}: {
  initialRules: PublicPoolRuleItem[];
}) {
  const [rules, setRules] = useState<PublicPoolRuleItem[]>(initialRules);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  // 扫描结果弹窗
  const [scanResult, setScanResult] = useState<PublicPoolRecycleScanResult | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);

  function reloadRules() {
    startTransition(async () => {
      const res = await listPublicPoolRulesAction();
      if (res.ok) setRules(res.data);
    });
  }

  function handleSaveRule(rule: PublicPoolRuleItem) {
    startTransition(async () => {
      const res = await upsertPublicPoolRuleAction({
        ruleType: rule.ruleType,
        thresholdDays: rule.thresholdDays,
        protectWindowDays: rule.protectWindowDays,
        notifyBeforeHours: rule.notifyBeforeHours,
        isEnabled: rule.isEnabled,
      });
      if (res.ok) {
        setFeedback(`规则【${RULE_TITLES[rule.ruleType].title}】保存成功`);
        reloadRules();
        setTimeout(() => setFeedback(null), 3000);
      } else {
        alert(res.message);
      }
    });
  }

  function handleRunScan(dryRun: boolean) {
    startTransition(async () => {
      const res = await runPublicPoolRecycleScanAction({ dryRun });
      if (res.ok) {
        setScanResult(res.data);
        setShowScanModal(true);
        if (!dryRun) {
          setFeedback(`公海自动回收执行完毕：释放线索 ${res.data.recycledLeadsCount} 条，客户 ${res.data.recycledCustomersCount} 个`);
        }
      } else {
        alert(res.message);
      }
    });
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      {/* 标题与控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              资产流转
            </span>
            <h2 className="text-sm font-bold text-slate-950">
              公海池自动流转与防囤单回收规则引擎 (Public Pool Rules)
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            规范销售私海持客时效，对未首响、超期停滞与沉睡潜客自动释放回公海池，盘活企业潜客资产
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => handleRunScan(true)}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs gap-1.5"
          >
            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>{isPending ? "扫描中..." : "模拟试运行扫描 (Dry Run)"}</span>
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (confirm("确认立即执行公海回收吗？满足超期规则的潜客将释放回公海池。")) {
                handleRunScan(false);
              }
            }}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-amber-600 px-3.5 text-xs font-semibold text-white hover:bg-amber-700 shadow-2xs gap-1.5"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>立即执行回收</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg font-medium shadow-2xs">
          {feedback}
        </div>
      )}

      {/* 规则卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {rules.map((rule) => {
          const meta = RULE_TITLES[rule.ruleType] || {
            title: rule.ruleType,
            desc: "公海自动回收流转规则",
          };

          return (
            <div
              key={rule.ruleType}
              className={`rounded-xl border p-4 text-xs space-y-3 transition ${
                rule.isEnabled
                  ? "border-slate-200 bg-white shadow-2xs"
                  : "border-slate-200/60 bg-slate-50/70 text-slate-400"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-sm">{meta.title}</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rule.isEnabled}
                    onChange={(e) => {
                      const updated = { ...rule, isEnabled: e.target.checked };
                      setRules((prev) =>
                        prev.map((r) => (r.ruleType === rule.ruleType ? updated : r)),
                      );
                      handleSaveRule(updated);
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-amber-600" />
                </label>
              </div>

              <p className="text-slate-500 text-[11px] leading-relaxed min-h-[32px]">{meta.desc}</p>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-medium">回收阈值天数</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="1"
                      max="365"
                      disabled={!rule.isEnabled || isPending}
                      value={rule.thresholdDays}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 1;
                        setRules((prev) =>
                          prev.map((r) =>
                            r.ruleType === rule.ruleType ? { ...r, thresholdDays: val } : r,
                          ),
                        );
                      }}
                      className="w-16 rounded border border-slate-200 px-2 py-1 text-center font-mono font-bold text-slate-900 focus:border-slate-900 focus:outline-none text-xs"
                    />
                    <span className="text-slate-500 text-[11px]">天</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-medium">免回收保护期</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="90"
                      disabled={!rule.isEnabled || isPending}
                      value={rule.protectWindowDays}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 0;
                        setRules((prev) =>
                          prev.map((r) =>
                            r.ruleType === rule.ruleType ? { ...r, protectWindowDays: val } : r,
                          ),
                        );
                      }}
                      className="w-16 rounded border border-slate-200 px-2 py-1 text-center font-mono font-bold text-slate-900 focus:border-slate-900 focus:outline-none text-xs"
                    />
                    <span className="text-slate-500 text-[11px]">天</span>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    disabled={!rule.isEnabled || isPending}
                    onClick={() => handleSaveRule(rule)}
                    className="px-3 py-1 bg-slate-900 text-white rounded text-xs font-semibold hover:bg-slate-800 disabled:opacity-30 shadow-2xs"
                  >
                    保存规则
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 扫描预览结果弹窗 */}
      {showScanModal && scanResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl border border-slate-200/80 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div>
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <span>公海自动回收扫描结果</span>
                  <span
                    className={`rounded-full px-2 py-0.2 text-[10px] font-bold ${
                      scanResult.dryRun
                        ? "bg-blue-100 text-blue-800"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {scanResult.dryRun ? "模拟试运行 (Dry Run)" : "实际已执行回收"}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  扫描时间：{new Date(scanResult.scannedAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <button
                onClick={() => setShowScanModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm"
              >
                ×
              </button>
            </div>

            {/* 统计指标行 */}
            <div className="grid grid-cols-3 gap-3 shrink-0">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                <span className="text-[11px] text-slate-500">待回收线索</span>
                <p className="text-xl font-bold font-mono text-amber-600 mt-0.5">
                  {scanResult.totalEligibleLeads}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                <span className="text-[11px] text-slate-500">待回收沉睡客户</span>
                <p className="text-xl font-bold font-mono text-purple-600 mt-0.5">
                  {scanResult.totalEligibleCustomers}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                <span className="text-[11px] text-slate-500">保护期豁免中</span>
                <p className="text-xl font-bold font-mono text-emerald-600 mt-0.5">
                  {scanResult.totalProtectedItems}
                </p>
              </div>
            </div>

            {/* 待回收明细列表 */}
            <div className="overflow-y-auto flex-1 border border-slate-100 rounded-xl divide-y divide-slate-100 text-xs">
              {scanResult.previewItems.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  当前无超期停滞或沉睡潜客，私海流转健康度极高
                </div>
              ) : (
                scanResult.previewItems.map((item) => (
                  <div key={item.id} className="p-3 flex items-start justify-between gap-3 hover:bg-slate-50/60 transition">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                            item.entityType === "LEAD"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-purple-100 text-purple-800"
                          }`}
                        >
                          {item.entityType === "LEAD" ? "线索" : "客户"}
                        </span>
                        <span className="font-bold text-slate-900">{item.name}</span>
                        <span className="text-slate-500 text-[11px]">负责人：{item.ownerName}</span>
                        {item.isProtected && (
                          <span className="rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.2 text-[10px] font-bold">
                            免回收保护期内
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-600">{item.reason}</p>
                    </div>
                    <span className="shrink-0 font-mono text-slate-500 text-[11px] whitespace-nowrap">
                      停滞 {item.daysSinceLastTouch} 天
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-end border-t border-slate-100 pt-3 shrink-0">
              <button
                type="button"
                onClick={() => setShowScanModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
