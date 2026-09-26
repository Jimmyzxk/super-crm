# Super CRM

**为成交而生的开源 CRM。**

缩短销售周期，让有价值的线索不再被漏掉。

面向 B2B 销售团队的完整闭环：线索 → 客户 → 商机 → 成交，AI 在每一步给出可执行建议。

[![CI](https://github.com/Jimmyzxk/super-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/Jimmyzxk/super-crm/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-550%20passing-brightgreen.svg)](#质量保障)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791.svg)](https://www.postgresql.org/)

---

## 设计原则

传统 CRM 的信息流是单向的：销售录入，管理者查看。录入成本由一线承担，收益归管理层。这是 CRM 数据质量难以维持的结构性原因。

Super CRM 把顺序反过来：**先让销售获得价值，管理洞察是自然产物。**

<br>

| 传统 CRM | Super CRM |
|:---|:---|
| 打开看到列表，自己判断先跟谁 | 打开看到**今天该联系谁**，附评分理由 |
| 填 6 个下拉 + 写周报 | 只填**方式 / 结果 / 一句话**，约 30 秒 |
| 靠自己记性记住下次跟进 | 自动建任务并排期，到点提醒 |
| 线索跟丢了月底才发现 | 停滞自动预警，超时任务标红 |
| 赢单经验随人走而清零 | 赢单沉淀为**可复用打法** |

<br>

## 两个结果，如何实现

**缩短销售周期**

- 线索打分排序，优先跟进高价值客户，减少无效触达
- 商机阶段停滞自动预警：超过 SLA 天数（探索 7 天 / 方案与谈判 14 天）触发任务与通知
- 跟进节奏由系统排期，不依赖个人记性
- 经营分析追踪平均成交周期与赢单率，改进效果可量化

**减少线索流失**

- 首响 SLA：线索分配后 24 小时内未跟进自动提醒
- 公海回收：长期无人跟进的线索按规则（7 / 30 / 60 天）回收，避免烂在个人手里
- 冲突判定：重复与撞单在录入时拦截，不丢失既有跟进历史

<br>

## 谁受益，得到什么

### 销售 · 每天省 10–20 分钟

系统给出今天该做的三件事，每条附证据；跟进只填三个字段，结构化信息与下一步由系统自动完成。

> 每天少花在找线索、写记录上的时间，就是多出来见客户的时间。

### 主管 · 从"追问"到"看见"

团队推进状态随时可查：谁在停滞、哪个环节在漏、哪种客户赢面高。例会可以省下逐个追问的时间，直接讨论怎么解决已经暴露的问题。

> 问题在变成结果之前就被发现，而不是月底复盘时才追责。

### 企业 · 能力沉淀为资产

销冠的判断依据沉淀在系统里。获客渠道价值、商机瓶颈、收入构成都有数据可查，不必依赖汇报。人员流动时，方法和客户关系留得下来。

> 人走了，方法和客户关系还在。

<br>

## AI 能力

许多 CRM 的 AI 只是一个对话框，与业务数据互不相通，给出的建议往往无法执行。

Super CRM 的 AI 走完整 Agent 循环：**推理 → 调用真实业务工具 → 观察结果 → 再推理**。工具层直接复用业务 service，同一个问题的回答长这样：

> **商机「某智能装备 · 标准版订阅」停滞 23 天**
>
> **缺口**　决策人未接触（当前主联系人无采购 / 预算角色）
>
> **证据**　距上次跟进 23 天 · 阶段停留「方案沟通」· 报价行项目未配置
>
> **动作**　3 日内约见技术负责人，议题围绕方案落地路径
>
> **打法**　《高预算客户价值升维与快速锁单》，关联 3 个真实赢单样本

每句话都能追溯到数据库中的具体记录。

**六个常驻 Agent**

| Agent | 输出 |
|:---|:---|
| 晨会副驾驶 | 今天三件事，每条附证据与一键建任务 |
| 推进质检 | 缺口诊断：缺决策人 / 缺预算 / 缺时间线 / 无下一步 / 超期停滞 |
| 赢单 · 输单归因 | 从真实样本提炼为什么赢、为什么输 |
| 销冠解构 | 销冠客户画像与路径差异 |
| 企业画像 | 钱从哪来、谁在流失、增量在哪 |
| 管线健康巡检 | 风险商机与异常主动上报 |

**四条硬约束**

- 样本 < 20 条时，结论强制标注`方向性假设（低置信度，样本 N=x）`
- 页面不展示模型思维过程，只展示可核验的业务证据
- AI 总开关关闭时 `fail-closed`：零外发请求
- 无 Key / 超时 / 格式异常时降级内置规则，不编造答案

<br>

## 企业级能力

面向真实组织的权限、数据与合规需求。

| 维度 | 能力 |
|:---|:---|
| **数据隔离** | 多租户共享库 + PostgreSQL `FORCE ROW LEVEL SECURITY`，事务内强制租户上下文；每张业务表配隔离测试 |
| **权限体系** | 17 个权限位 · 自定义角色 · 部门树 · 角色/部门/本人三级数据范围 |
| **审计合规** | 30+ 类关键动作留痕（登录 / 权限变更 / Key 生命周期 / AI 采纳 / 数据变更），审计表仅可追加不可篡改 |
| **组织管理** | 组织架构批量导入 · 离职交接（线索 / 客户 / 商机自动转移）· 销售配额与达成大盘 |
| **数据进出** | CSV 批量导入（带去重与失败行隔离）· 外部 API 进线（密钥鉴权 + 限流 + IP 白名单） |
| **安全防护** | LLM 出网 SSRF 防护（DNS 绑定 + 重定向重验）· 传输加密 · 敏感字段脱敏 · 生产密钥强制校验 |
| **扩展能力** | 核心对插件零依赖，可停用任何模块而不影响主链路；支持按需上线 |

**容量与性能**：工具链、smoke（1000 客户 / 5000 线索 / 2 万跟进）与单租户 1% 热缓存已通过并留存证据（[docs/19](./docs/19-CAPACITY-BASELINE.md)）。**未宣称百万级达标**，大规模数据前请自行压测。

<br>

## 界面

<table>
<tr>
<td width="50%">

**线索池**
评分 · 时效 · 责任人，超时自动标红

<img src="./.github/screenshots/03-leads.jpg" alt="线索池">

</td>
<td width="50%">

**商机管理**
7 阶段推进 · 停滞预警 · 下一步待办

<img src="./.github/screenshots/04-opportunities.jpg" alt="商机管理">

</td>
</tr>
<tr>
<td width="50%">

**今日工作台**
每天先做什么，给出排序与依据

<img src="./.github/screenshots/02-today.jpg" alt="今日工作台">

</td>
<td width="50%">

**经营分析**
漏斗 · 赢单率 · 业绩趋势

<img src="./.github/screenshots/07-analytics.jpg" alt="经营分析">

</td>
</tr>
</table>

<sub>截图来自本仓库演示数据（`pnpm db:seed:demo` 一键生成），非设计稿。</sub>

<br>

## 快速开始

需要 **Node.js 22** · **pnpm 9.15.5** · **Docker**

```bash
git clone https://github.com/Jimmyzxk/super-crm.git && cd super-crm
cp .env.example .env      # 开发默认值可直接用
pnpm install
pnpm docker:dev           # 启动数据库 + 应用
pnpm db:seed:demo         # 可选：生成演示数据
```

访问 http://localhost:3000/login · 账号 `admin@example.com` / `password123`

> 生产部署（HTTPS 证书、环境变量、备份恢复、故障排查）见 **[部署运维手册](./docs/22-DEPLOYMENT-OPERATIONS.md)**

<br>

## 技术栈

`Next.js 16` · `React 19` · `TypeScript` · `PostgreSQL 17` · `Drizzle ORM` · `Tailwind CSS` · `Docker Compose`

<br>

## 质量保障

```bash
pnpm typecheck   # 类型检查
pnpm lint        # 分层门禁 + ESLint
pnpm test        # 550 条行为级测试
pnpm build       # 生产构建
```

**550 条测试全部是行为断言**：真数据库、真服务调用、真 HTTP handler，不使用"源码含某字符串"这类假测试。零 skip。

改代码时测试结果值得信任。分层门禁保证核心（`src/core`）不依赖插件（`src/plugins`），插件可自由替换或移除。

<br>

## 关于发行形态

本仓库是 **主代码开源 + 业务插件闭源** 的发行版。

| | |
|:---|:---|
| ✅ **包含** | 完整核心 CRM · AI Agent 体系 · 插件框架（契约 / 装配点 / 挂载点 / 启停表） |
| 🔒 **不含** | 7 个业务插件实现（合同 · 订单 · 交付项目 · BI 矩阵 · 获客表单 · 知识库 · 智能分发） |

**插件缺席时系统完整可用**：导航无幽灵入口、挂载点渲染为空、AI 报告的插件段落为空。核心链路不受影响，该降级行为有行为级测试锁定。

**挂载自己的插件**：在 `src/plugins/<name>/` 实现 `definePlugin({...})`，在 `src/plugin-kit/registry.ts` 的 `compiledPlugins` 里 import 并 push 即可，上游调用点无需改动。契约见 [插件契约](./docs/13-PLUGIN-CONTRACT.md)。

<br>

## 文档

[产品定位](./docs/01-PRODUCT-OVERVIEW.md) · [角色场景](./docs/02-USERS-AND-SCENARIOS.md) · [功能规格](./docs/03-FEATURE-LEAD.md) · [UI 规格](./docs/10-UI-SPEC.md) · [数据字典](./docs/11-DOMAIN-AND-DATA.md) · [接口规格](./docs/12-API-SPEC.md) · [插件契约](./docs/13-PLUGIN-CONTRACT.md) · [技术架构](./docs/14-TECH-ARCHITECTURE.md) · [测试规范](./docs/16-TEST-PLAN.md) · [容量基线](./docs/19-CAPACITY-BASELINE.md) · [AI 战略](./docs/21-AI-AGENT-HARNESS-STRATEGY.md) · [部署运维](./docs/22-DEPLOYMENT-OPERATIONS.md) · [产品介绍](./docs/23-PRODUCT-INTRODUCTION.md)

<br>

## 贡献

欢迎 issue 与 PR。开始前请读 [CONTRIBUTING.md](./CONTRIBUTING.md)，其中包含开发环境、分层与多租户安全规范、测试要求与提交约定。

所有 PR 需通过 `pnpm typecheck && pnpm lint && pnpm test`；新增业务逻辑需附行为级测试。

<br>

## 许可证

[AGPL-3.0-only](./LICENSE) © 2026 Super CRM contributors

**关键差异**：把本程序的修改版作为网络服务提供给他人使用时，必须向使用者提供修改版完整源码。自用或内部部署不受影响。
