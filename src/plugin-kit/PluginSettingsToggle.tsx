"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { togglePluginAction } from "./actions";

interface PluginSettingsToggleProps {
  pluginKey: string;
  initialEnabled: boolean;
  consolePath: string;
  consoleLabel?: string;
}

export default function PluginSettingsToggle({
  pluginKey,
  initialEnabled,
  consolePath,
  consoleLabel = "打开管理控制台",
}: PluginSettingsToggleProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (pending) return;
    setPending(true);
    setError("");
    const result = await togglePluginAction({ pluginKey, enabled: !enabled });
    setPending(false);
    if (!result.ok) {
      setError(result.message || "操作失败，请稍后重试");
      return;
    }
    setEnabled(result.data?.enabled ?? !enabled);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
      <button
        type="button"
        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-2xs disabled:opacity-50 transition-colors cursor-pointer"
        disabled={pending}
        onClick={() => void toggle()}
      >
        {pending ? "处理中..." : enabled ? "停用插件" : "启用插件"}
      </button>

      <Link
        className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white shadow-xs transition-colors"
        href={consolePath as Parameters<typeof Link>[0]["href"]}
      >
        <span>{consoleLabel}</span>
        <span>→</span>
      </Link>

      {error && (
        <p role="alert" className="w-full text-xs text-red-600 bg-red-50 p-2 rounded-lg border border-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
