import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ⚠️ 本文件是**配置/架构守护**，不是行为断言。
 *
 * 开源版（AGPL-3.0）不含任何业务插件实现（src/plugins 已整体移除），
 * 因此本文件守护的不变式从「插件不得直写核心表」升级为两条更前置的约束：
 *  1. src/plugins 目录不存在 —— 闭源插件实现不随开源版分发；
 *  2. core 与 lib 仍然零引用 @/plugins 与插件表（分层门禁的静态对偶）。
 *
 * 运行时行为证据在以下两处：
 *  · 分层门禁行为测试：tests/unit/layer-boundary.test.ts（checkContent / scanLayerBoundaries 真实执行）
 *  · 插件缺席时的优雅降级：tests/integration/plugin-facts-provider.test.ts、
 *    tests/integration/oss-core-plugin-framework-integrity.test.ts（真 DB，验证无插件时
 *    晨检/AI 工具/客户详情不报错、导航不出现幽灵入口）
 */

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("plugin write boundary（架构守护，非行为断言）", () => {
  it("开源版不包含任何业务插件实现目录", () => {
    expect(existsSync(join(process.cwd(), "src/plugins"))).toBe(false);
  });

  it("插件框架本体保留在 src/plugin-kit", () => {
    const kit = join(process.cwd(), "src/plugin-kit");
    expect(existsSync(kit)).toBe(true);
    const files = sourceFiles(kit).map((p) => p.split("/").pop()).sort();
    expect(files).toContain("definition.ts");
    expect(files).toContain("registry.ts");
    expect(files).toContain("server.ts");
    expect(files).toContain("types.ts");
    // 随闭源插件移除的真实事实提供者（其 SQL 全部指向闭源插件表）
    expect(files).not.toContain("facts.ts");
  });

  it("插件框架代码自身不直写核心业务表（框架只允许触碰 plugin_registry / plugin_rate_limits）", () => {
    const source = sourceFiles(join(process.cwd(), "src/plugin-kit"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const coreTables = [
      "users", "leads", "lead_status_history", "customers", "contacts",
      "opportunities", "activities", "tasks", "sales_insights", "sales_playbooks",
    ];

    for (const table of coreTables) {
      expect(source, `plugin-kit must not write core table ${table}`).not.toMatch(
        new RegExp(`\\b(?:insert\\s+into|update|delete\\s+from)\\s+(?:public\\.)?${table}\\b`, "i"),
      );
    }
  });

  it("core 与 lib 不存在 @/plugins 引用与插件表字样（与 check-layer-boundary 门禁同源）", () => {
    const roots = [join(process.cwd(), "src/core"), join(process.cwd(), "src/lib")]
      .filter((dir) => existsSync(dir));
    const files = roots.flatMap(sourceFiles);
    const offenders: string[] = [];
    for (const path of files) {
      const content = readFileSync(path, "utf8");
      if (/@\/plugins/.test(content)) offenders.push(`${path}: @/plugins import`);
      if (/\bplugin_(contracts|orders|projects|order_|project_|contract_|ai_bi_reports|form_)/i.test(content)) {
        offenders.push(`${path}: plugin table literal`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
