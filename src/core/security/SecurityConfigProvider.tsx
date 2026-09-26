"use client";

import React, { createContext, useContext } from "react";
import type { SecurityComplianceConfigItem } from "./service";

const SecurityConfigContext = createContext<{
  isPhoneMaskingEnabled: boolean;
  isEmailMaskingEnabled: boolean;
  isAiCopilotEnabled: boolean;
  aiProvider: string;
  aiModelName: string;
  watermarkEnabled: boolean;
}>({
  isPhoneMaskingEnabled: false,
  isEmailMaskingEnabled: false,
  isAiCopilotEnabled: false,
  aiProvider: "BUILTIN",
  aiModelName: "deepseek-chat",
  watermarkEnabled: true,
});

export function SecurityConfigProvider({
  config,
  children,
}: {
  config: SecurityComplianceConfigItem;
  children: React.ReactNode;
}) {
  return (
    <SecurityConfigContext.Provider
      value={{
        isPhoneMaskingEnabled: config.isPhoneMaskingEnabled ?? false,
        isEmailMaskingEnabled: config.isEmailMaskingEnabled ?? false,
        isAiCopilotEnabled: config.isAiCopilotEnabled ?? false,
        aiProvider: config.aiProvider ?? "BUILTIN",
        aiModelName: config.aiModelName ?? "deepseek-chat",
        watermarkEnabled: config.watermarkEnabled ?? true,
      }}
    >
      {children}
    </SecurityConfigContext.Provider>
  );
}

export function useSecurityConfig() {
  return useContext(SecurityConfigContext);
}
