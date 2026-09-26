"use client";

import { useState, useTransition } from "react";
import {
  executeDirectorySyncAction,
  previewDirectorySyncDiffAction,
  upsertDirectoryConfigAction,
} from "@/core/workplace/actions";
import type {
  DirectorySyncDiffResult,
  DirectorySyncExecutionResult,
  WorkplaceDirectoryConfigItem,
} from "@/core/workplace/directory-sync";
import type { WorkplacePlatform } from "@/core/workplace/types";

const PLATFORMS: Array<{
  key: WorkplacePlatform;
  name: string;
  corpLabel: string;
  secretLabel: string;
  desc: string;
}> = [
  {
    key: "WECOM",
    name: "企业微信通讯录",
    corpLabel: "企业ID (CorpId)",
    secretLabel: "通讯录 Secret (Contacts Secret)",
    desc: "通过企业微信通讯录 API 自动同步企业组织架构、部门树及成员信息",
  },
  {
    key: "DINGTALK",
    name: "钉钉组织通讯录",
    corpLabel: "应用 Key (AppKey)",
    secretLabel: "应用 Secret (AppSecret)",
    desc: "对接钉钉开放平台组织通讯录 API，同步员工花名册与部门层级",
  },
  {
    key: "FEISHU",
    name: "飞书组织架构",
    corpLabel: "应用 ID (AppId)",
    secretLabel: "应用 Secret (AppSecret)",
    desc: "对接飞书开放平台通讯录 API，自动同步员工入职、调岗与部门拓扑",
  },
];

export default function WorkplaceDirectorySyncModal({
  initialConfigs,
  onClose,
  onSyncComplete,
}: {
  initialConfigs: WorkplaceDirectoryConfigItem[];
  onClose: () => void;
  onSyncComplete: () => void;
}) {
  const [activePlatform, setActivePlatform] = useState<WorkplacePlatform>("WECOM");
  const [configs, setConfigs] = useState<WorkplaceDirectoryConfigItem[]>(initialConfigs);
  const [isPending, startTransition] = useTransition();

  // 当前选中平台的配置
  const currentConfig = configs.find((c) => c.platform === activePlatform);
  const [corpId, setCorpId] = useState(currentConfig?.corpId || "");
  const [secret, setSecret] = useState(currentConfig?.secret || "");
  const [syncMode, setSyncMode] = useState<"FULL" | "INCREMENTAL">(
    currentConfig?.syncMode || "INCREMENTAL",
  );
  const [defaultRole, setDefaultRole] = useState<"SALES" | "MANAGER" | "ADMIN">(
    currentConfig?.defaultRole || "SALES",
  );

  // 差异比对弹窗与同步结果状态
  const [diffResult, setDiffResult] = useState<DirectorySyncDiffResult | null>(null);
  const [executionResult, setExecutionResult] =
    useState<DirectorySyncExecutionResult | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const activeMeta = PLATFORMS.find((p) => p.key === activePlatform)!;

  function handlePlatformChange(p: WorkplacePlatform) {
    setActivePlatform(p);
    const cfg = configs.find((c) => c.platform === p);
    setCorpId(cfg?.corpId || "");
    setSecret(cfg?.secret || "");
    setSyncMode(cfg?.syncMode || "INCREMENTAL");
    setDefaultRole(cfg?.defaultRole || "SALES");
    setDiffResult(null);
    setExecutionResult(null);
  }

  function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!corpId.trim() || !secret.trim()) return alert("请填写完整的凭证参数");

    startTransition(async () => {
      const res = await upsertDirectoryConfigAction({
        platform: activePlatform,
        corpId: corpId.trim(),
        secret: secret.trim(),
        syncMode,
        defaultRole,
        isEnabled: true,
      });

      if (res.ok) {
        setConfigs((prev) => {
          const filtered = prev.filter((c) => c.platform !== activePlatform);
          return [...filtered, res.data];
        });
        setFeedback(`【${activeMeta.name}】对接凭证保存成功！`);
        setTimeout(() => setFeedback(null), 3000);
      } else {
        alert(res.message);
      }
    });
  }

  function handlePreviewDiff() {
    startTransition(async () => {
      const res = await previewDirectorySyncDiffAction(activePlatform);
      if (res.ok) {
        setDiffResult(res.data);
        setExecutionResult(null);
      } else {
        alert(res.message);
      }
    });
  }

  function handleConfirmSync() {
    startTransition(async () => {
      const res = await executeDirectorySyncAction(activePlatform);
      if (res.ok) {
        setExecutionResult(res.data);
        setDiffResult(null);
        setFeedback("通讯录同步入库成功！已更新本地部门树与成员花名册");
        onSyncComplete();
      } else {
        alert(res.message);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200/80 space-y-4 max-h-[90vh] flex flex-col">
        {/* 头部标题 */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div>
            <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span>企业通讯录自动化同步中枢</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              对接企业微信、钉钉或飞书开放平台 API，自动拉取并同步部门架构树与员工花名册
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-sm">
            ×
          </button>
        </div>

        {feedback && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg font-medium shadow-2xs shrink-0">
            {feedback}
          </div>
        )}

        {/* 平台选择 Tab */}
        <div className="grid grid-cols-3 gap-2 shrink-0">
          {PLATFORMS.map((p) => {
            const isSelected = activePlatform === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => handlePlatformChange(p.key)}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition text-center ${
                  isSelected
                    ? "bg-blue-50 text-blue-800 border-blue-300 ring-2 ring-blue-600/10 shadow-2xs"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {p.name}
              </button>
            );
          })}
        </div>

        <div className="overflow-y-auto flex-1 space-y-4 pr-1">
          {/* 凭证配置表单 */}
          <form onSubmit={handleSaveConfig} className="space-y-3 bg-slate-50/60 p-4 rounded-xl border border-slate-100 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">{activeMeta.name} API 对接凭证</span>
              {currentConfig?.lastSyncedAt && (
                <span className="text-[11px] text-slate-400 font-mono">
                  上次同步：{new Date(currentConfig.lastSyncedAt).toLocaleString("zh-CN")}
                </span>
              )}
            </div>
            <p className="text-slate-500 text-[11px]">{activeMeta.desc}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{activeMeta.corpLabel} *</label>
                <input
                  type="text"
                  required
                  value={corpId}
                  onChange={(e) => setCorpId(e.target.value)}
                  placeholder={`输入${activeMeta.corpLabel}`}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-900 focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{activeMeta.secretLabel} *</label>
                <input
                  type="password"
                  required
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={`输入${activeMeta.secretLabel}`}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-900 focus:outline-none font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">同步模式</label>
                <select
                  value={syncMode}
                  onChange={(e) => setSyncMode(e.target.value as "INCREMENTAL" | "FULL")}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                >
                  <option value="INCREMENTAL">增量同步 (只追加新部门与新成员)</option>
                  <option value="FULL">全量覆盖 (同步变更与部门调动)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">新同步员工默认角色</label>
                <select
                  value={defaultRole}
                  onChange={(e) => setDefaultRole(e.target.value as "SALES" | "MANAGER")}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                >
                  <option value="SALES">销售专员 (SALES)</option>
                  <option value="MANAGER">业务主管 (MANAGER)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <button
                type="button"
                disabled={isPending || !corpId.trim() || !secret.trim()}
                onClick={handlePreviewDiff}
                className="inline-flex h-8 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-100 shadow-2xs gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>{isPending ? "正在比对..." : "拉取通讯录并预览比对 (Diff Preview)"}</span>
              </button>

              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-1.5 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 shadow-2xs"
              >
                保存凭证
              </button>
            </div>
          </form>

          {/* 比对结果面板 */}
          {diffResult && (
            <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-xs space-y-3 text-xs animate-in fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-bold text-slate-950 text-sm">
                  通讯录比对分析结果 (Diff Preview)
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  远端部门：{diffResult.totalRemoteDepartments} 个 · 远端员工：{diffResult.totalRemoteUsers} 位
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                  <span className="text-slate-500 text-[11px]">待新增部门</span>
                  <p className="text-xl font-bold font-mono text-emerald-700 mt-0.5">
                    {diffResult.departmentsToAdd.length}
                  </p>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <span className="text-slate-500 text-[11px]">待入库新员工</span>
                  <p className="text-xl font-bold font-mono text-blue-700 mt-0.5">
                    {diffResult.usersToAdd.length}
                  </p>
                </div>
              </div>

              {/* 明细列表 */}
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg p-2 bg-slate-50/50">
                {diffResult.departmentsToAdd.map((d) => (
                  <div key={d.id} className="py-1.5 px-2 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-emerald-800">[新部门] {d.name}</span>
                    <span className="text-slate-400">外部ID: {d.id}</span>
                  </div>
                ))}
                {diffResult.usersToAdd.map((u) => (
                  <div key={u.id} className="py-1.5 px-2 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-blue-800">[新员工] {u.name}</span>
                      <span className="text-slate-500 font-mono">({u.mobile})</span>
                    </div>
                    <span className="text-slate-500">{u.title || "销售"}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDiffResult(null)}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleConfirmSync}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 shadow-2xs flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>{isPending ? "正在同步入库..." : "确认同步入库"}</span>
                </button>
              </div>
            </div>
          )}

          {/* 同步成功提示 */}
          {executionResult && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs space-y-2">
              <h4 className="font-bold text-emerald-950 text-sm flex items-center gap-1.5">
                <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>通讯录同步完成！</span>
              </h4>
              <p className="text-emerald-800 text-[11px]">
                本次已自动创建部门 {executionResult.createdDepartmentsCount} 个，新增员工花名册 {executionResult.createdUsersCount} 位，变更同步 {executionResult.updatedUsersCount} 位。
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-slate-100 pt-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
