# Super CRM（商脉 AI CRM）

一个把优秀销售的推进方法沉淀下来，并在每一笔业务中给出可执行建议的 AI CRM。

> **📦 发行形态：主代码开源（AGPL-3.0-only）+ 业务插件闭源。**
>
> 本仓库包含**完整的插件框架**（`src/plugin-kit/`：`PluginDefinition` 契约、`registry` 装配点、UI 挂载点、插件启停表 `plugin_registry`、插件 API 限流表 `plugin_rate_limits`），但**不包含** 7 个业务插件（bi / contracts / form-capture / knowledge-base / lead-routing / orders / projects）的实现、页面路由、API 路由与数据表——它们是闭源组件。
>
> 开源版运行时的正确形态：**插件框架为空装配**。侧边栏导航、线索/商机详情挂载点、设置页插件分区在插件缺席时自动降级为不渲染；AI 工具与晨会巡检报告的「合同 / 账期 / 项目 / 订单」等插件事实段落为空，核心数据链路完全不受影响。
>
> **二次开发挂载自己的插件**：在 `src/plugins/<your-plugin>/` 实现 `definePlugin({...})`，然后在 `src/plugin-kit/registry.ts` 的 `compiledPlugins` 数组里 import 并 push —— 上游所有调用点无需任何改动。框架契约见 [docs/13-PLUGIN-CONTRACT.md](./docs/13-PLUGIN-CONTRACT.md)。

> **当前状态：生产就绪的演示-试用基线，非规模化 SaaS 交付。** 77 个测试文件 **545 条行为级测试全部通过、零 skip**（`vitest run` 实测 41s），`typecheck` 零错误、`lint` 零错误（9 warnings）、`build` 通过；分层门禁 `tsx scripts/check-layer-boundary.ts` 通过（122 文件扫描无越层）；**AI 六个真 Agent 已上岗**——管线健康巡检 / 晨会副驾驶（L1）/ 销冠解构（L2）/ 企业画像（L3）/ 赢单-输单归因（L1）/ 增量与变现——均走 **ReAct 循环（上限 8 轮）+ 18 个已注册 AgentTool**（`src/core/ai-hub/tools/*.ts` 实计），六厂商网关支持 `function calling`；**认知金字塔 L1-L4**（赢单归因→销冠解构→企业画像→策略推导，见 `docs/21`）与**诚实标注**（`N<20` 强制 `方向性假设（低置信度）`）；**晨会副驾驶采纳闭环**已闭环至 `ai_recommendations` + `ai_agent_learning_logs` 反哺下周策略；**插件解耦：`core` 零 `plugins` 引用**（`eslint no-restricted-imports` + 边界测试双重守卫；开源版无 `src/plugins` 实现，框架为空装配）。详见 `docs/01 / 21 / 16 / 19 / 22`。

---

## 五分钟 Quickstart

> 需 Node.js 22+、`pnpm 9.15.5`、`Docker`。以下每步均与 `package.json` scripts / `docker-compose*.yml` / `scripts/*` 实测一致。

```bash
# 1. 克隆
git clone <repo> crm && cd crm

# 2. 环境（复制模板，开发可沿用 dev 默认弱口令；生产按 .env.example 注释用 openssl 生成强随机）
cp .env.example .env

# 3. 启动（开发热更：volume 挂载，改码即时生效）
pnpm install
pnpm docker:dev              # 展开：docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml logs -f app  # 观察：PostgreSQL reachable → migrations → dev server

# 4. 迁移（容器内已随 RUN_MIGRATIONS=true 自动执行；宿主机直连时手动）
pnpm db:migrate              # 读取 MIGRATION_DATABASE_URL + APP_DATABASE_PASSWORD，Advisory Lock 防并发

# 5. 演示数据（幂等，可重跑；守卫见 scripts/seed/guard.ts：需 SEED_CONFIRM=yes 或 localhost+demo/showcase/salescrm_dev/salescrm_test）
pnpm db:seed:acceptance

# 6. 访问
open http://localhost:3000/login
# 账号：DEV_ADMIN_EMAIL / DEV_ADMIN_PASSWORD（开发默认 admin@example.com / password123）
# 健康探针：curl http://localhost:3000/api/health
```

**生产构建：** `pnpm docker:prod`（`docker compose up -d`，读取 `docker-compose.yml` + `.env` 强校验，`SESSION_SECRET/CRON_SECRET/POSTGRES_PASSWORD/APP_DATABASE_PASSWORD` 缺一即退）→ 详见 `docs/22`。

**定时任务：** `docker-compose*.yml` 已内置 `cron` 服务（`node --experimental-strip-types scripts/cron-scheduler.ts`，`CRON_BASE_URL=http://app:3000`，每 5 分钟轮询 `POST /api/cron/scan-tasks|recycle-public-pools|ai-daily-inspection`，头 `x-cron-secret`，`ai-daily-inspection` 兼容 `Authorization: Bearer`）。另起终端可 `pnpm cron` / `CRON_RUN_ONCE=1 pnpm cron` 单轮冒烟；亦可用宿主机 `crontab/launchd` 直接 `curl POST` 三端点。

---

## 能力清单

### 核心销售链（`docs/01 / 03-09`）

- **三池一体**：线索池 / 客户池（含单位-个人双轨、6 角色决策链）/ 商机池（7 阶段 + 五维质检），同一事实池按角色视图分权（`SALES 仅自己 / MANAGER 团队 / ADMIN 租户`，`withTenant` + `RLS + FORCE RLS` 硬隔离）
- **线索治理**：全渠道去重矩阵（`ACTIVE_PRIVATE/self/PUBLIC_POOL/EXISTING_CUSTOMER/DISCARDED`，API 侧 `201 duplicateSuspected` 不丢单）、两阶段确认 `confirmDuplicate`、公海自动回收（`LEAD_UNTOUCHED 7天 / LEAD_UNCONVERTED 30天 / CUSTOMER_INACTIVE 60天` + 3天保护期 + 临期预警 + 幽灵任务清理）
- **推进与留痕**：跟进 3 必填 30 秒闭环、智能跟进提炼（文本→ `suggestedType/Outcome/Objections/NextDays/cleanSummary`，人工确认落库）、任务三态（`OPEN/DONE`）与 `customer_id` 挂载
- **可解释评分**：13 字段加权（`EXISTS/CONTAINS/GT/GTE/IN` 等 8 类 operator）、自动触发（创建/补字段/跟进）、权重和截断 0-100、理由按 `sort_order` 拼接
- **智能分发**：来源/行业/地区/分数区间全条件路由（`lead-routing` 插件）
- **通知**：`TASK_OVERDUE / DUE_SOON / LEAD_ASSIGNED` 等，`(task_id,type)` 唯一约束 + `FOR UPDATE SKIP LOCKED` 防重入
- **商机归属**：在途商机锁客户、WON 业绩归属永不迁移、报价 `LineItems` 快照与总额回写事务守恒
- **治理**：销售配额与达成大盘、部门树、自定义角色、组织导入、离职交接钩子、CSV 导入、产品目录、合同/订单/交付项目/回款/发票/ASC606 排期（含财务脱敏与审计）

### AI 能力（`docs/18 / 20 / 21`）

- **六 Agent 真上岗**（`src/core/ai-hub/agents/*.ts`）：晨会副驾驶（今日三件事 + 证据 + 一键建任务）、销冠解构、企业画像、赢单/输单归因、增量与变现、管线健康巡检；统一 `runAgentLoop` 持久化 `ai_agent_traces`（`rounds/tools_used/outcome/tokenUsage`）
- **马具三层**（`docs/21`）：工具层（`service → AgentTool`）、循环层（ReAct 推理→调工具→观察→再推理）、护栏层（RLS 租户隔离 / `timingSafeEqual` 鉴权 / 8 轮上限 + usage 计量 / 动作确认闸门 / `<customer_data>` 脱敏）
- **诚实与降级**：样本 `N<20` 强制低置信度标注、证据链引用必填、无 `API Key` 或超时自动降级内置规则、`is_ai_copilot_enabled=false` 时 `fail-closed` 零外发
- **学习飞轮**：`采纳/忽略/推翻 → ai_agent_learning_logs → 周度提炼 → 注入下周巡检与打法推荐`，同租户独有骑术
- **知识库**：企业 RAG 分块与检索（向量检索规划中，当前为结构化检索 + 文件解析）

### 插件框架（`docs/13`）

- **框架完整开源**：`src/plugin-kit/` 提供 `definePlugin` 契约、7 个 UI 挂载点枚举、`registry` 装配点、启停表 `plugin_registry`、多副本原子限流表 `plugin_rate_limits`、离职交接钩子注册表
- **白名单**：`ctx.core.createLead` 是插件写核心的唯一入口；`core` 侧另有 `PluginFactsProvider` 接口（默认返回空事实，插件可注册真实提供者）
- **空框架降级已被行为级测试锁定**（`tests/integration/oss-core-plugin-framework-integrity.test.ts`、`tests/integration/plugin-facts-provider.test.ts`）：插件缺席时导航无幽灵入口、挂载点与设置分区为空、AI 工具与晨检报告的插件事实段落为空且不报错
- **7 个业务插件为闭源组件**，其实现、数据表与迁移不在本仓库；`docs/13` 作为框架契约的设计依据保留

---

## 文档地图

### 先读这两份

| 文档 | 为什么先读 |
|---|---|
| [00 范围契约](./docs/00-SCOPE-CONTRACT.md) | **根文档**。定义成功标准、不做什么、以及新需求凭什么才能进 |
| [01 产品定位](./docs/01-PRODUCT-OVERVIEW.md) | 我们在给谁解决什么问题 |

### 产品文档（PRD 主体）

| 文档 | 内容 |
|---|---|
| [01 产品定位与价值](./docs/01-PRODUCT-OVERVIEW.md) | 目标用户、要解决的问题、核心价值、V1 边界 |
| [02 角色画像与真实场景](./docs/02-USERS-AND-SCENARIOS.md) | 三个角色的一天、关键场景剧本 |
| [03 功能规格：线索管理](./docs/03-FEATURE-LEAD.md) | 线索录入、去重、分配、状态流转、检索 |
| [04 功能规格：跟进与任务](./docs/04-FEATURE-FOLLOWUP.md) | 记跟进、下一步任务、超时判定、今日工作台 |
| [05 功能规格：智能评分](./docs/05-FEATURE-SCORING.md) | 评分规则、自动触发、理由生成、销售反馈 |
| [18 AI 销售教练](./docs/18-FEATURE-AI-SALES-COACH.md) | 推进质检、下一步建议、赢单复盘与团队打法 |
| [06 功能规格：客户管理](./docs/06-FEATURE-CUSTOMER.md) | 线索转客户、客户档案、联系人、时间线 |
| [07 功能规格：商机管理](./docs/07-FEATURE-OPPORTUNITY.md) | 商机创建、阶段推进、赢单丢单、风险识别 |
| [08 功能规格：通知提醒](./docs/08-FEATURE-NOTIFICATION.md) | 通知类型、触发规则、收件箱、未读 |
| [09 功能规格：设置与权限](./docs/09-FEATURE-ADMIN.md) | 用户管理、角色权限、评分规则配置、插件开关 |
| [10 页面与交互规格](./docs/10-UI-SPEC.md) | 三个业务池、三类角色视图、四态、校验文案、响应式 |

### 技术文档

| 文档 | 内容 |
|---|---|
| [11 领域模型与数据字典](./docs/11-DOMAIN-AND-DATA.md) | 对象关系、多租户隔离、完整字段规格、索引、RLS |
| [12 接口规格](./docs/12-API-SPEC.md) | Server Actions、Route Handlers、错误码 |
| [13 插件契约](./docs/13-PLUGIN-CONTRACT.md) | 核心白名单 API、UI 挂载点、插件数据规范 |
| [14 技术架构](./docs/14-TECH-ARCHITECTURE.md) | 选型、目录结构、模块边界、定时任务 |

### 工程规范

| 文档 | 内容 |
|---|---|
| [15 开发规范](./docs/15-DEV-STANDARDS.md) | 编码、命名、Git、安全、评审清单 |
| [16 测试规范与用例](./docs/16-TEST-PLAN.md) | 测试哲学、三类必须测试、用例清单 |
| [17 交付计划与验收](./docs/17-DELIVERY-PLAN.md) | 阶段划分、每阶段验收、V1 总验收 |
| [19 容量基线与复现](./docs/19-CAPACITY-BASELINE.md) | 容量数据生成、P95/EXPLAIN 复现方法与当前证据（smoke/1% 热缓存通过，未宣称百万级达标） |
| [20 产品全景与业务规则手册](./docs/20-PRODUCT-TUTORIAL-AND-BUSINESS-RULES-MANUAL.md) | L2C 全景、冲突矩阵、SOP、Analytic 看板、安全合规 |
| [21 AI Agent 马具战略](./docs/21-AI-AGENT-HARNESS-STRATEGY.md) | 马具三层、认知金字塔、自治阶梯与学习飞轮 |
| [22 部署运维手册](./docs/22-DEPLOYMENT-OPERATIONS.md) | **新增**。双模式差异、环境变量逐项表、首次启动、定时任务双方式、备份恢复（含 20h 补跑与临时库演练）、升级/回滚与故障排查 |
| [23 产品介绍一页纸](./docs/23-PRODUCT-INTRODUCTION.md) | **新增**。对外克制版定位、差异化、功能导览与架构亮点 |

---

## 技术栈

```
Next.js (App Router) + TypeScript (strict)
PostgreSQL 17 + Drizzle ORM + Row Level Security (FORCE RLS)
Tailwind CSS
```

多租户 **共享库 + 行级隔离（RLS）**，`withTenant` 事务内 `set_config('app.tenant_id', ..., true)`，应用角色 `salescrm` 非 Owner，策略静默失效用 `FORCE` 兜底；`tenants` 表不启用 RLS 供登录/巡检枚举。

---

## 质量门径

### 如何跑

```bash
pnpm typecheck                  # tsc --noEmit，0 errors
pnpm lint                       # tsx scripts/check-layer-boundary.ts + eslint .  （0 errors, 9 warnings 当前基线）
pnpm test                       # 需 PG 已起；prepare-test-db.ts 自动建 *_test 库并迁移，77 文件 / 545 用例
pnpm test:unit                  # 仅单元（毫秒级，纯函数）
pnpm test:integration           # 仅集成（真实 PG + RLS，必须）
pnpm build                      # next build（standalone 产物供生产镜像）
```

`pnpm test` 串联 `prepare-test-db.ts`，强制 `TEST_DATABASE_URL / TEST_MIGRATION_DATABASE_URL` 同库且以 `_test` 结尾，拒绝触碰开发库。

### 分层门禁

| 门禁 | 命令 | 判定 |
|---|---|---|
| 类型 | `pnpm typecheck` | 0 错误方可提交/发布 |
| 分层 | `pnpm lint:boundary`（`lint` 已含） | `core`/`lib` 不 import `@/plugins`，且不出现任何 `plugin_*` 业务插件表字样；`db/client.ts` 仅 `core/tenant` 可引 |
| 行为 | `pnpm test` | 租户隔离（每表至少 1 条泄漏测试）、业务规则穷举、闭环端到端三链路全绿 |
| 容量 | `pnpm capacity:generate / benchmark` | 工具链 + smoke + 1% 热缓存已证据化，未达 100%（100万客户/500万线索/5000万跟进）前不宣称达标 |

提交前必跑：`pnpm typecheck && pnpm lint && pnpm test`（见 `docs/15 11 章`）。

---

## 三条硬性约定

1. **范围** — 任何不在 [00 范围契约](./docs/00-SCOPE-CONTRACT.md) 第 3 节的功能，进入前必须过第 6 节准入规则，并在变更日志留痕
2. **验证** — 每个阶段结束必须 `typecheck` + `test` + 浏览器实测，三者缺一不算完成
3. **提交** — 阶段完成即提交，不攒大提交；数据库迁移与使用它的代码在同一次提交

---

## 开发阶段速览

| 阶段 | 产出 | 估时 |
|---|---|---|
| 0 工程骨架 | 能启动、能登录、租户隔离生效 | 1-2 天 |
| 0.5 池化数据契约 | 三个池的表边界、旧模型迁移演练、索引和容量基线 | 3-5 天 |
| 1 线索池与跟进 | 能录线索、能跟进，销售和主管从同一线索池工作 | 3-4 天 |
| 2 评分与角色工作台 | 系统告诉销售先跟谁，主管看到团队异常 | 2-3 天 |
| 3 通知 | 超时了销售知道 | 1-2 天 |
| 3.5 线索工作台试用 | 非开发者真实销售验证线索录入、跟进、任务和提醒可用；未通过则停止扩建 | 5 天 |
| 4 客户与商机 | 线索转客户转商机全链路 | 3-4 天 |
| 4.4 三池角色视图收口 | 销售、主管、管理员从同一事实池高效工作 | 2-3 天 |
| 4.5 AI 销售教练底座 | 自动发现推进缺口并给出有证据的下一步 | 3-4 天 |
| 4.6 外部 API 进线 | 多渠道线索复用同一创建、去重和评分链路 | 2 天 |
| 4.7 赢单复盘与打法 | 审核真实赢单样本并形成可复用方法 | 3-4 天 |
| 5 插件机制 | 接口跑通 + 表单插件验证 | 3-4 天 |
| 6 完整 V1 价值试用 | 三池、通知、AI 质检和打法链路全部可用后，真实销售验证完整价值 | 5 天起 |

详见 [17 交付计划](./docs/17-DELIVERY-PLAN.md)。
