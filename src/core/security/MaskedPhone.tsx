"use client";

import React, { useState } from "react";
import { useSecurityConfig } from "./SecurityConfigProvider";
import { maskPhone } from "./masking";
import { revealSensitiveFieldAction } from "./actions";

export default function MaskedPhone({
  phone,
  entityType = "LEAD",
  entityId = "",
  reason = "业务跟进联络查看明文号码",
  className = "",
  showCopy = false,
}: {
  phone: string | null | undefined;
  entityType?: "LEAD" | "CONTACT" | "CUSTOMER";
  entityId?: string;
  reason?: string;
  className?: string;
  showCopy?: boolean;
}) {
  const { isPhoneMaskingEnabled } = useSecurityConfig();
  const [unmaskedPhone, setUnmaskedPhone] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!phone) return <span className="text-slate-400 font-mono text-[11px]">-</span>;

  const isMasked = isPhoneMaskingEnabled && !unmaskedPhone;
  const currentPhone = unmaskedPhone || phone;

  async function handleReveal(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!entityId) return;
    setRevealing(true);
    const res = await revealSensitiveFieldAction(entityType, entityId, "PHONE", reason);
    if (res.ok && res.data.unmaskedValue) {
      setUnmaskedPhone(res.data.unmaskedValue);
    }
    setRevealing(false);
  }

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(currentPhone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isMasked) {
    return (
      <span className={`inline-flex items-center gap-1.5 font-mono ${className}`}>
        <span className="font-bold text-slate-700">{maskPhone(phone)}</span>
        <button
          type="button"
          onClick={handleReveal}
          disabled={revealing}
          className="text-[10px] text-blue-600 hover:underline inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-blue-50/80 hover:bg-blue-100/80 transition"
          title="点击查看完整号码并记录操作日志"
        >
          {revealing ? "..." : "查看"}
        </button>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono ${className}`}>
      <a
        href={`tel:${currentPhone}`}
        onClick={(e) => e.stopPropagation()}
        className="font-bold text-blue-600 hover:underline"
      >
        {currentPhone}
      </a>
      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          className="text-[10px] text-slate-400 hover:text-slate-700"
          title="复制号码"
        >
          {copied ? "已复制" : "复制"}
        </button>
      )}
    </span>
  );
}
