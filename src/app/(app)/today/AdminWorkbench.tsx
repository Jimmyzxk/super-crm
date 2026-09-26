import Link from "next/link";
import { formatBoundedCount } from "@/core/shared/display";
import type { AdminWorkbench as AdminWorkbenchData } from "@/core/workbench/types";

export default function AdminWorkbench({ data }: { data: AdminWorkbenchData }) {
  return (
    <div className="space-y-6">
      {/* 1. 核心指标速览卡 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">已启用来源密钥</span>
            <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded">API接入</span>
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5 font-mono">
            {formatBoundedCount(data.sourceKeys.enabled, data.countCeiling)}{" "}
            <span className="text-xs font-normal text-slate-400">/ {formatBoundedCount(data.sourceKeys.total, data.countCeiling)} 总数</span>
          </div>
          <div className="mt-2 text-[11px] text-blue-600">
            <Link href="/settings" className="hover:underline font-semibold">前往配置密钥 →</Link>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">已启用评分规则</span>
            <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded">引擎状态</span>
          </div>
          <div className="text-2xl font-bold text-purple-700 mt-1.5 font-mono">
            {formatBoundedCount(data.scoreRules.enabled, data.countCeiling)}{" "}
            <span className="text-xs font-normal text-slate-400">/ {formatBoundedCount(data.scoreRules.total, data.countCeiling)} 条规则</span>
          </div>
          <div className="mt-2 text-[11px] text-purple-600">
            <Link href="/settings#score-rules" className="hover:underline font-semibold">配置评分引擎 →</Link>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">待分配销售线索</span>
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded">公海待分</span>
          </div>
          <div className="text-2xl font-bold text-amber-600 mt-1.5 font-mono">
            {formatBoundedCount(data.unassignedLeads, data.countCeiling)}{" "}
            <span className="text-xs font-normal text-slate-400">条待指派</span>
          </div>
          <div className="mt-2 text-[11px] text-amber-700">
            <Link href="/leads?filter=unassigned" className="hover:underline font-semibold">进入线索分配池 →</Link>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">疑似重复线索</span>
            <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded">撞单风险</span>
          </div>
          <div className="text-2xl font-bold text-rose-600 mt-1.5 font-mono">
            {formatBoundedCount(data.duplicateLeads, data.countCeiling)}{" "}
            <span className="text-xs font-normal text-slate-400">条风险</span>
          </div>
          <div className="mt-2 text-[11px] text-rose-600">
            <Link href="/leads?filter=duplicate" className="hover:underline font-semibold">排查重复线索 →</Link>
          </div>
        </div>
      </div>

      {/* 2. 详细治理监控看板 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 租户接入与算法配置卡 */}
        <section aria-labelledby="governance-heading" className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 id="governance-heading" className="text-sm font-bold text-slate-950">租户接入与评分治理</h2>
              <p className="mt-0.5 text-xs text-slate-500">全局 API 接入凭证与 AI 规则引擎实时运行状态</p>
            </div>
            <Link href="/settings" className="text-xs font-semibold text-blue-600 hover:text-blue-700">
              管理配置 →
            </Link>
          </div>

          <div className="divide-y divide-slate-100">
            <RatioLink label="API 渠道来源密钥 (Source Keys)" enabled={data.sourceKeys.enabled} total={data.sourceKeys.total} ceiling={data.countCeiling} href="/settings" />
            <RatioLink label="AI 自动化评分规则引擎 (Score Rules)" enabled={data.scoreRules.enabled} total={data.scoreRules.total} ceiling={data.countCeiling} href="/settings#score-rules" />
          </div>
        </section>

        {/* 数据质量与系统健康度 */}
        <section aria-labelledby="data-quality-heading" className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 id="data-quality-heading" className="text-sm font-bold text-slate-950">线索数据质量与健康度</h2>
              <p className="mt-0.5 text-xs text-slate-500">数据冲突预警与后台任务刷新健康指标</p>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              系统正常
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            <MetricLink href="/leads?filter=duplicate" label="疑似碰撞重复线索" value={data.duplicateLeads} ceiling={data.countCeiling} />
            <MetricLink href="/leads?filter=unassigned" label="公海/待分配新进线索" value={data.unassignedLeads} ceiling={data.countCeiling} />
            <div className="flex items-center justify-between gap-4 py-3 px-1">
              <div>
                <p className="text-xs font-medium text-slate-800">洞察分析健康状态</p>
                <p className="mt-0.5 text-[11px] text-slate-400">后台定时洞察聚合服务信号</p>
              </div>
              <strong className="text-sm font-bold font-mono text-slate-900">
                {data.insightRefreshFailures === 0 ? (
                  <span className="text-emerald-600 font-sans text-xs">● 0 失败 正常</span>
                ) : (
                  <span className="text-rose-600 font-sans text-xs">● {data.insightRefreshFailures} 次失败</span>
                )}
              </strong>
            </div>
          </div>
        </section>
      </div>

      {/* 3. 常用管理入口快捷 8 宫格 */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-3">
        <h3 className="text-xs font-bold text-slate-900">管理员常用业务快捷直达</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs">
          <Link
            href="/settings"
            className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:border-blue-300 hover:bg-white hover:shadow-xs transition-all block"
          >
            <div className="font-bold text-slate-900">系统配置中枢</div>
            <div className="text-slate-400 text-[11px] mt-0.5">密钥与评分规则引擎</div>
          </Link>
          <Link
            href="/leads"
            className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:border-blue-300 hover:bg-white hover:shadow-xs transition-all block"
          >
            <div className="font-bold text-slate-900">销售线索管理池</div>
            <div className="text-slate-400 text-[11px] mt-0.5">智能指派与流转</div>
          </Link>
          <Link
            href="/analytics"
            className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:border-blue-300 hover:bg-white hover:shadow-xs transition-all block"
          >
            <div className="font-bold text-slate-900">经营与业绩分析</div>
            <div className="text-slate-400 text-[11px] mt-0.5">漏斗与销售速率</div>
          </Link>
        </div>
      </div>
    </div>
  );
}

function RatioLink({
  label,
  enabled,
  total,
  ceiling,
  href,
}: {
  label: string;
  enabled: number;
  total: number;
  ceiling: number;
  href: string;
}) {
  return (
    <Link href={href as never} className="group flex items-center justify-between gap-4 py-3 hover:bg-slate-50/70 transition px-2 rounded-xl">
      <span className="text-xs font-medium text-slate-800">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-xs font-mono text-slate-600 font-medium">
          <strong className="text-base text-slate-950 font-bold">{formatBoundedCount(enabled, ceiling)}</strong> / {formatBoundedCount(total, ceiling)} 启用
        </span>
        <span aria-hidden="true" className="text-slate-400 text-xs group-hover:text-slate-800">→</span>
      </span>
    </Link>
  );
}

function MetricLink({ href, label, value, ceiling }: { href: string; label: string; value: number; ceiling: number }) {
  return (
    <Link href={href as never} className="group flex items-center justify-between gap-4 py-3 hover:bg-slate-50/70 transition px-2 rounded-xl">
      <span className="text-xs font-medium text-slate-800">{label}</span>
      <span className="flex items-center gap-2">
        <strong className="text-base font-bold font-mono text-slate-950">{formatBoundedCount(value, ceiling)}</strong>
        <span aria-hidden="true" className="text-slate-400 text-xs group-hover:text-slate-800">→</span>
      </span>
    </Link>
  );
}
