"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { upsertSecurityComplianceConfigAction } from "@/core/security/actions";
import type { SecurityComplianceConfigItem } from "@/core/security/service";

export default function SecurityComplianceSettings({
  initialConfig,
}: {
  initialConfig: SecurityComplianceConfigItem;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<SecurityComplianceConfigItem>(initialConfig);

  const [isPhoneMaskingEnabled, setIsPhoneMaskingEnabled] = useState(
    config.isPhoneMaskingEnabled ?? false,
  );
  const [isEmailMaskingEnabled, setIsEmailMaskingEnabled] = useState(
    config.isEmailMaskingEnabled ?? false,
  );
  const [exportRequiresApproval, setExportRequiresApproval] = useState(
    config.exportRequiresApproval ?? false,
  );
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(
    config.sessionTimeoutMinutes ?? 120,
  );
  const [watermarkEnabled] = useState(config.watermarkEnabled ?? true);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    startTransition(async () => {
      const res = await upsertSecurityComplianceConfigAction({
        isPhoneMaskingEnabled,
        isEmailMaskingEnabled,
        exportRequiresApproval,
        sessionTimeoutMinutes,
        watermarkEnabled,
      });

      if (res.ok) {
        setConfig(res.data);
        setFeedback("企业数据安全与等保合规策略已保存生效！");
        router.refresh();
        setTimeout(() => setFeedback(null), 3000);
      } else {
        setErrorMessage(res.message);
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  }

  return (
    <div className="space-y-5 text-xs">
      {/* 1. 统一 AI 智能体中心快捷跳转引导卡片 */}
      <div className="rounded-2xl border border-indigo-200/80 bg-gradient-to-r from-indigo-50/70 to-blue-50/70 p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-2xs shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <span>AI 智能体与打单策略中枢</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                config.isAiCopilotEnabled ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"
              }`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${config.isAiCopilotEnabled ? "bg-emerald-500" : "bg-slate-400"}`} />
                {config.isAiCopilotEnabled ? "已启用" : "未开启"}
              </span>
            </h3>
            <p className="text-[11px] text-slate-600 mt-1">
              大模型接入配置（DeepSeek/OpenAI/智谱/通义）、提示词策略池、商机客观质检与自学习知识库已统一升级至独立模块
            </p>
          </div>
        </div>

        <Link
          href="/ai-hub"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition shadow-2xs shrink-0 text-xs"
        >
          <span>打开 AI 智能体中心</span>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </Link>
      </div>

      {/* 2. 企业数据安全与等保合规中枢 */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white shadow-2xs">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-950">
                企业数据安全与三级等保合规管控 (Security Compliance)
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                管控全员敏感客户联系方式动态脱敏、防泄密审计存证、会话超时锁定与导出审批流
              </p>
            </div>
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

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 手机号脱敏 */}
            <div className="rounded-xl border border-slate-200/80 p-4 bg-slate-50/50 space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="phone-masking-toggle" className="font-bold text-slate-900 cursor-pointer">
                  客户电话动态掩码脱敏 (138****1234)
                </label>
                <input
                  id="phone-masking-toggle"
                  type="checkbox"
                  checked={isPhoneMaskingEnabled}
                  onChange={(e) => setIsPhoneMaskingEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                启用后，列表及表单默认隐藏手机号中间4位。销售点击【查看】将强制触发安全审计日志留痕存证。
              </p>
            </div>

            {/* 邮箱脱敏 */}
            <div className="rounded-xl border border-slate-200/80 p-4 bg-slate-50/50 space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="email-masking-toggle" className="font-bold text-slate-900 cursor-pointer">
                  企业邮箱动态掩码脱敏 (zh***n@corp.com)
                </label>
                <input
                  id="email-masking-toggle"
                  type="checkbox"
                  checked={isEmailMaskingEnabled}
                  onChange={(e) => setIsEmailMaskingEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                对客户及线索联系人电子邮箱进行前缀动态脱敏，防止全量邮箱地址被批量截屏或复制。
              </p>
            </div>

            {/* 会话超时锁定 */}
            <div className="rounded-xl border border-slate-200/80 p-4 bg-slate-50/50 space-y-2">
              <label htmlFor="session-timeout" className="font-bold text-slate-900 block">
                系统空闲自动注销时长 (分钟)
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="session-timeout"
                  type="number"
                  min="15"
                  max="1440"
                  value={sessionTimeoutMinutes}
                  onChange={(e) => setSessionTimeoutMinutes(parseInt(e.target.value) || 120)}
                  className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 font-mono focus:border-blue-600 focus:outline-none"
                />
                <span className="text-slate-500 text-[11px]">
                  (推荐 120 分钟，范围 15~1440 分钟)
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                员工离席超时未操作时自动锁定会话，杜绝工位未锁屏导致的数据泄露风险。
              </p>
            </div>

            {/* 批量导出二次审批 */}
            <div className="rounded-xl border border-slate-200/80 p-4 bg-slate-50/50 space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="export-approval-toggle" className="font-bold text-slate-900 cursor-pointer">
                  批量数据导出需主管审批
                </label>
                <input
                  id="export-approval-toggle"
                  type="checkbox"
                  checked={exportRequiresApproval}
                  onChange={(e) => setExportRequiresApproval(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                开启后，销售专员导出客户或商机清单时，需提交导出理由并经主管/管理员审批后方可下载。
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end pt-3 border-t border-slate-100">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-8 items-center justify-center rounded-xl bg-slate-900 px-5 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 transition disabled:opacity-50"
            >
              {isPending ? "保存中..." : "保存安全策略"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
