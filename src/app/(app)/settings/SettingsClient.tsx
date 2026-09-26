"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createLeadSourceKey, revokeLeadSourceKey } from "@/core/leads/actions";
import type { LeadSourceKeyRow } from "@/core/leads/service";
import { Button, Badge } from "@/components/ui";

type Props = { initialSourceKeys: LeadSourceKeyRow[] };
type CreatedSourceKey = {
  sourceKeyId: string;
  name: string;
  sourceKey: string;
  token: string;
  createdAt: string;
};
type RevokedSourceKey = { sourceKeyId: string; revokedAt: string };

function formatDate(value: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "从未使用";
}

export default function SettingsClient({ initialSourceKeys }: Props) {
  const router = useRouter();
  const [sourceKeys, setSourceKeys] = useState(initialSourceKeys);
  const [form, setForm] = useState({ name: "", sourceKey: "" });
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setError(null);
    setMessage(null);
    setToken(null);
    setCreating(true);
    const result = await createLeadSourceKey(form);
    setCreating(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const created = result.data as CreatedSourceKey;
    setSourceKeys((current) => [
      {
        id: created.sourceKeyId,
        name: created.name,
        sourceKey: created.sourceKey,
        createdAt: created.createdAt,
        lastUsedAt: null,
        revokedAt: null,
      },
      ...current,
    ]);
    setForm({ name: "", sourceKey: "" });
    setToken(created.token);
  }

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setMessage("密钥已复制到剪贴板");
      setError(null);
    } catch {
      setError("无法自动复制，请手动选中并复制密钥");
    }
  }

  async function revoke(sourceKeyId: string) {
    if (!window.confirm("确认撤销此来源密钥？撤销后使用该密钥的第三方系统请求将立即被拒绝。")) return;
    setError(null);
    setMessage(null);
    setRevokingId(sourceKeyId);
    const result = await revokeLeadSourceKey({ sourceKeyId });
    setRevokingId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const revoked = result.data as RevokedSourceKey;
    setSourceKeys((current) =>
      current.map((item) => (item.id === sourceKeyId ? { ...item, revokedAt: revoked.revokedAt } : item))
    );
    setMessage("来源密钥已成功撤销");
    router.refresh();
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="blue" size="sm">
              API 鉴权
            </Badge>
            <h2 className="text-sm font-bold text-slate-950">来源密钥管理 (API Source Keys)</h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            用于外部官网、投放表单、第三方营销中台通过 API（`/api/v1/leads`）安全推送线索
          </p>
        </div>
      </div>

      {message && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800 flex items-center justify-between shadow-2xs">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-emerald-600 hover:text-emerald-800 text-sm">×</button>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-800 flex items-center justify-between shadow-2xs">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800 text-sm">×</button>
        </div>
      )}

      {token && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2 text-xs shadow-2xs">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-amber-950 flex items-center gap-1.5">
              请立即复制并妥善保存此 API 密钥 (Token)
            </h3>
            <button
              type="button"
              className="text-amber-700 hover:text-amber-950 font-medium"
              onClick={() => {
                setToken(null);
                setMessage(null);
              }}
            >
              关闭提示 ×
            </button>
          </div>
          <p className="text-amber-800">
            出于安全原因，关闭此提示后系统将无法再次显示明文密钥。请立即将其配置到第三方请求 Header 中。
          </p>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-amber-200 bg-white p-2.5 font-mono text-xs text-slate-900 break-all select-all">
              {token}
            </code>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={copyToken}
            >
              一键复制
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* 左侧：已有密钥列表 (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="text-xs font-semibold text-slate-700">
            已登记密钥列表 ({sourceKeys.length})
          </div>

          {sourceKeys.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-slate-200 rounded-xl text-xs text-slate-400">
              暂未创建任何来源密钥。请在右侧表单中创建第一个 API 进线密钥。
            </div>
          ) : (
            <div className="space-y-3">
              {sourceKeys.map((item) => (
                <article
                  key={item.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all text-xs space-y-2.5 shadow-2xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-slate-900">{item.name}</h3>
                        <Badge
                          variant={item.revokedAt ? "neutral" : "emerald"}
                          dot
                          size="sm"
                        >
                          {item.revokedAt ? "已撤销失效" : "正常接入中"}
                        </Badge>
                      </div>
                      <div className="text-slate-500 font-mono text-[11px] break-all">
                        标识: <span className="text-slate-800 font-medium">{item.sourceKey}</span>
                      </div>
                    </div>

                    {!item.revokedAt && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="text-rose-700 hover:text-rose-800"
                        disabled={revokingId === item.id}
                        onClick={() => void revoke(item.id)}
                      >
                        {revokingId === item.id ? "撤销中..." : "撤销密钥"}
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 border-t border-slate-100 pt-2 font-mono">
                    <span>创建: {formatDate(item.createdAt)}</span>
                    <span>最近活跃: {formatDate(item.lastUsedAt)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {/* 右侧：新建密钥表单 (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3 text-xs shadow-2xs">
            <h3 className="font-bold text-slate-900">新建来源 API 密钥</h3>
            <p className="text-slate-500 text-[11px]">
              生成专属 Token 供官网或外部渠道调用线索写入接口
            </p>

            <form className="space-y-3" onSubmit={create}>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">渠道名称 *</label>
                <input
                  className="w-full border border-slate-200 rounded-lg p-2 bg-white text-slate-900 focus:outline-hidden focus:border-slate-800"
                  required
                  maxLength={50}
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：2026 官网表单或百度推广"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">来源唯一标识 (Source Key) *</label>
                <input
                  className="w-full border border-slate-200 rounded-lg p-2 bg-white text-slate-900 font-mono focus:outline-hidden focus:border-slate-800"
                  required
                  pattern="[a-z0-9][a-z0-9_\-]{1,48}[a-z0-9]"
                  minLength={3}
                  maxLength={50}
                  value={form.sourceKey}
                  onChange={(event) => setForm((current) => ({ ...current, sourceKey: event.target.value }))}
                  placeholder="例如：official_web_2026"
                />
                <p className="text-[10px] text-slate-400 mt-1 font-mono">
                  需为小写字母、数字及下划线组合
                </p>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="w-full"
                isLoading={creating}
              >
                {creating ? "正在生成密钥..." : "生成 API 鉴权密钥"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
