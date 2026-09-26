"use client";

import { useState, useTransition } from "react";
import { updateCustomerCollaborationSettingsAction } from "@/core/collaboration/actions";
import type { CustomerCollaborationSettings } from "@/core/collaboration/types";

interface CustomerCollaborationSettingsProps {
  initialSettings: CustomerCollaborationSettings;
}

export default function CustomerCollaborationSettings({
  initialSettings,
}: CustomerCollaborationSettingsProps) {
  const [settings, setSettings] = useState<CustomerCollaborationSettings>(initialSettings);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleSave = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await updateCustomerCollaborationSettingsAction({
        allowMultiSalesFollowup: settings.allowMultiSalesFollowup,
        requireProductExclusivity: settings.requireProductExclusivity,
      });
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: res.message || "保存协同规则失败",
        });
        return;
      }
      setSettings(res.data);
      setFeedback({
        type: "success",
        message: "客户协同与防撞单规则已生效",
      });
    });
  };

  return (
    <div className="space-y-6">
      {/* 规则配置主卡片 */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              客户共享协同与防撞单规则
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              规范跨业务线联合跟进权限与同客户多产品线商机防撞单排他控制
            </p>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            {isPending ? "正在保存..." : "保存配置"}
          </button>
        </div>

        {feedback && (
          <div
            className={`mt-4 rounded-lg p-3 text-xs font-medium ${
              feedback.type === "success"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-rose-50 text-rose-800 border border-rose-200"
            }`}
          >
            {feedback.message}
          </div>
        )}

        <div className="mt-6 divide-y divide-slate-100 border-t border-slate-100">
          {/* 开关 1：允许多人协同跟进客户 */}
          <div className="flex items-start justify-between py-5 gap-4">
            <div className="space-y-1">
              <label
                htmlFor="allowMultiSalesFollowup"
                className="text-sm font-semibold text-slate-900 cursor-pointer"
              >
                允许多人协同跟进客户
              </label>
              <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                默认处于关闭状态（独占跟进模式）。开启后，允许非客户主负责人的销售人员在同一客户下为不同产品线独立立项商机与推进销售流程；客户主档负责人保持不变。
              </p>
            </div>
            <div className="flex items-center pt-0.5">
              <input
                id="allowMultiSalesFollowup"
                type="checkbox"
                checked={settings.allowMultiSalesFollowup}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    allowMultiSalesFollowup: e.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
              />
            </div>
          </div>

          {/* 开关 2：产品线防撞单排他控制 */}
          <div className="flex items-start justify-between py-5 gap-4">
            <div className="space-y-1">
              <label
                htmlFor="requireProductExclusivity"
                className="text-sm font-semibold text-slate-900 cursor-pointer"
              >
                产品线防撞单排他保护
              </label>
              <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                同客户相同产品方向只允许一个销售新建并推进活跃商机。当销售尝试立项已有其他销售在推进的相同产品商机时，系统将即时拦截并提示当前跟进人与商机信息，避免内部撞单。
              </p>
            </div>
            <div className="flex items-center pt-0.5">
              <input
                id="requireProductExclusivity"
                type="checkbox"
                checked={settings.requireProductExclusivity}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    requireProductExclusivity: e.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 规则机制产品化说明 */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
          业务规则与防撞单控制机制说明
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600">
          <div className="rounded-lg bg-white p-3.5 border border-slate-200/80 shadow-2xs">
            <span className="font-semibold text-slate-900 block mb-1">
              独占防撞单判定
            </span>
            相同客户下，同一产品方向（同产品编号、同产品名称或同选配明细）仅允许存在一条推进中商机（非赢单/非输单状态）。
          </div>
          <div className="rounded-lg bg-white p-3.5 border border-slate-200/80 shadow-2xs">
            <span className="font-semibold text-slate-900 block mb-1">
              权责与归属隔离
            </span>
            跨产品线协同商机由立项销售全权负责其阶段推进与业绩结算，客户主档仍归属于主负责人，确保权责清晰。
          </div>
          <div className="rounded-lg bg-white p-3.5 border border-slate-200/80 shadow-2xs">
            <span className="font-semibold text-slate-900 block mb-1">
              输单排他释放
            </span>
            当原有商机标记为输单（LOST）后，系统将自动释放该产品线的排他保护，允许其他销售重新立项跟进。
          </div>
        </div>
      </div>
    </div>
  );
}
