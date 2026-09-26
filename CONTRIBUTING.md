# 贡献指南

感谢你有兴趣为 Super CRM 做贡献。这份文档说明如何搭建开发环境、代码规范、测试要求，以及提交 PR 的流程。

## 开始之前

- 提交 **issue** 请说明：期望行为、实际行为、复现步骤。如果是功能建议，请先描述使用场景，而不是直接给实现方案。
- 提交 **PR** 前请确认你已阅读本文件，且本地通过了完整门禁。

## 开发环境

**前置条件**：Node.js 22（见 `.nvmrc`）、pnpm 9.15.5、Docker。

```bash
git clone https://github.com/Jimmyzxk/super-crm.git
cd super-crm
cp .env.example .env
pnpm install
pnpm docker:dev          # 启动 PostgreSQL + 应用（代码改动热更新）
pnpm db:seed:demo        # 可选：造一份演示数据，便于在界面上查看效果
```

开发服务器在 http://localhost:3000，默认账号 `admin@example.com` / `password123`（仅开发环境）。

### 常用命令

```bash
pnpm dev                 # 仅启动 Next.js（不含容器）
pnpm typecheck           # 类型检查
pnpm lint                # 分层门禁 + ESLint
pnpm test                # 全部测试（需要 PostgreSQL 已启动）
pnpm test:unit           # 仅单元测试（快速）
pnpm test:integration    # 仅集成测试（真实数据库）
pnpm build               # 生产构建
pnpm db:generate         # 根据 schema 改动生成迁移
pnpm db:migrate          # 应用迁移
```

## 提交前必须通过的门禁

```bash
pnpm typecheck && pnpm lint && pnpm test
```

三项必须全部通过且无新增 warning。CI 会在 push 与 PR 时执行同样的检查，本地不过 CI 也不会过。

## 代码规范

### 分层边界（重要）

项目有明确的分层，由 `scripts/check-layer-boundary.ts` 强制检查：

- `src/core/` **不得**导入 `src/plugins/`。核心必须能在没有任何插件的情况下正常工作。
- `src/plugins/` 只能通过 `plugin-kit` 提供的白名单接口访问核心能力。
- 数据库客户端 `src/db/client.ts` 只允许 `src/core/tenant` 引用。

提交违反分层边界的代码会直接被 `pnpm lint` 拦下。

### 多租户安全（重要）

所有涉及业务数据的读写都必须发生在租户上下文中：

```ts
await withTenant(ctx.tenantId, async (tx) => {
  // 在这里做数据操作
});
```

- 不要绕过 `withTenant` 直接使用裸 `db` 查询业务表。
- 新增业务表时必须同时启用 RLS 策略（`ENABLE` + `FORCE`），并配套编写租户隔离测试。
- 任何跨租户数据泄漏都是严重缺陷。

### 其他约定

- **TypeScript strict 模式**，不使用 `any`（必要时用 `unknown` + 类型收窄）。
- **金额统一以「分」为单位存储**（整数），不要用浮点数表示金额。
- **业务时区固定 `Asia/Shanghai`**。涉及时间的展示或计算必须显式使用 `src/core/shared/tz.ts` 提供的工具，不要依赖运行环境时区——服务器通常跑在 UTC。
- **数据库迁移与使用它的代码在同一次提交内**，不要分开。
- 注释只写代码本身无法表达的信息（约束、原因、边界条件）。不要写"这里做了什么"这类复述。

## 测试要求

### 我们只接受行为级测试

**不接受**这类测试作为功能正确性的证据：

```ts
// ❌ 不要这样写
const src = readFileSync("src/core/foo/service.ts", "utf8");
expect(src).toContain("for update");
```

源码字符串断言无法证明任何运行行为，改动实现写法就会失效或产生假阳性。

**应该**这样写——真实调用被测代码，断言可观测的结果：

```ts
// ✅ 真调用 service，断言真实行为
const result = await recordPaymentService(ctx, { orderId, amount: 10000 });
expect(result.paidAmount).toBe(10000);
```

优先选择：真数据库连接、真 service 调用、真 HTTP handler。外部依赖（AI 网关、webhook）可以用替身，但被测逻辑本身必须是真实执行。

### 必须测试什么

- **租户隔离**：每张新增业务表至少一条跨租户访问被拒绝的测试。
- **状态机**：状态流转的合法路径必须穷举，非法路径必须被拒绝。
- **金额与并发**：涉及金额守恒、幂等键、并发写入的逻辑需要真数据库并发测试。
- **边界条件**：时区边界、空值、超长输入、越权访问。

### 测试命名

用中文描述行为，说明"在什么情况下应该发生什么"：

```ts
it("第一期已结清时，新收款应分摊到第二期", async () => { ... });
```

不要用 `it("works")`、`it("test 1")` 这类无信息量的名字。

## 提交规范

提交信息采用 [Conventional Commits](https://www.conventionalcommits.org/) 风格：

```
feat: 新增线索批量导出
fix: 修复跨时区场景下跟进时间显示偏移 8 小时
refactor: 收付款分期分摊逻辑提取为共用函数
test: 补充合同额度并发竞争的行为级测试
docs: 部署手册补充备份失败告警说明
chore: 升级依赖
```

- 一个提交只做一件事，不要攒大提交。
- 提交信息说明**为什么**改，而不只是改了什么。
- 迁移文件与使用它的代码必须在同一次提交。

## PR 流程

1. Fork 仓库并从 `main` 拉出特性分支（如 `feat/lead-export`）。
2. 完成改动，本地跑通 `pnpm typecheck && pnpm lint && pnpm test`。
3. 提交 PR，说明：改了什么、为什么改、如何验证。
4. 等待 CI 通过。CI 失败时请先修复，不要提交绕过门禁的改动。
5. 维护者 review 后合并。

**PR 会被拒绝的情况**：门禁未通过、缺少行为级测试、破坏分层边界、绕过租户隔离、为通过测试而放宽断言。

## 安全漏洞

如果你发现安全漏洞，请**不要**直接开公开 issue。请通过仓库主页的联系方式私下报告，我们会尽快响应。

重点关注的方面：多租户数据越权、认证与授权绕过、SQL 注入、SSRF（出网请求）、敏感信息泄漏。

## 许可证

本项目以 [AGPL-3.0-only](./LICENSE) 授权。提交贡献即表示你同意你的贡献以同一许可证发布。

请注意 AGPL 的网络服务条款：将本程序的修改版作为网络服务提供给他人使用时，必须向使用者提供修改版的完整源码。
