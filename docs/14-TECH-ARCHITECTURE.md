# 技术架构

版本：v1.0 · 2026-08-11

---

> **📦 开源版发行说明（AGPL-3.0）**
>
> 本仓库是「主代码开源 + 业务插件闭源」的**发行版**。以下内容在开源版中的实际状态：
>
> | 项 | 状态 |
> |---|---|
> | `src/plugin-kit/`（`PluginDefinition` 契约、`registry` 装配点、挂载点、启停 `plugin_registry` 与限流 `plugin_rate_limits`） | ✅ **完整保留**（框架） |
> | `src/plugins/` 下 7 个业务插件（bi / contracts / form-capture / knowledge-base / lead-routing / orders / projects）及其页面路由、API 路由、数据表 | 🔒 **闭源组件，不在本仓库** |
> | `registry.ts` 的 `compiledPlugins` | 空数组（空框架）。二次开发把插件 `index.ts` import 进来 push 即可挂载，上游调用点无需改动 |
> | 插件相关数据表与迁移 | 不在本仓库迁移中；`pnpm db:migrate` 在空库上建出的表结构**不含**任何业务插件表 |
> | 文档中描述的插件架构与契约 | **作为架构资料保留**（这是插件框架的设计依据），但开源版运行时不会有任何插件被装配 |
>
> 框架在插件缺席时的降级语义：导航不出现幽灵入口、详情页挂载点与设置分区渲染为空、AI 工具与晨检报告的插件事实段落为空（见 `tests/integration/oss-core-plugin-framework-integrity.test.ts` 与 `tests/integration/plugin-facts-provider.test.ts`）。

## 1. 技术选型

```
Next.js (App Router) + TypeScript
        ↓
PostgreSQL 17 + Drizzle ORM + Row Level Security
        ↓
Tailwind CSS
```

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Next.js App Router | 全栈一体，前后端共享类型，部署简单 |
| 语言 | TypeScript（strict） | |
| 数据库 | PostgreSQL 17 | **RLS 是多租户隔离的基础**，这是选它的首要原因 |
| ORM | Drizzle | 类型安全、迁移可控、SQL 透明 |
| 校验 | Zod | 与 TS 类型互推，Server Action 入参校验 |
| 样式 | Tailwind + 自建组件 | 不引入重型组件库 |
| 密码 | bcrypt（cost 12） | |
| 会话 | JWT + httpOnly Cookie（jose） | |
| 测试 | Vitest + Playwright | |

### 1.1 数据架构：在线池、过程记录、分析汇总

系统按数据用途分层，不按角色复制数据：

```text
业务事实层  leads / customers / opportunities
过程记录层  activities / tasks / status_history / audit_logs
角色查询层  同一事实层上的 SALES / MANAGER / ADMIN 查询
分析汇总层  固定口径的 analytics_*（达到容量或指标需求后启用）
```

三个业务池是独立的事实边界。公共过程表只保存“发生了什么”，不保存三套对象副本；转化关系单独保存线索、客户和本次转化商机的来源链。

### 1.2 明确不引入

每一条都要能回答"没有它闭环会断吗"——答案都是"不会"。

| 不引入 | 替代方案 |
|---|---|
| ❌ 状态管理库（Redux/Zustand） | Server Components + URL 状态 |
| ❌ 组件库（Ant Design / shadcn 全量） | 自建少量组件 |
| ❌ 消息队列（BullMQ / Redis 队列） | 一个定时 Route Handler；分析汇总先用增量 SQL |
| ❌ Redis | V1 无缓存需求，会话在 JWT 里 |
| ❌ 微服务 / GraphQL / tRPC | Server Actions 够用 |
| ❌ 对象存储 | V1 不做文件上传 |
| ❌ 复杂 projection / CQRS 读模型 | V1 用当前事实表、复合/部分索引和游标分页 |
| ❌ 监控/APM 平台 | V1 用日志 |

> **业界实践的教训**：建了两套 projection 读模型 + 队列 + worker + 单飞优化，深度可观，交付零价值。**先做对，有数据支撑再优化。**

---

## 2. 目录结构

```
crm/
├── docs/                      ← PRD（本目录）
├── src/
│   ├── app/                   ← Next.js 路由
│   │   ├── (auth)/
│   │   │   └── login/
│   │   ├── (app)/             ← 需登录，共享布局壳
│   │   │   ├── today/         ← 今日工作台
│   │   │   ├── leads/
│   │   │   ├── customers/
│   │   │   ├── opportunities/
│   │   │   ├── inbox/
│   │   │   ├── playbooks/
│   │   │   └── settings/
│   │   ├── p/                 ← 插件页面挂载区
│   │   └── api/
│   │       ├── cron/          ← 定时任务入口
│   │       └── public/        ← 对外公开接口
│   ├── core/                  ← 核心业务逻辑
│   │   ├── tenant/            ← 租户上下文、withTenant
│   │   ├── auth/              ← 登录、会话、权限校验
│   │   ├── lead/
│   │   ├── customer/
│   │   ├── activity/
│   │   ├── task/
│   │   ├── opportunity/
│   │   ├── scoring/           ← 评分（核心）
│   │   ├── notification/      ← 通知（核心）
│   │   └── audit/
│   ├── plugin-kit/            ← definePlugin、核心白名单 API、挂载点注册表
│   ├── db/
│   │   ├── schema/            ← Drizzle schema
│   │   ├── migrations/        ← 手写 SQL，含 RLS
│   │   └── client.ts
│   └── ui/                    ← 共享组件
├── plugins/
│   └── form-capture/          ← V1 唯一插件
└── tests/
    ├── isolation/             ← 租户隔离测试
    ├── rules/                 ← 业务规则测试
    └── e2e/                   ← 端到端
```

### 2.1 每个模块的内部结构

```
core/lead/
├── actions.ts       ← Server Actions（写操作入口）
├── queries.ts       ← 读查询
├── rules.ts         ← 纯业务规则（状态机等），无 IO，易测
└── types.ts
```

**`rules.ts` 必须是纯函数**，不碰数据库。状态机、校验逻辑放这里，单测直接覆盖。

### 2.2 目录规则（ESLint 强制）

| 规则 | 原因 |
|---|---|
| `core/` **不能** import `plugins/` | 核心不依赖插件 |
| `plugins/` 只能 import `plugin-kit/` 和公开类型 | 插件不碰核心内部 |
| `app/` 之外**不能** import `next/navigation` 等路由 API | 保持业务逻辑可测 |
| `db/client.ts` 只能被 `core/tenant/` import | 强制走 withTenant |

**靠自觉守不住，必须用 `no-restricted-imports` 规则。**

---

## 3. 数据访问规范

### 3.1 唯一入口

```ts
// ✅ 唯一允许的方式
const leads = await withTenant(ctx, (tx) =>
  tx.select().from(leadsTable).where(eq(leadsTable.ownerUserId, ctx.userId))
)

// ❌ 禁止：裸 db 直查业务表
const leads = await db.select().from(leadsTable)
```

### 3.2 withTenant 做什么

```
① 校验 ctx.tenantId 非空（空则抛错，绝不回退到"默认租户"）
② 开启事务
③ 在事务内 set_config('app.tenant_id', tenantId, true)
④ 执行查询
⑤ 事务结束，变量自动清除
```

**必须用事务绑定连接**：`set_config` 设在连接 A、查询跑在连接 B，RLS 就拿不到 tenant_id。

**必须用 `set_config(..., true)`**：作用域限定在事务内，不会泄漏到连接池的下一个请求。

### 3.3 无会话入口的窄通道

**通道 A：`auth_lookup_user()` — 专用 BYPASSRLS 属主持有的 SECURITY DEFINER 函数**

这是阶段 0 唯一绕过 RLS 的地方，专供登录使用。

| | |
|---|---|
| 为什么需要 | 登录时还没有 tenantId，要靠 email 反查；而 `users` 有 RLS，普通查询返回 0 行 |
| 为什么安全 | `NOLOGIN BYPASSRLS` 属主只持有认证列权限；应用角色仅可 EXECUTE 且不能 SET ROLE；函数只按 email 精确查、只返回认证 8 字段 |

> `FORCE ROW LEVEL SECURITY` 会让普通表属主也受 RLS。仅声明 `SECURITY DEFINER` 不会自动绕过，函数必须由 [11](./11-DOMAIN-AND-DATA.md) 4.2.1 定义的专用 `salescrm_auth NOLOGIN BYPASSRLS` 角色持有。

> ⚠️ **`withoutTenant()` 不能用于读 `users`。**
> 它只是"不设 `app.tenant_id`"，RLS 依然生效，结果是查到 0 行 —— **系统根本登不进去**。
> 这是文档二审发现的致命矛盾，见 [11](./11-DOMAIN-AND-DATA.md) 4.2.1。

**通道 B：`withoutTenant()` — 只用于读 `tenants` 表**

`tenants` 表不启用 RLS（它是租户清单本身，不含业务数据），因此可以直接读。

| 调用点 | 用途 |
|---|---|
| `login` | 校验租户 `status = ACTIVE` |
| `/api/cron/*` | 遍历所有活跃租户，逐个 `withTenant` 扫描 |

**这两处之外禁止使用 `withoutTenant()`**，ESLint + 代码评审双重把关。

阶段 5 的公开表单还有一条独立的 `public_lookup_published_form()` 通道：由另一个 `NOLOGIN BYPASSRLS` 角色持有，只按 UUID 定位已发布表单的 tenantId。它不是 `withoutTenant()` 调用点，也不得复用认证函数属主。详见 [13](./13-PLUGIN-CONTRACT.md) 3.5。

### 3.4 两个连接串

| 环境变量 | 角色 | 用途 |
|---|---|---|
| `MIGRATION_DATABASE_URL` | owner | **仅**迁移 |
| `DATABASE_URL` | 非 owner 应用角色 | 应用运行时 |

> **关键**：PostgreSQL 的 RLS 对表 owner 默认不生效。用 owner 连接会让所有策略**静默失效**。策略同时加 `FORCE ROW LEVEL SECURITY`。

旧来源回填使用独立的 `salescrm_migration NOLOGIN BYPASSRLS` 角色。owner 迁移连接只在受控窗口显式 `SET ROLE` 调用回填并检查隔离清单；`salescrm_auth` 仍只持有登录窄函数，运行时应用角色不能切换到任一 BYPASSRLS 角色。

---

## 4. 权限校验

三层，缺一不可（详见 [09](./09-FEATURE-ADMIN.md) 2.4）：

| 层 | 位置 | 作用 |
|---|---|---|
| UI | 组件渲染前 | 无权限不渲染（体验，非安全） |
| Action | 每个 Server Action 开头 | **真正的拦截** |
| 数据库 | RLS 策略 | 租户隔离兜底 |

每个 Server Action 的开头四步：

```ts
const ctx = await requireSession()              // ① 会话
requireRole(ctx, ['MANAGER', 'ADMIN'])          // ② 角色
const input = Schema.parse(rawInput)            // ③ 入参
return withTenant(ctx, async (tx) => { ... })   // ④ 租户
```

`requireSession()` 内部先验证 JWT，再取签名载荷中的 `tenantId` 调 `withTenant()` 查询数据库当前用户；角色和 `session_version` 以数据库值为准。它不能在租户上下文建立前裸查 `users`。

---

## 5. 定时任务

**V1 只有一个**：扫描超时任务生成通知（每 5 分钟）。

### 5.1 方案

Route Handler `POST /api/cron/scan-tasks` + 外部定时调用（系统 cron / 平台定时器）。

| 要点 | 做法 |
|---|---|
| 认证 | Header `X-Cron-Secret` 匹配环境变量 |
| 防重入 | `SELECT ... FOR UPDATE SKIP LOCKED` |
| 单次上限 | 1000 条，超过下次继续 |
| 超时监控 | 执行 > 30 秒记警告日志 |

### 5.2 为什么不用队列

一个定时任务不需要 BullMQ。引入它意味着 Redis + worker 进程 + 失败重试 + 监控。

**等真的需要（多个定时任务、需要重试、需要并发控制）再引入，那时有真实依据。**

---

## 6. 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | 应用连接（**非 owner 角色**） |
| `MIGRATION_DATABASE_URL` | ✅ | 迁移连接（owner） |
| `SESSION_SECRET` | ✅ | JWT 签名密钥，生产必须随机 |
| `CRON_SECRET` | ✅ | 定时任务调用密钥 |
| `DATABASE_POOL_MAX` | ❌ | 默认 10 |
| `NODE_ENV` | ❌ | |

### 6.1 缺失时的行为

**启动直接失败，打印缺哪个变量。**

绝不静默降级到默认值——那会让"忘了配"变成"上线后才发现"。

---

## 7. 性能目标与手段

| 场景 | 目标 | 手段 |
|---|---|---|
| 今日工作台首屏 | P95 < 500ms | 角色范围查询 + `(tenant_id, assignee_user_id, status, due_at)` |
| 三个池列表 20 条 | P95 < 500ms | 游标分页 + `tenant_id` 前缀复合索引 + 部分索引 |
| 记跟进提交 | P95 < 300ms | 单事务，无外部调用 |
| 评分计算 | < 100ms | 内存规则判定，超时记警告 |
| 容量基线 | 单租户 100 万客户、500 万线索、5000 万跟进需压测 | 代表性数据 + `EXPLAIN (ANALYZE, BUFFERS)` |

### 7.1 列表查询规则

- 列表只取当前状态、负责人、评分/阶段、最近跟进摘要、下一任务和固定聚合；
- 历史时间线在详情页按对象和时间窗口分页，不在列表中做全量 JOIN；
- 角色视图只改变 `WHERE`、聚合和动作权限，不改变数据表；
- 禁止深层 `OFFSET`、无条件 `COUNT(*)`、每行独立查询历史的 N+1；固定筛选数量只能使用明确 ceiling 的有限计数，并在响应中标明截断；
- 过程表达到 1000 万行或 50GB 后才评审按月分区，当前事实主表不盲目分区；
- 主管趋势和大范围统计必须使用固定指标汇总，不让页面请求扫描原始活动表。

**不做的优化**（无数据支撑前）：查询缓存、读写分离、多套角色读模型、连接池调优。固定口径的轻量汇总和经过压测触发的时间分区不属于提前优化。

---

## 8. 日志

| 级别 | 用途 |
|---|---|
| `error` | 未预期异常、定时任务失败、插件处理器抛错 |
| `warn` | 评分超 100ms、定时任务超 30 秒、跨租户访问尝试 |
| `info` | 启动、迁移应用、定时任务完成 |

**日志必须带 `tenantId`**（如果有上下文），便于排查。

**日志禁止打印**：密码、密码哈希、会话 token、完整手机号（脱敏为 `138****1001`）。

---

## 9. 部署

V1 目标：**单机 Docker Compose 起得来**。

```
docker compose up -d postgres
pnpm db:migrate
pnpm build && pnpm start
```

不做：Kubernetes、多实例、灰度、蓝绿。等有真实流量再说。
