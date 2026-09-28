# 接口规格

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

## 1. 风格约定

| 场景 | 方式 | 位置 |
|---|---|---|
| 应用内的读 | Server Component 直接查询 | 页面组件内 |
| 应用内的写 | **Server Action** | `src/core/<模块>/actions.ts` |
| 对外公开接口 | **Route Handler** | `src/app/api/public/*` |
| 定时任务入口 | Route Handler | `src/app/api/cron/*` |

**为什么不全做 REST**：应用内调用走 Server Action 可以省掉一整层 fetch 封装和类型同步，且类型从服务端直接推到客户端。对外接口才需要稳定的 HTTP 契约。

---

## 2. 通用约定

### 2.1 Server Action 签名范式

```ts
// 每个 action 都遵循这个形状
async function actionName(input: Input): Promise<Result<Output>>

type Result<T> =
  | { ok: true;  data: T }
  | { ok: false; code: ErrorCode; message: string; field?: string }
```

**不抛异常给调用方**（除非是真正的系统故障）。业务失败用 `ok: false` 返回，前端据此展示。

### 2.2 每个 Action 必做的四件事

```
① 校验会话 → 拿到 TenantContext（tenantId / userId / role）
② 校验权限 → 角色 + 数据归属（见 09 权限矩阵）
③ Zod 校验入参 → 失败返回 VALIDATION_ERROR + field
④ 在 withTenant() 内执行 → RLS 生效
```

**任何一步缺失都是安全漏洞。**

### 2.3 分页

游标分页，不做页码跳转。

```ts
type PageInput  = { cursor?: string; limit?: number }   // limit 默认 20，上限 100
type PageOutput<T> = { items: T[]; nextCursor: string | null }
```

游标 = `base64(sortKey + '|' + id)`；`sortKey` 是当前排序字段的规范化值，和 `id` 一起组成稳定边界。切换 `sort` 或筛选条件后必须丢弃旧游标，不能跨查询复用。

> 业界实践中已确认的问题：PostgreSQL 微秒时间戳与 JavaScript 毫秒时间戳精度不一致，导致游标分页出现重复行。**游标必须带 id 做二级排序。**

### 2.4 幂等

写操作默认**不保证**幂等。前端负责防重复提交（提交中禁用按钮）。

例外：通知生成有唯一约束兜底，重复插入静默忽略。

### 2.5 三个业务池的查询契约

页面加载器和查询服务从同一套 `leads`、`customers`、`opportunities` 事实表读取数据：

- SALES 的负责人范围、MANAGER 的团队范围、ADMIN 的租户范围由服务端会话决定，客户端不得传入 `role` 或任意 `tenantId`；
- `filter`、`sort`、`cursor` 可以由客户端传入，但必须经过枚举校验；
- 池列表返回当前状态和固定摘要，不返回全量活动、状态历史或审计记录；
- 固定口径数量随列表响应或独立 summary 查询返回，禁止客户端为每个标签分别请求全表计数；数量最多读取 `ceiling + 1` 条，超过 ceiling 时以 `ceiling + 1` 作为截断标记，页面显示 `ceiling+`，不得伪装成精确总数；
- 详情历史使用游标分页，默认 20 条；禁止一次返回对象全部历史；
- 主管工作台的指标只返回数量和目标筛选条件，点击后进入对应业务池，不返回另一套对象副本。

### 2.6 统一线索创建服务的负责人规则

四个进线入口复用同一套校验、查重、评分和审计编排，但负责人由可信入口决定：

| 入口 | `owner_user_id` | 首次响应任务 |
|---|---|---|
| 手工 | SALES/MANAGER 默认当前用户；ADMIN 必须指定 active 的 SALES/MANAGER | 有负责人，创建 |
| CSV / 表单 / 外部 API | `null`，客户端和插件均不可指定 | 不创建，分配时补建 |

核心服务只有在 `owner_user_id IS NOT NULL` 时创建 `FIRST_RESPONSE`。这个条件属于核心编排，不允许各入口自行实现不同版本。

---

## 3. 错误码表

| 错误码 | HTTP | 用户可见文案 | 何时返回 |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | 请先登录 | 无有效会话 |
| `FORBIDDEN` | 403 | 你没有权限执行此操作 | 角色或数据归属不符 |
| `NOT_FOUND` | 404 | 内容不存在或已被删除 | 对象不存在/已删/跨租户 |
| `VALIDATION_ERROR` | 400 | （按字段返回具体文案） | Zod 校验失败 |
| `DUPLICATE_PHONE` | 409 | 该手机号已存在 | 联系人手机号冲突 |
| `INVALID_TRANSITION` | 409 | 当前状态不允许此操作 | 状态机非法转换 |
| `CONFLICT` | 409 | 数据已被他人修改，请刷新后重试 | 并发冲突 |
| `RATE_LIMITED` | 429 | 操作过于频繁，请稍后再试 | 登录失败锁定等 |
| `INTERNAL_ERROR` | 500 | 系统出错了，请稍后重试 | 未预期异常 |
| `IDEMPOTENCY_CONFLICT` | 409 | 幂等键已用于另一份数据 | 相同 key 对应不同载荷 |

**跨租户访问返回 `NOT_FOUND` 而不是 `FORBIDDEN`** —— 不泄露"这个 id 存在但不属于你"这一信息。

---

## 4. Server Actions

### 4.1 认证

#### `login(input)`

| | |
|---|---|
| 入参 | `{ email: string; password: string }`；email 先 `trim + lower` |
| 出参 | `{ userId: string; tenantId: string; role: Role }` |
| 权限 | 无需登录 |
| 错误 | `VALIDATION_ERROR` / `UNAUTHENTICATED`（统一文案"邮箱或密码不正确"）/ `RATE_LIMITED` |

**执行顺序**：

```
① email = email.trim().toLowerCase()
② 调 auth_lookup_user(email)          ← 专用 BYPASSRLS 属主持有的 SECURITY DEFINER 函数，见 11 文档 4.2.1
     不是 withoutTenant()，那个绕不过 RLS
③ 无记录 → UNAUTHENTICATED（文案与密码错误一致，不透露邮箱是否存在）
④ locked_until > now → RATE_LIMITED
⑤ bcrypt 比对密码
     失败 → withTenant 更新 failed_login_count；达 5 次设 locked_until = now + 15min
⑥ user.status ≠ ACTIVE → "该账号已停用，请联系管理员"
⑦ 读 tenants（该表无 RLS），status ≠ ACTIVE → "该企业账号已停用"
⑧ withTenant 重置 failed_login_count = 0
⑨ 签发 JWT，payload 含 { userId, tenantId, role, sessionVersion }
```

**租户解析**：邮箱**全局唯一**（见 [11](./11-DOMAIN-AND-DATA.md) 4.2），按 email 即可唯一定位用户及其租户。

#### 会话校验（每个请求）

```
① 验证 JWT 签名与有效期，取 { userId, tenantId, sessionVersion }
② 在 requireSession() 内执行 withTenant(tenantId)
③ 按 (users.id = userId AND users.tenant_id = tenantId) 查询当前 role / status / session_version
④ 查不到用户、status ≠ ACTIVE、或版本不一致 → 401，跳登录页
⑤ 返回数据库当前 role 供 requireRole() 使用；不信任 JWT 中可能过期的 role
```

**这是"停用用户后现有会话立即失效"的实现方式。** JWT 无状态，不做版本比对就做不到立即失效。

#### `logout()`

清除 Cookie。无入参无出参。

---

### 4.2 线索

#### `createLead(input)`

| | |
|---|---|
| 入参 | `{ contactName, contactPhone, contactEmail?, companyName?, title?, note?, ownerUserId?, confirmDuplicate?: boolean }` |
| 校验 | 见 [03](./03-FEATURE-LEAD.md) 3.2 字段表 |
| 权限 | 所有角色；SALES 负责人固定为自己，MANAGER 可指定 active SALES/MANAGER，ADMIN 必须指定 active SALES/MANAGER |
| 出参 | `{ created: false; duplicateOf: { leadId, contactName, companyName, ownerName } }` 或 `{ created: true; leadId: string }` |
| 副作用 | 创建手工线索 → 自动评分 → **有负责人时**建 `FIRST_RESPONSE` 任务（+24h）→ 审计；无负责人时留在未分配池，不建任务 |

**两阶段确认**：首次调用命中重复且 `confirmDuplicate !== true` 时，只返回 `created: false`，**不得写入线索、任务、评分或审计**。用户选择「仍然创建」后，以相同输入加 `confirmDuplicate: true` 再调用；选择「查看已有线索」则直接跳转。导入和公开表单使用各自接口，不走这条人工确认分支。

#### `updateLead(input)`

| | |
|---|---|
| 入参 | `{ leadId, contactName?, contactPhone?, contactEmail?, companyName?, title?, note? }` |
| 权限 | 负责人 / MANAGER / ADMIN |
| 副作用 | 手机号变更 → 重新查重；关键字段变更 → 重新评分 |
| 错误 | `NOT_FOUND` / `FORBIDDEN` / `VALIDATION_ERROR` |

#### `getLeadDetail(input)`

| | |
|---|---|
| 入参 | `{ leadId: string }` |
| 权限 | 负责人 / MANAGER / ADMIN |
| 出参 | `{ lead, statusHistoryPage, activitiesPage, openTask, possibleDuplicates[] }`，历史默认各 20 条并返回 `nextCursor` |
| 排序 | `statusHistory`、`activities` 均按时间倒序 |
| 错误 | 无权查看也返回 `NOT_FOUND`，不泄漏对象是否存在 |

#### `assignLead(input)`

| | |
|---|---|
| 入参 | `{ leadId: string; assigneeUserId: string }` |
| 权限 | MANAGER / ADMIN |
| 副作用 | 更新 owner → 生成 `LEAD_ASSIGNED` 通知 → **若无 OPEN 任务则创建 `FIRST_RESPONSE`（`due_at = now + 24h`）** → 审计 |

> **首次响应任务在这里创建，不在线索创建时。** 未分配的线索没有负责人，
> 任务的 `assignee_user_id` 非空，且"超时了通知谁"无解。见 [03](./03-FEATURE-LEAD.md) 3.4。

#### `assignLeadsBulk(input)`

| | |
|---|---|
| 入参 | `{ leadIds: string[]; assigneeUserId: string }`，**上限 50** |
| 权限 | MANAGER / ADMIN |
| 出参 | `{ succeeded: number; failed: Array<{ leadId, code }> }` |
| 说明 | 部分失败不回滚，逐条报告 |

#### `qualifyLead(input)`

| | |
|---|---|
| 入参 | `{ leadId: string; note: string }`（note ≤ 200，必填"确认了什么需求"） |
| 权限 | 负责人 / MANAGER / ADMIN |
| 前置 | status = `CONTACTED` |
| 错误 | `INVALID_TRANSITION` |

#### `discardLead(input)`

| | |
|---|---|
| 入参 | `{ leadId; reason: DiscardReason; note?: string }` |
| 校验 | `reason = OTHER` 时 `note` 必填 |
| 前置 | status ≠ `CONVERTED` |
| 副作用 | status → `DISCARDED`，取消 OPEN 任务，审计 |

#### `restoreLead(input)`

| | |
|---|---|
| 入参 | `{ leadId: string }` |
| 权限 | **MANAGER / ADMIN** |
| 前置 | status = `DISCARDED` |
| 副作用 | status → `NEW`；有负责人时创建 `FIRST_RESPONSE`（+24h）；写状态记录和审计 |

#### `mergeLead(input)`

| | |
|---|---|
| 入参 | `{ sourceLeadId: string; targetLeadId: string }` |
| 权限 | 负责人 / MANAGER / ADMIN |
| 副作用 | 源线索的 activities 挪到目标 → 源 status → `DISCARDED` → 审计（**不可逆**） |

#### `importLeadsPreview(input)` / `importLeadsCommit(input)`

| | 预览 | 提交 |
|---|---|---|
| 入参 | `{ fileContent: string }`（≤2MB，≤1000 行） | `{ rows: ParsedRow[]; skipDuplicates: boolean }` |
| 出参 | `{ valid[], duplicates[], errors[] }` | `{ created: number; skipped: number; failed: number }` |
| 权限 | MANAGER / ADMIN | 同 |

编码支持 UTF-8 与 GBK，自动剥离 BOM。

---

### 4.3 跟进与任务

#### `logActivity(input)`

**最高频的写操作，性能目标 P95 < 300ms。**

| | |
|---|---|
| 入参 | `{ leadId?, customerId?, opportunityId?, type, outcome?, summary, occurredAt?, nextFollowUpAt? }` |
| 校验 | `type ≠ NOTE` 时 `outcome` 必填；`summary` 1-200 字；`nextFollowUpAt` 不早于现在 |
| 权限 | 关联对象的负责人 / MANAGER / ADMIN |
| 副作用（原子） | ① 写 activity ② 线索 `NEW → CONTACTED` ③ 完成当前 OPEN 任务 ④ 有 `nextFollowUpAt` 则建 `FOLLOW_UP` 任务 ⑤ 重新评分 ⑥ 审计 |

**④ 的任务归属**：按 activity 挂在哪个对象，任务就挂哪个对象——
线索上的跟进 → 任务挂 `lead_id`；客户上的跟进 → 任务挂 `customer_id`；商机上的 → 挂 `opportunity_id`。
`assignee_user_id` = 该对象的负责人。

**商机例外**：不允许普通跟进永久消除阶段监控。未填 `nextFollowUpAt` 时保留现有 `STAGE_PUSH`；若完成的是 `FOLLOW_UP`，恢复一个截止时间为 `stage_entered_at + 当前阶段 SLA` 的 `STAGE_PUSH`。填写了下次时间时，当前任务切换为唯一 OPEN 的 `FOLLOW_UP`。推进/回退阶段再切回新阶段的 `STAGE_PUSH`。

> 转客户后线索已是 `CONVERTED` 终态，后续跟进都挂在客户上，
> 因此 `tasks` 必须有 `customer_id` 列（见 [11](./11-DOMAIN-AND-DATA.md) 4.7）。

#### `rescheduleTask(input)`

| | |
|---|---|
| 入参 | `{ taskId: string; dueAt: Date }` |
| 校验 | `dueAt` 不早于现在 |
| 权限 | 执行人 / MANAGER / ADMIN |

---

### 4.4 客户

#### `convertLeadToCustomer(input)`

| | |
|---|---|
| 入参 | `{ leadId, customerName, industry?, region?, size?, contactName, contactPhone, contactEmail?, contactTitle?, linkToExistingCustomerId?, opportunityName, expectedAmount, expectedCloseAt, demandNote }` |
| 前置 | 线索 `status = QUALIFIED` 且已有负责人；商机字段合法 |
| 权限 | 负责人 / MANAGER / ADMIN |
| 出参 | `{ customerId: string; opportunityId: string }` |
| 副作用 | 建/关联 customer + 主 contact → 线索 `CONVERTED` + 状态历史 → 建 `DISCOVERY` 商机 + 初始阶段历史 → 写不可变 `lead_conversions` → 切换任务 → 审计 |

**`linkToExistingCustomerId` 非空时**：不建新客户和联系人，服务端必须复核该客户确实包含同手机号联系人。SALES 只能关联自己负责的客户；MANAGER / ADMIN 可关联当前租户任一客户。本次转化商机继承客户负责人。

**手机号已存在但未提供合法 `linkToExistingCustomerId`**：返回 `DUPLICATE_PHONE`，不得写入。“仍以相同手机号创建新客户”不是合法路径。

**事务与并发**：上述全部副作用在单事务内完成；任何失败全部回滚。更新线索使用 `status = QUALIFIED` 条件保护，并由 `lead_conversions` 的租户内唯一约束兜底；影响行数为 0 或唯一约束冲突返回 `CONFLICT`，不得产生第二个客户或转化商机。

#### `updateCustomer` / `deleteCustomer`

- `deleteCustomer` 前置：无进行中商机，否则 `INVALID_TRANSITION`
- 软删除

#### `addContact` / `updateContact` / `deleteContact` / `setPrimaryContact`

- 手机号租户内唯一 → `DUPLICATE_PHONE`
- 删除唯一联系人 → `INVALID_TRANSITION`
- 删除主联系人 → `INVALID_TRANSITION`（须先指定新主）
- `setPrimaryContact` 在同一事务内把原主降级

---

### 4.5 商机

#### `createOpportunity(input)`

| | |
|---|---|
| 入参 | `{ customerId, name, stage, primaryContactId, expectedAmount?, expectedCloseAt?, demandNote? }` |
| 校验 | `stage` 非终态；`expectedAmount ≥ 0`；`expectedCloseAt` 不早于今天 |
| 副作用 | 建商机 → 写 `null → stage` 历史 → 建 `STAGE_PUSH` 任务（按阶段时限）→ 审计 |

#### `advanceStage(input)` / `revertStage(input)`

| | |
|---|---|
| 入参 | `{ opportunityId, toStage, note, expectedAmount?, expectedCloseAt? }` |
| 校验 | **只能相邻**；`note` 必填 ≤ 200 |
| 错误 | 跳级 / 终态 → `INVALID_TRANSITION` |
| 副作用 | 更新 stage + `stage_entered_at` → 完成旧 `STAGE_PUSH` → 建新 `STAGE_PUSH` → 写阶段历史 → 审计 |

推进/回退必须携带调用时看到的 `fromStage`（或等价版本条件），服务端条件更新。并发导致条件不匹配时返回 `CONFLICT`，整个事务零写入。

#### `winOpportunity(input)`

| | |
|---|---|
| 入参 | `{ opportunityId, actualAmount, actualCloseAt, note? }` |
| 前置 | **stage 必须 = `NEGOTIATION`** |
| 副作用 | stage → `WON`，取消所有 OPEN 任务，审计 |

#### `loseOpportunity(input)`

| | |
|---|---|
| 入参 | `{ opportunityId, reason: LostReason, note? }` |
| 校验 | `reason = OTHER` 时 `note` 必填 |
| 前置 | 非终态 |
| 副作用 | stage → `LOST`，取消所有 OPEN 任务，审计 |

---

### 4.6 评分

#### `submitScoreFeedback(input)`

| | |
|---|---|
| 入参 | `{ leadId: string; verdict: 'ACCURATE' \| 'INACCURATE' }` |
| 权限 | 所有角色 |
| 副作用 | upsert `score_feedback`（同人同线索覆盖）；**不改分数** |

> **V1 没有「全量重算」。**
> 原设计写的是"异步执行，完成后通知"，但 [14](./14-TECH-ARCHITECTURE.md) 明确不引入队列，
> 也没有分批任务模型——那是一张开不出的支票。
>
> 现状是可接受的：改规则后**新评分用新规则，历史分数不变**（见 [05](./05-FEATURE-SCORING.md) 8）。
> 而线索只要有任何更新或跟进，就会自动重算，历史数据会自然收敛。
>
> 真需要全量重算时再走范围契约第 6 节，那时一并设计分批与断点续跑。

---

### 4.7 通知

#### `markNotificationRead(input)` / `markAllNotificationsRead()`

| | |
|---|---|
| 权限 | 仅本人（`user_id = ctx.userId`） |
| 副作用 | 写 `read_at` |

---

### 4.8 设置

#### `createUser` / `updateUser` / `disableUser` / `resetUserPassword`

| | |
|---|---|
| 权限 | **ADMIN** |
| 校验 | 邮箱先 `trim + lower`，并且大小写不敏感地**全局唯一**（跨租户）；密码 ≥ 8 位含字母数字 |
| 禁止 | 停用最后一个 ADMIN、修改自己的角色、停用自己 → `INVALID_TRANSITION` |
| 副作用 | `disableUser` / `resetUserPassword` 使该用户所有会话失效 |

#### `createScoreRule` / `updateScoreRule` / `deleteScoreRule` / `reorderScoreRules`

| | |
|---|---|
| 权限 | **ADMIN** |
| 校验 | `label` ≤ 30 字必填；`weight` -100~100；`GT/GTE` 仅数值字段；`IN` 值非空 |
| 生效 | 立即对新评分生效，**不追溯重算** |

#### `toggleFormCapturePluginAction(input)`

| | |
|---|---|
| 入参 | `{ enabled: boolean }`；插件键由服务端固定为 `form-capture` |
| 权限 | **ADMIN** |
| 副作用 | 插入或更新 `plugin_registry`，数据保留；导航和对象挂载点随刷新生效 |

#### `createFormCaptureFormAction(input)` / `publishFormCaptureFormAction(input)`

| | |
|---|---|
| 权限 | **MANAGER / ADMIN**；每个 Action 内重新认证，服务层再次鉴权 |
| 创建入参 | `{ name, schema }`；schema 固定版本 1、2-30 个字段、只允许 8 类字段，姓名和手机号为必填映射 |
| 发布入参 | `{ formId }`；只能发布当前租户、当前插件的草稿 |
| 状态约束 | 插件停用时创建和发布均返回 `CONFLICT`；已发布定义不可原地更新 |
| 出参 | 仅返回公开管理页需要的表单定义，不返回 `tenantId/pluginId/createdByUserId` |

#### `createLeadSourceKey(input)` / `revokeLeadSourceKey(input)`

| | |
|---|---|
| 权限 | ADMIN |
| 创建出参 | `{ id, sourceKey, token }`，`token` 只返回一次 |
| 撤销 | `revoked_at = now()`，后续请求立即 401 |

### 4.9 AI 销售教练

#### `acceptSalesInsight(input)` / `dismissSalesInsight(input)`

采纳时由用户确认 `dueAt`，创建或改约对应对象唯一 OPEN 任务，并把建议置为 `ACCEPTED`。忽略必须提交枚举原因；两者均校验对象归属并写审计。

#### `reviewWinReview(input)` / `publishSalesPlaybook(input)` / `submitPlaybookFeedback(input)`

- 赢单复盘仅 MANAGER / ADMIN 可审核，生成失败、摘要为空或没有事实证据的草稿拒绝审核；
- 发布打法仅 MANAGER / ADMIN，且至少连接 3 个已审核赢单复盘；
- 已发布版本不可覆盖，只能创建下一版本；
- 推荐只返回当前阶段与客户结构化适用范围匹配、且未命中排除范围的最新一条；
- 推荐结果同时返回当前用户对该商机与打法的既有反馈，不返回其他用户的反馈；
- 反馈仅限可查看对应商机的用户，且打法必须仍与该商机匹配；`NOT_HELPFUL / NOT_APPLICABLE` 必须填写原因；
- 同一用户、商机、打法重复提交时覆盖原反馈，刷新详情后回显最新结论和原因。

---

## 5. Route Handlers

### 5.1 `POST /api/cron/scan-tasks`

定时任务入口，每 5 分钟由外部调用。

| | |
|---|---|
| 认证 | Header `X-Cron-Secret` 必须匹配 `CRON_SECRET`，否则 401 |
| 出参 | `{ tenantsScanned, overdueCreated, dueSoonCreated, cleaned, elapsedMs }` |
| 监控 | `elapsedMs > 30000` 记警告日志 |

#### 跨租户执行方式

RLS 会让"不带租户上下文的查询返回 0 行"，因此**不能直接全库扫描**。正确做法是逐租户循环：

```
① withoutTenant() 读 tenants 表，取 status = ACTIVE 的租户 id 列表
   （tenants 表不启用 RLS，见 11 文档 4.1；这是白名单调用点之一）

② for each tenantId:
     withTenant({ tenantId, ... }, async (tx) => {
       扫超时任务 → 生成 TASK_OVERDUE
       扫临近到期 → 生成 TASK_DUE_SOON
       清理 90 天前通知
     })

③ 单个租户失败只记日志，不中断其余租户
```

| 约束 | 做法 |
|---|---|
| 防重入 | 每个租户内 `SELECT ... FOR UPDATE SKIP LOCKED` |
| 单次上限 | 每租户 1000 条，超过下次继续 |
| 去重 | `notifications` 的 `(task_id, type)` 唯一约束兜底 |
| 隔离 | 单租户异常不影响其他租户 |

### 5.2 `POST /api/public/plugins/form-capture/:formId/submit`

表单插件的公开提交入口。详见 [13 插件契约](./13-PLUGIN-CONTRACT.md)。

| | |
|---|---|
| 认证 | 无（公开） |
| 限流 | 同 IP 每分钟 10 次 → `RATE_LIMITED` |
| 行为 | 先用窄函数 `public_lookup_published_form(formId)` 取得 tenantId；再进入 `withTenant(tenantId)`，同一事务内重新确认表单已发布 → 写原始 submission → 调绑定该事务的 `ctx.core.createLead`（`source = form:<formId>`，未分配、查重标记、评分、不建任务）→ 用返回的 `leadId` 写 submission link；任一步失败全部回滚 |
| 出参 | `{ ok: true }`（不回传 leadId，避免信息泄露） |

### 5.3 `POST /api/v1/leads`

外部系统单向进线。认证使用 `Authorization: Bearer <source token>`，必须带 `Idempotency-Key`。

入参：`{ externalId?, contactName, contactPhone, contactEmail?, companyName?, title?, note?, sourceLabel? }`。

处理：token hash 定位租户和来源 → 限流 → 校验幂等 → `withTenant` 调统一 `createLead` 核心服务 → 以未分配状态写入幂等结果。调用方不得传 `tenantId`、`ownerUserId`、`score` 或 `status`；未分配时不建任务，后续分配时补建。

返回：首次创建 `201 { leadId, duplicateSuspected }`；幂等重放 `200` 返回相同结果；无效或撤销 token 返回 `401`。

---

## 6. 插件服务端契约

V1 **不实现事件总线**。表单 Handler 已经同步拿到 `ctx.core.createLead()` 返回的 `leadId`，直接写 submission link 最小、可验证，并能与线索创建共享事务。完整定义见 [13 插件契约](./13-PLUGIN-CONTRACT.md)。

响应只在事务提交后返回 `{ ok: true }`。V1 没有队列、outbox 或后台 worker，因此禁止使用响应后的 fire-and-forget Promise 冒充“异步事件”。

`ctx.core` 必须由当前 tenant-scoped transaction 构造，内部复用同一个 `tx`，禁止自行打开第二个事务。

---

## 7. 接口清单速查

| 模块 | Actions |
|---|---|
| 认证 | `login` `logout` |
| 线索 | `createLead` `getLeadDetail` `updateLead` `assignLead` `assignLeadsBulk` `qualifyLead` `discardLead` `restoreLead` `mergeLead` `importLeadsPreview` `importLeadsCommit` |
| 跟进 | `logActivity` `rescheduleTask` `parseQuickFollowup` |
| 客户 | `convertLeadToCustomer` `updateCustomer` `deleteCustomer` `addContact` `updateContact` `deleteContact` `setPrimaryContact` |
| 商机 | `createOpportunity` `advanceStage` `revertStage` `winOpportunity` `loseOpportunity` `updateOpportunity` |
| 评分 | `submitScoreFeedback` |
| 通知 | `markNotificationRead` `markAllNotificationsRead` |
| AI 教练 | `acceptSalesInsight` `dismissSalesInsight` `reviewWinReview` `publishSalesPlaybook` `submitPlaybookFeedback` `recommendPlaybookForOpportunity` |
| 设置/插件 | `createUser` `updateUser` `disableUser` `resetUserPassword` `createScoreRule` `updateScoreRule` `deleteScoreRule` `reorderScoreRules` `toggleFormCapturePluginAction` `createFormCaptureFormAction` `publishFormCaptureFormAction` `createLeadSourceKey` `revokeLeadSourceKey` |

| 路径 | Route Handlers |
|---|---|
| `POST /api/cron/scan-tasks` | 定时扫描 |
| `POST /api/public/plugins/form-capture/:formId/submit` | 表单提交 |
| `POST /api/v1/leads` | 外部 API 进线 |

**合计 49 个 Action + 3 个 Route Handler。** 加接口要走 [产品概览](./01-PRODUCT-OVERVIEW.md) 第 6 节。
