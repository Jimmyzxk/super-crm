import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * ⚠️ 本文件按 W12-4 逐条处置：原来全部是 readFileSync + toContain 源码字符串断言，
 * 外部审计已点名这类断言不能作为风险关闭证据。处置结果如下。
 *
 * 【已替换为行为测试，且在开源版（AGPL-3.0）中仍然有效】
 *  · F11 CSV 同批去重 → tests/integration/csv-lead-import.test.ts
 *      · 「同批重复手机号：首行创建，后续同批重复计 skipped（不产生第二条线索）」
 *      · 「库内已存在的手机号在 skipDuplicates=true 时计 skipped（跨批去重）」
 *  · F06 币种守恒 → tests/integration/comprehensive-security-and-bugfix-audit.test.ts
 *      （API Key / 机器人密钥落库密文）
 *
 * 【随闭源插件移除（订单 / 合同域）】
 *  · F03 订单对象授权与关联校验、F05 幂等键严格化、F04 合同额度并发、F06 币种守恒（service 层）
 *    全部依赖 @/plugins/orders 与 @/plugins/contracts 的实现与其数据表，
 *    在开源版中不再存在，因此对应用例与配置守护一并移除。
 *    等价的核心不变量（租户内复合外键 / 幂等键唯一性）改由核心表自身的约束与
 *    tests/integration/lead-source-api.test.ts 覆盖。
 *
 * 【保留为配置/架构守护（非行为断言）】
 *  · G03 文档声明（docs/21 的规划中标注）—— 本质是文档内容声明
 */

function read(p: string) { return readFileSync(p, "utf8"); }

describe("Wave7 G03 文档校正（配置守护，非行为断言）", () => {
  it("docs/21-AI-AGENT-HARNESS-STRATEGY.md 标记 90%预警/100%降级为规划中", () => {
    const doc = read("docs/21-AI-AGENT-HARNESS-STRATEGY.md");
    expect(doc).toContain("规划中");
    expect(doc).toContain("轮数上限");
    expect(doc).toContain("usage 计量已实现");
    expect(doc).toContain("90%预警/100%降级");
    expect(doc).not.toMatch(/已全部就绪/);
  });
});

describe("Wave7 开源版插件边界守护（配置守护，非行为断言）", () => {
  it("schema 中不再残留任何已移除业务插件表的定义", () => {
    const schema = read("src/db/schema/index.ts");
    for (const removed of [
      "plugin_contracts",
      "plugin_orders",
      "plugin_projects",
      "plugin_order_items",
      "plugin_order_invoices",
      "plugin_order_payment_schedules",
      "plugin_order_payment_transactions",
      "plugin_order_revenue_schedules",
      "plugin_project_order_links",
      "plugin_project_milestones",
      "plugin_ai_bi_reports",
      "plugin_form_definitions",
      "plugin_form_submissions",
      "plugin_form_submission_links",
      "knowledge_base_articles",
      "knowledge_base_chunks",
      "lead_routing_rules",
      "lead_routing_logs",
    ]) {
      expect(schema).not.toContain(`pgTable("${removed}"`);
    }
  });

  it("插件框架两张基础设施表仍保留在 schema 中（启停开关 + 限流）", () => {
    const schema = read("src/db/schema/index.ts");
    expect(schema).toContain('pgTable("plugin_registry"');
    expect(schema).toContain('pgTable("plugin_rate_limits"');
  });

  it("迁移集中已无任何已移除业务插件表的 DDL", () => {
    const dir = "src/db/migrations";
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
      const sql = read(`${dir}/${f}`);
      expect(sql).not.toMatch(/create table (if not exists )?(public\.)?plugin_(contracts|orders|projects|order_|project_|contract_|ai_bi_reports|form_)/i);
      expect(sql).not.toMatch(/create table (if not exists )?(public\.)?(knowledge_base_|lead_routing_)/i);
    }
  });
});
