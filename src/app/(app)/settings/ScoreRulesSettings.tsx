"use client";

import { FormEvent, useState } from "react";
import { createScoreRule, deleteScoreRule, reorderScoreRules, updateScoreRule } from "@/core/scoring/actions";
import type { ScoreRuleInput, ScoreRuleRow } from "@/core/scoring/service";
import type { ScoreField, ScoreOperator } from "@/core/scoring/rules";

type Props = {
  initialRules: ScoreRuleRow[];
  feedbackStats: { accurate: number; inaccurate: number; total: number };
};

const fields: Array<[ScoreField, string]> = [
  ["company_name", "公司名称 (线索/客户)"],
  ["contact_email", "电子邮箱 (联系人)"],
  ["title", "职位头衔 (联系人)"],
  ["source", "渠道来源 (线索)"],
  ["created_hour", "进线时段 (0-23)"],
  ["activity_count", "累计跟进次数 (互动)"],
  ["last_activity_outcome", "最近跟进结果 (互动)"],
  ["customer_size", "企业规模 (客户画像: 1-20/21-100/101-500/1000+)"],
  ["customer_industry", "所属行业 (客户画像)"],
  ["customer_region", "所在地区 (客户画像)"],
  ["days_since_activity", "未跟进天数 (活跃度时效)"],
  ["won_deal_count", "历史赢单成交笔数 (老客履约)"],
  ["active_deal_count", "当前活跃商机数 (推进中)"],
];
const operators: Array<[ScoreOperator, string]> = [
  ["EXISTS", "已填写/存在"],
  ["NOT_EXISTS", "未填写/不存在"],
  ["EQUALS", "精确等于"],
  ["CONTAINS", "包含关键词"],
  ["STARTS_WITH", "开头匹配"],
  ["GT", "数值大于 (>)"],
  ["GTE", "数值大于等于 (>=)"],
  ["IN", "属于枚举集合 (逗号分隔)"],
];
const emptyRule: ScoreRuleInput = { label: "", field: "company_name", operator: "EXISTS", value: null, weight: 10, enabled: true };

function formFrom(rule: ScoreRuleRow): ScoreRuleInput {
  return { label: rule.label, field: rule.field, operator: rule.operator, value: rule.value, weight: rule.weight, enabled: rule.enabled };
}

function fieldLabel(value: ScoreField) { return fields.find(([field]) => field === value)?.[1] ?? value; }
function operatorLabel(value: ScoreOperator) { return operators.find(([operator]) => operator === value)?.[1] ?? value; }

export default function ScoreRulesSettings({ initialRules, feedbackStats }: Props) {
  const [rules, setRules] = useState(initialRules);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<ScoreRuleInput>(emptyRule);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inaccurateRate = feedbackStats.total ? Math.round((feedbackStats.inaccurate / feedbackStats.total) * 100) : 0;

  function openNew() { setDraft(emptyRule); setEditingId("new"); setError(null); setMessage(null); }
  function openEdit(rule: ScoreRuleRow) { setDraft(formFrom(rule)); setEditingId(rule.id); setError(null); setMessage(null); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId || pending) return;
    setPending(true); setError(null); setMessage(null);
    const result = editingId === "new" ? await createScoreRule(draft) : await updateScoreRule({ ruleId: editingId, ...draft });
    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    const saved = result.data as ScoreRuleRow;
    setRules((current) => editingId === "new" ? [...current, saved] : current.map((rule) => rule.id === saved.id ? saved : rule));
    setEditingId(null); setMessage(editingId === "new" ? "评分规则已成功创建" : "评分规则已成功更新");
  }

  async function toggle(rule: ScoreRuleRow) {
    if (pending) return;
    setPending(true); setError(null); setMessage(null);
    const result = await updateScoreRule({ ruleId: rule.id, ...formFrom(rule), enabled: !rule.enabled });
    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    const saved = result.data as ScoreRuleRow;
    setRules((current) => current.map((item) => item.id === saved.id ? saved : item));
    setMessage(saved.enabled ? "评分规则已启用" : "评分规则已停用");
  }

  async function disable(rule: ScoreRuleRow) {
    if (!rule.enabled || pending || !window.confirm(`确认停用“${rule.label}”？历史分数不会变化。`)) return;
    setPending(true); setError(null); setMessage(null);
    const result = await deleteScoreRule({ ruleId: rule.id });
    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    setRules((current) => current.filter((item) => item.id !== rule.id));
    setMessage("评分规则已停用，历史分数保持不变");
  }

  async function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= rules.length || pending) return;
    const reordered = [...rules];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setPending(true); setError(null); setMessage(null);
    const result = await reorderScoreRules({ ruleIds: reordered.map((rule) => rule.id) });
    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    setRules(result.data as ScoreRuleRow[]);
    setMessage("评分规则优先级已更新");
  }

  return (
    <section id="score-rules" aria-labelledby="score-rules-heading" className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
              算法引擎
            </span>
            <h2 id="score-rules-heading" className="text-sm font-bold text-slate-950">
              AI 自动化评分规则引擎 (Lead & Customer Scoring)
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            自定义线索完整度、企业画像资质、跟进时效与成交履约等多维度打分规则，实时计算潜客意向分 (0-100)
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white shadow-xs transition-colors cursor-pointer"
          onClick={openNew}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span>新建评分规则</span>
        </button>
      </div>

      {/* 算法准确度反馈卡 */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
        <div className="flex items-center gap-2 text-slate-700">
          <span className="font-semibold">最近 30 天销售反馈准确度：</span>
          <span className="text-emerald-700 font-bold">准 {feedbackStats.accurate} 条</span>
          <span className="text-slate-300">|</span>
          <span className="text-red-700 font-bold">不准 {feedbackStats.inaccurate} 条</span>
          <span className="text-slate-400 font-mono">(累计 {feedbackStats.total} 条反馈)</span>
        </div>
        <div className="text-xs text-slate-500 font-mono">
          模型预测偏差率: <span className="font-bold text-slate-800">{inaccurateRate}%</span>
        </div>
      </div>

      {message && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800 flex items-center justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-emerald-600 hover:text-emerald-800 text-sm">×</button>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800 text-sm">×</button>
        </div>
      )}

      {editingId && (
        <RuleForm
          draft={draft}
          pending={pending}
          title={editingId === "new" ? "新建自动化评分规则" : "编辑评分规则"}
          onChange={setDraft}
          onCancel={() => setEditingId(null)}
          onSubmit={save}
        />
      )}

      <div className="divide-y divide-slate-100">
        {rules.map((rule, index) => (
          <article key={rule.id} className="grid gap-3 py-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center text-xs">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                    rule.enabled
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-slate-100 text-slate-500 border-slate-200"
                  }`}
                >
                  {rule.enabled ? "已启用" : "已停用"}
                </span>
                <h3 className="font-bold text-slate-900">{rule.label}</h3>
                <span
                  className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                    rule.weight >= 0
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  }`}
                >
                  {rule.weight >= 0 ? "+" : ""}{rule.weight} 分
                </span>
              </div>
              <p className="text-slate-500">
                {fieldLabel(rule.field)} · {operatorLabel(rule.operator)}
                {rule.value ? ` · 阈值/枚举: ${rule.value}` : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 transition-colors"
                disabled={pending || index === 0}
                onClick={() => void move(index, -1)}
                title="提升计算优先级"
              >
                ↑ 上移
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 transition-colors"
                disabled={pending || index === rules.length - 1}
                onClick={() => void move(index, 1)}
                title="降低计算优先级"
              >
                ↓ 下移
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 transition-colors"
                disabled={pending}
                onClick={() => void toggle(rule)}
              >
                {rule.enabled ? "停用" : "启用"}
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 transition-colors"
                disabled={pending}
                onClick={() => openEdit(rule)}
              >
                编辑
              </button>
              {rule.enabled && (
                <button
                  type="button"
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 hover:border-red-200 border border-transparent disabled:opacity-40 transition-colors"
                  disabled={pending}
                  onClick={() => void disable(rule)}
                >
                  删除
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RuleForm({
  draft,
  pending,
  title,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: ScoreRuleInput;
  pending: boolean;
  title: string;
  onChange: (value: ScoreRuleInput) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const noValue = draft.operator === "EXISTS" || draft.operator === "NOT_EXISTS";
  function set<K extends keyof ScoreRuleInput>(key: K, value: ScoreRuleInput[K]) {
    onChange({ ...draft, [key]: value });
  }

  return (
    <form className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-3.5" onSubmit={onSubmit}>
      <h3 className="font-bold text-slate-900">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">规则名称文案 *</label>
          <input
            className="w-full border border-slate-200 rounded-lg p-2 bg-white text-slate-900 focus:outline-hidden focus:border-slate-800"
            required
            maxLength={30}
            value={draft.label}
            onChange={(event) => set("label", event.target.value)}
            placeholder="例如：企业规模100人以上"
          />
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">判定字段 *</label>
          <select
            className="w-full border border-slate-200 rounded-lg p-2 bg-white text-slate-900 focus:outline-hidden focus:border-slate-800"
            value={draft.field}
            onChange={(event) => set("field", event.target.value as ScoreField)}
          >
            {fields.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">判定方式 *</label>
          <select
            className="w-full border border-slate-200 rounded-lg p-2 bg-white text-slate-900 focus:outline-hidden focus:border-slate-800"
            value={draft.operator}
            onChange={(event) => {
              const next = event.target.value as ScoreOperator;
              onChange({
                ...draft,
                operator: next,
                value: next === "EXISTS" || next === "NOT_EXISTS" ? null : draft.value ?? "",
              });
            }}
          >
            {operators.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {!noValue && (
          <div>
            <label className="block font-semibold text-slate-700 mb-1">比较值 *</label>
            <input
              className="w-full border border-slate-200 rounded-lg p-2 bg-white text-slate-900 focus:outline-hidden focus:border-slate-800"
              required
              maxLength={200}
              value={draft.value ?? ""}
              onChange={(event) => set("value", event.target.value)}
              placeholder="输入判定阈值或枚举值"
            />
          </div>
        )}

        <div>
          <label className="block font-semibold text-slate-700 mb-1">加减分值 (-100 到 100) *</label>
          <input
            className="w-full border border-slate-200 rounded-lg p-2 bg-white text-slate-900 font-mono focus:outline-hidden focus:border-slate-800"
            type="number"
            required
            min={-100}
            max={100}
            step={1}
            value={draft.weight}
            onChange={(event) => set("weight", Number(event.target.value))}
          />
        </div>

        <div className="flex items-center pt-5">
          <label className="flex items-center gap-2 text-slate-800 font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => set("enabled", event.target.checked)}
              className="rounded text-slate-900 focus:ring-slate-900"
            />
            保存后立即在规则矩阵中启用
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
        <button
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold shadow-xs disabled:opacity-50 transition-colors"
          disabled={pending}
        >
          {pending ? "正在保存..." : "保存规则"}
        </button>
        <button
          type="button"
          className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg font-semibold transition-colors"
          disabled={pending}
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </form>
  );
}
