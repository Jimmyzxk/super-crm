import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db", "@/db/*", "**/db", "**/db/*"],
              message: "UI and plugin code must call core APIs instead of importing the database.",
            },
          ],
        },
      ],
    },
  },
  // 开源版（AGPL-3.0）：src/plugins 当前为空（7 个业务插件为闭源组件）。
  // 本条规则保留为「插件框架契约」的一部分——二次开发把插件目录加回来即刻生效。
  {
    files: ["src/plugins/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/core", "@/core/*", "**/core", "**/core/*"], message: "Plugins must use plugin-kit server APIs instead of core modules." },
            { group: ["@/db", "@/db/*", "**/db", "**/db/*"], message: "Plugins must use plugin-kit server APIs instead of database modules." },
            { group: ["@/app", "@/app/*", "**/app", "**/app/*"], message: "Plugins must not import application routes or UI modules." },
          ],
        },
      ],
    },
  },
  // 分层门禁（与 scripts/check-layer-boundary.ts 互为对偶）：core/lib 绝不依赖 plugins
  {
    files: ["src/core/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/plugins", "@/plugins/*", "**/plugins", "**/plugins/*"], message: "Core modules must not depend on plugins." },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "node_modules/**", "next-env.d.ts"]),
]);
