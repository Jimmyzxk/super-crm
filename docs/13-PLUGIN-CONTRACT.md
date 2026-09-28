# 插件契约

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

## 0. 先说清楚这份文档的风险

**插件接口是在零真实用户的情况下设计的。这意味着它大概率有一部分是错的。**

因此本文档的设计目标如下：

> **用最小的接口面积，支撑一个真实插件跑通；错了容易改。**

三条自我约束：

1. **接口越少越好** —— V1 只有一个核心写入 API + 三个 UI 挂载点
2. **V1 自己写一个插件验证** —— 表单获客做成插件，不是核心
3. **不承诺稳定性** —— V1 阶段接口可随时改，不做版本兼容层

### 0.1 明确不做

- ❌ 插件热加载 / 运行时安装
- ❌ 插件商店 / 市场
- ❌ 第三方开发者文档 / SDK 发布
- ❌ 插件沙箱 / 权限隔离
- ❌ 插件版本兼容层 / 接口废弃策略
- ❌ 插件间依赖管理

> 业界实践最贵的错误就是"为想象中的未来建基础设施"——两套 projection 读模型，深度可观，交付零价值。以上每一条都是同类。**等有第二个客户、且需求真的不同时再说。**

---

## 1. 什么是插件

### 1.1 判定规则

> **卸载它，系统还能用吗？**
> - 不能用 → 核心
> - 能用 → 插件

### 1.2 核心 vs 插件

| | 核心 | 插件 |
|---|---|---|
| 客户间 | 都一样 | 各不相同 |
| 卸载后 | 系统不可用 | 系统仍可用 |
| 例子 | 线索、跟进、评分、通知、AI 销售教练 | 表单获客、短信、外部 CRM 双向同步 |

### 1.3 边界案例的判定（记录理由，防止反复）

| 能力 | 判定 | 理由 |
|---|---|---|
| 评分 | **核心** | 卸载后销售不知道先跟谁，闭环第 2 步断 |
| 站内通知 | **核心** | 卸载后超时无人知晓，闭环第 5 步断 |
| 基础报表 | 核心 | MANAGER 角色的最小需求 |
| 表单获客 | **插件** | 卸载后仍可手工录入 / CSV 导入 |
| 短信 / 邮件 / 企微 | 插件 | 各家服务商不同，非日常闭环必需 |
| 渠道归因 | 插件 | 只有投放的客户需要 |
| AI 销售教练 | **核心** | 只使用 CRM 事实、已审核打法和受控模型增强 |
| 自由聊天助手 | 插件/以后 | 模型和提示词因客户而异，且不承担核心闭环 |
| 外部 CRM 同步 | 插件 | 每家对接的系统不同 |
| 高级报表 | 插件 | 各家关心的指标不同 |

---

## 2. V1 的两个扩展面（全部）

```
扩展面 1：核心白名单 API —— 插件通过受控函数创建核心对象
扩展面 2：UI 挂载点      —— 插件往指定位置增加界面
```

**没有第三种。**

---

## 3. 扩展面一：核心写入白名单

### 3.1 ctx 提供什么

```ts
type PluginServerContext = {
  tenant: { tenantId: string; userId: string; role: Role }
  core: CoreWriteApi // 绑定当前 tenant-scoped transaction 的核心写入能力
}
```

### 3.2 核心写入白名单

插件**不能裸写核心表**，但某些插件必须能创建核心对象——例如表单插件的全部意义就是创建线索。

解法：`ctx.core` 暴露一组**经过完整业务校验的函数**，而不是数据库访问。

```ts
type CoreWriteApi = {
  /** 创建线索。走与手工录入完全相同的校验、查重、评分流程。 */
  createLead(input: {
    contactName: string
    contactPhone: string
    contactEmail?: string
    companyName?: string
    title?: string
    note?: string
  }): Promise<{ leadId: string; duplicateSuspected: boolean }>
}
```

**V1 只有这一个方法。** 加方法要走 [产品概览](./01-PRODUCT-OVERVIEW.md) 第 6 节。

插件不能传负责人、租户、状态、评分或 `source`。`source` 由宿主根据已校验的 `pluginKey/formId` 绑定；`ctx.core.createLead` 创建的线索保持未分配，只执行查重、评分和审计，不创建 `FIRST_RESPONSE`；主管分配后由核心服务补建任务。

### 3.3 为什么这样不破坏边界

| 担心 | 为什么不成立 |
|---|---|
| 插件绕过了核心规则？ | 不会。`createLead` 内部就是核心的创建流程，校验、查重、评分一个不少 |
| 插件能改核心数据？ | 不能直接写。只能通过白名单**创建**线索，不能改、不能删、不能碰其他对象 |
| 边界模糊了？ | 核心写入只允许调用明确列举的函数；V1 自有表事务能力的限制见第 8 节反馈记录 |

**判定规则不变**：卸载表单插件后，系统仍能手工录入线索 → 它仍然是插件。

**ctx 不提供**：核心表的直接写入、其他插件的数据、发送事件的能力、跨租户访问。

### 3.4 V1 为什么没有事件总线

表单 Route Handler 调 `ctx.core.createLead()` 后已经同步拿到 `leadId`，可直接写 `plugin_form_submission_links`。为这一个调用再建事件总线会引入无法兑现的投递、重试和事务边界承诺。

V1 没有队列、outbox 或 worker，因此：

- **不实现任何核心事件**，也不保留事件注册骨架
- 禁止在请求返回后用未等待的 Promise 做 fire-and-forget
- 将来出现第二个真实插件且确实需要响应核心变化时，必须走范围契约并同时定义投递保障、重试、幂等和失败语义

### 3.5 公开 Handler 如何取得 tenantId

公开表单请求没有会话，只有不可猜测的 UUID `formId`；而插件表启用了 RLS。直接查询 `plugin_form_definitions` 会返回 0 行，不能用 `withoutTenant()`。

表单插件迁移创建独立的 `salescrm_form_public NOLOGIN BYPASSRLS` 角色及 `SECURITY DEFINER` 函数：

```sql
CREATE FUNCTION public.public_lookup_published_form(p_form_id uuid)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT f.tenant_id
  FROM public.plugin_form_definitions AS f
  JOIN public.plugin_registry AS p
    ON p.tenant_id = f.tenant_id AND p.id = f.plugin_id
  JOIN public.tenants AS t ON t.id = f.tenant_id
  WHERE f.id = p_form_id
    AND f.status = 'PUBLISHED'
    AND p.plugin_key = 'form-capture'
    AND p.enabled = true
    AND t.status = 'ACTIVE'
$$;
```

权限要求与认证函数同级严格，但**角色分开**：函数属主只拥有该插件表必要列的读取权限；应用角色仅能 `EXECUTE`，不能 `SET ROLE`；函数、表、类型全部 schema 限定；`REVOKE ... FROM PUBLIC`。函数只返回已发布表单的 `tenantId`，不返回 schema 或提交数据。

取得 `tenantId` 后，Handler 必须进入 `withTenant(tenantId)` 并在同一事务内再次查询表单状态和 schema，再执行提交。查不到或已下线统一返回 `NOT_FOUND`。这次复查防止“定位后立即下线”的竞态。

---

## 4. 扩展面二：UI 挂载点

### 4.1 V1 挂载点全集（3 个）

| 挂载点 | 位置 | 典型用途 |
|---|---|---|
| `nav.main` | 主导航（核心导航下方，有分隔） | 表单插件加"获客表单"入口 |
| `lead.detail.panel` | 线索详情页侧栏 | 显示线索来自哪个表单、填了什么 |
| `settings.section` | 设置页分区 | 插件自己的配置界面 |

**加挂载点要走范围契约第 6 节。**

### 4.2 注册方式

```ts
export default definePlugin({
  key: 'form-capture',
  name: '表单获客',
  navigation: { label: '获客表单', path: '/p/form-capture' },
  leadDetailPanel: LeadSourcePanel,
  settingsSection: SettingsPanel,
})
```

### 4.3 UI 约束

| 约束 | 说明 |
|---|---|
| 路由前缀 | 插件页面统一挂 `/p/<plugin-key>/*`，不污染核心路由 |
| 只增不改 | 插件 UI **不能覆盖或修改核心 UI** |
| 渲染失败降级 | 挂载点渲染出错时不渲染该块，**不能白屏整页** |
| 视觉标识 | 插件导航项有分隔线，标明来自插件 |
| 设计铁律 | 插件 UI 同样遵守 [10](./10-UI-SPEC.md) 五条铁律 |

---

## 5. 插件的数据

### 5.1 表命名

`plugin_<key>_<name>`，例如：

```
plugin_form_definitions
plugin_form_submissions
plugin_form_submission_links
```

### 5.2 硬性规则

| 规则 | 原因 |
|---|---|
| **核心表不为插件预留字段** | 一旦预留，核心就被插件污染 |
| 插件关联核心对象时用自己的关联表 | 同上 |
| 插件表同样启用 RLS | 租户隔离无例外 |
| 插件迁移独立编号 | 卸载时可单独回滚 |
| 插件不得直接写核心表 | 只能通过 ctx 提供的受限能力 |

---

## 6. 插件加载

### 6.1 编译时显式注册

```
plugins/
  form-capture/
    index.ts          ← definePlugin(...)
    migrations/       ← 独立编号
    components/
```

`plugin-kit/registry.ts` 在构建时显式导入每个 `index.ts` 并注册。V1 不做运行时目录扫描；新增插件必须提交代码、通过类型检查和边界测试后重新构建。

### 6.2 租户级开关

`plugin_registry` 表控制某租户是否启用某插件。

**停用后**：
- 导航和业务对象 UI 挂载点不渲染
- 导航项消失
- **数据保留**（重新启用后还在）

`settings.section` 是唯一例外：ADMIN 仍能看到已编译插件的启停入口，否则停用后无法从产品界面重新启用。停用状态下不允许创建、发布或公开提交表单。

### 6.3 为什么不做热加载

热加载需要处理：代码隔离、依赖冲突、状态清理、安全沙箱。

**这些都是为第三方开发者准备的，而 V1 的插件全部由我们自己写。** 等真有第三方要写插件时再做。

---

## 7. V1 参照实现：表单获客插件

### 7.1 为什么必须写这一个

**插件接口的正确性只能由真实插件验证。** 不实现参照插件，接口设计无法得到检验。

选表单获客的原因：
- 最典型的"有的客户要、有的客户不要"
- 同时用到核心白名单 API + UI 挂载点 + 插件自有数据表 + 公开 Route Handler
- 业务价值已被业界实践验证

### 7.2 功能范围

```
建表单 → 发布公开页 → 访客提交 → 创建线索
```

**字段类型（8 种，不多）**：单行文本、手机号、邮箱、公司、单选、多选、下拉、隐私同意。

**明确不做**（对照 [00](./01-PRODUCT-OVERVIEW.md) 第 4 节）：条件显示、跳题、主题市场、资产库、欢迎页/成功页定制、倒计时、二维码、抽奖、短链。

> 业界实践的文档也写了"不做条件跳转"，然后做了。**这次如果要做，必须走准入规则。**

### 7.3 它怎么用两个扩展面

| 机制 | 用法 |
|---|---|
| `nav.main` | 加"获客表单"导航 |
| `lead.detail.panel` | 显示"这条线索来自哪个表单、填了什么" |
| `settings.section` | 插件开关和默认配置 |
| `ctx.core.createLead` | 创建线索并取得 `leadId` |
| 公开 Route Handler | `POST /api/public/plugins/form-capture/:formId/submit` |

公开 Handler 先通过 3.5 的窄函数取得 tenantId，再在**同一 tenant-scoped transaction** 中写原始 submission、调用绑定当前 `tx` 的 `ctx.core.createLead`、最后用返回的 `leadId` 写 submission link；任一步失败全部回滚。这样并发提交时每条 submission 都有确定关联，也不会产生“线索创建了但关联丢了”的半成品。

### 7.4 数据表

| 表 | 说明 |
|---|---|
| `plugin_form_definitions` | 表单定义（schema 存 jsonb）、发布状态 |
| `plugin_form_submissions` | 原始提交数据 |
| `plugin_form_submission_links` | 提交 ↔ Lead 的关联 |

### 7.5 验证标准（写完后必须回答）

1. **停用它，系统还能正常用吗？**（能 → 边界正确）
2. **接口够用吗？有没有为了实现它而临时加接口？**（加了 → 记入第 8 节）
3. **它有没有直接写核心表？**（有 → 边界被破坏）

---

## 8. 接口反馈记录

> 每次实现插件时，若发现现有接口不够用，记在这里。**这是判断"接口设计对不对"的唯一真实依据。**

| 日期 | 插件 | 缺什么 | 临时怎么解决的 | 是否该加进正式接口 |
|---|---|---|---|---|
| 2026-08-18 | 表单获客 | 插件 Server Actions 需要重新认证 | `plugin-kit` 增加窄包装 `requirePluginSession()` 和安全结果映射 | 是；所有认证插件都会需要 |
| 2026-08-18 | 表单获客 | 插件自有表需要租户事务，最小 `ctx` 未提供存储能力 | V1 第一方插件暂用 `withPluginTenantTransaction`；ESLint + 核心表 DML 扫描守住写边界 | 暂不扩成通用 `ctx.db`；出现第二个插件时再以真实用例收敛 |

---

## 9. 何时重新设计插件架构

出现以下任一情况，本文档需要重写：

- 第 8 节积累了 **3 条以上**"接口不够用"
- 出现**第二个真实客户**，且需求与第一个显著不同
- 有**第三方**要写插件

**在此之前，不主动优化插件架构。**

---

## 10. 验收清单

> **按 V1 实际实现范围验收**：0 个事件 + 3 个挂载点（`nav.main` / `lead.detail.panel` / `settings.section`）+ `ctx.core.createLead`。

**服务端事务**
- [x] submission、Lead、submission link 三者在同一事务中提交
- [x] 任一步故意抛错后三者都不留下半成品
- [x] 两条并发提交分别关联到自己的 submission 和 Lead
- [x] 无租户上下文裸查表单返回 0 行；窄函数只对已发布 formId 返回 tenantId
- [x] 窄函数属主是独立 `NOLOGIN BYPASSRLS` 角色，应用角色不能 `SET ROLE`
- [x] 窄函数定位后表单被下线时，事务内复查拒绝提交
- [x] 代码中没有响应后的 fire-and-forget 事件处理

**UI 挂载点**
- [x] `nav.main` 能注册并渲染，有插件视觉标识
- [x] `lead.detail.panel` 能注册并渲染
- [x] `settings.section` 能注册并渲染
- [x] 挂载点渲染出错时降级为不渲染，**页面不白屏**
- [x] 插件页面路由在 `/p/<key>/*` 下

**核心写入白名单**
- [x] `ctx.core.createLead` 能创建线索，且走完整校验/查重/评分
- [x] 插件源码没有核心表 DML，只能经宿主上下文写 `leads`
- [x] `source` 不以 `plugin:` 或 `form:` 开头时被拒绝

**边界与隔离**
- [x] 租户级开关生效：停用后导航消失、公开提交接口拒绝新提交
- [x] 停用后重新启用，数据完好
- [x] 插件所有数据查询均在当前 tenant-scoped transaction 内，跨租户返回空
- [x] 插件表启用了 RLS
- [x] ESLint 规则生效：`core/` 无法 import `plugins/`
- [x] **停用表单插件后，核心手工进线仍能运行，既有核心闭环回归测试全部通过**（最关键的一条）

---

## 11. 商业闭环与交付协同扩展插件 (2026-08-25)

为了支撑企业合同、订单、交付项目以及经营决策完整闭环，系统扩围 4 大标准官方插件：

### 11.1 插件清单
1. **合同中心 (`contracts`)**：
   - 路由：`/p/contracts`
   - 自有表：`plugin_contracts`, `plugin_contract_approvals`
   - 权限隔离：SALES 角色仅限查看与维护本人名下合同；审批人只可审批本人对应步骤；
2. **订单与账本管理 (`orders`)**：
   - 路由：`/p/orders`
   - 自有表：`plugin_orders`, `plugin_order_items`, `plugin_order_payment_schedules`, `plugin_order_payment_transactions`
   - 强约束：分期总额与订单总额守恒；商品快照明细金额守恒；流水绑定 `(schedule_id, order_id)` 复合防串单外键；数据库 `paid_amount >= 0` 防超退；
3. **交付项目协同 (`projects`)**：
   - 路由：`/p/projects`
   - 自有表：`plugin_projects`, `plugin_project_order_links`, `plugin_project_milestones`
   - 角色保护：**项目经理 (PM) 财务脱敏** (`isFinanciallyMasked: true`，隐藏订单金额与回款)；里程碑验收联动重算项目进度；
4. **BI 商业智能与 AI 智能体 (`bi-matrix`)**：
   - 路由：`/p/bi-matrix`
   - 自有表：`plugin_ai_bi_reports`
   - 角色门禁：SALES 角色服务端强制 `user_id` 过滤，仅查看个人业绩看板；AI 诊断仅限 ADMIN / MANAGER 触发。

### 11.2 统一离职资产交接钩子 (Offboard Hooks)
- 架构定义：`registerPluginOffboardHandler`
- 执行契约：在员工离职交接事务中原子调度，自动转移未到期合同、未结清订单及进行中项目责任人；
- 兜底安全：退公海模式下若存在未结清资产，必须显式指定接手人，严禁静默转让。

### 11.3 外部系统集成 API (双轨鉴权)
- 端点：`/api/v1/plugins/{contracts,orders,projects,bi}`
- 鉴权契约：统一支持用户 Session Token 与外部 API Key (`lead_source_keys` 配合权限 Scope 校验)，无缝对接企业 ERP 与 OMS 系统。

