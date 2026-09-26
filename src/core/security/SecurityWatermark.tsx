"use client";

import { useEffect, useRef } from "react";
import { useSecurityConfig } from "./SecurityConfigProvider";

interface SecurityWatermarkProps {
  tenantName?: string;
  userName?: string;
  userEmail?: string;
}

export default function SecurityWatermark({
  tenantName,
  userName,
  userEmail,
}: SecurityWatermarkProps) {
  const config = useSecurityConfig();
  const containerRef = useRef<HTMLDivElement>(null);

  const isEnabled = config.watermarkEnabled ?? true;

  useEffect(() => {
    if (!isEnabled || !containerRef.current) return;

    try {
      const canvas = document.createElement("canvas");
      const width = 320;
      const height = 180;
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);
      ctx.rotate((-22 * Math.PI) / 180);
      ctx.font = "500 11px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "rgba(15, 23, 42, 0.045)";
      ctx.textAlign = "center";

      const line1 = `${tenantName || "企业数字化CRM"} · ${userName || "内部员工"}`;
      const line2 = `${userEmail || ""} · ${new Date().toLocaleDateString("zh-CN")}`;

      ctx.fillText(line1, width / 2 - 30, height / 2 + 20);
      ctx.fillText(line2, width / 2 - 30, height / 2 + 38);

      const bgUrl = canvas.toDataURL("image/png");
      if (containerRef.current) {
        containerRef.current.style.backgroundImage = `url(${bgUrl})`;
      }
    } catch {
      // Ignore canvas errors in non-standard environments
    }
  }, [isEnabled, tenantName, userName, userEmail]);

  if (!isEnabled) return null;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[9999] select-none bg-repeat print:opacity-40"
      style={{
        backgroundRepeat: "repeat",
      }}
    />
  );
}
