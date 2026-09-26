# 领域模型与数据字典

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

## 1. 对象关系

```
Tenant（租户）
 └── User（用户）
      │
      ├── owns ──► Lead（线索）
      │              │ immutable conversion
      │              ▼
      │       LeadConversion（转化关系）
      │              ├──► Customer（客户）
      │              └──► Opportunity（本次转化商机）
      │
      ├── owns ──► Customer（客户）
      │              ├── Contact（联系人）
      │              └── Opportunity（商机）
      │
      ├── Activity（跟进记录）  ──► 挂在 Lead / Customer / Opportunity
      ├── Task（任务）          ──► 挂在 Lead / Customer / Opportunity
      └── Notification（通知）  ──► 收件人是 User
```

### 1.1 关键边界

| 决定 | 理由 |
|---|---|
| Lead 与 Customer 分开 | Lead 可能重复、可能无效；Customer 是已确认的 |
| Lead → Customer 必须人工确认 | 自动转会把垃圾数据变成客户 |
| Opportunity 必须挂 Customer | 线索还没确认价值，直接建商机会污染数据 |
| 一个 Customer 可以有多个 Opportunity | 今年买设备明年买服务是两笔生意 |
| **不做四层身份归一** | 业界实践做了 Lead→Person→Contact→Customer + 合并冲突队列，对 V1 过重 |

### 1.2 三个业务池是事实边界

| 业务池 | 当前事实主表 | 独立状态 | 主要高频查询 |
|---|---|---|---|
| 线索池 | `leads` | 来源、评分、分配、线索状态、查重和放弃 | 我的线索、未分配、高分、超时、来源 |
| 客户池 | `customers` + `contacts` | 客户档案、派生经营状态、联系人和负责人 | 我的客户、长期未跟进、活跃商机数量 |
| 商机池 | `opportunities` | 阶段、金额、预计时间、赢单/丢单和推进风险 | 活跃商机、停滞、预计成交、阶段分布 |

角色不是数据边界。SALES、MANAGER、ADMIN 读取同一批池数据，只改变默认范围、固定聚合和写权限。禁止创建 `sales_leads`、`manager_customers`、`admin_opportunities` 一类角色副本表。

### 1.3 公共数据与池内数据

| 分类 | 表或数据 | 规则 |
|---|---|---|
| 公共基础 | `tenants`、`users` | 三个池共同引用，不保存业务阶段 |
| 公共过程 | `activities`、`tasks`、`notifications`、`sales_insights`、`audit_logs` | 一条记录必须明确属于一个业务对象；不复制对象当前状态 |
| 转化关系 | `lead_conversions` | 不可变地记录线索如何生成/关联客户和本次转化商机；它是跨池来源关系的唯一事实 |
| 线索独立 | `leads`、`lead_status_history`、`score_rules`、`score_feedback`、进线来源表 | 不把线索评分或放弃原因写进客户/商机 |
| 客户独立 | `customers`、`contacts` | 客户经营状态由活跃商机派生，不把多笔商机的阶段和金额堆进客户表 |
| 商机独立 | `opportunities`、`opportunity_stage_history`、`win_reviews` | 每笔商机独立推进和结束 |
| 分析汇总 | `analytics_*`（达到启用条件后再建） | 固定口径、增量生成；在线请求不扫描全量历史 |

“公共”表示多个池复用相同业务概念，不表示把所有对象塞进一个万能表。V1 明确禁止 `entities(type, data jsonb)`、EAV 自定义字段和没有外键约束的通用对象表。

### 1.4 当前状态、过程记录、分析汇总三层

```text
当前状态层  leads / customers / opportunities
    ↓ 单对象或小批量关联
过程记录层  activities / tasks / status_history / audit_logs
    ↓ 固定口径增量汇总
分析层      analytics_* / 日汇总 / 阶段快照（达到启用条件后）
```

- 池列表只读取当前状态和必要的当前任务、最近跟进摘要，不加载历史全文；
- 详情页按对象和游标分页加载过程记录；
- 主管固定指标优先用有界索引查询；需要时间趋势或全量聚合时才读取分析表；
- AI 质检读取单对象事实窗口，赢单复盘读取单商机不可变时间线，均不得无界扫描租户历史；
- 分析结果不得反向成为线索、客户或商机状态的唯一事实来源。

---

## 2. 多租户隔离

### 2.1 策略：共享库 + 行级隔离（RLS）

每张业务表都有 `tenant_id`，PostgreSQL Row Level Security 在数据库层强制隔离。

**为什么不用独立 schema / 独立库**：SaaS 早期租户数不确定，独立 schema 的迁移成本随租户数线性增长；行级隔离的迁移成本恒定。

### 2.2 三层保险（缺一不可）

| 层 | 机制 |
|---|---|
| 数据库 | 每张业务表启用 RLS，策略基于 `current_setting('app.tenant_id')` |
| 数据访问层 | 所有查询走统一 `withTenant()` 包装，禁止裸查业务表 |
| 测试 | **每张业务表一条跨租户泄漏测试** |

### 2.3 关键约束：应用角色必须非 owner

> **PostgreSQL 的 RLS 对表 owner 默认不生效。**
> 如果应用用 owner 角色连接，所有 RLS 策略形同虚设——而且是**静默失效**，测试都可能看不出来。

因此两个数据库连接串，用途严格区分：

| 环境变量 | 角色 | 用途 |
|---|---|---|
| `MIGRATION_DATABASE_URL` | owner | 只有迁移用（建表、建角色、建策略） |
| `DATABASE_URL` | 非 owner 应用角色 | 应用运行时 |

策略同时加 `FORCE ROW LEVEL SECURITY`，确保对表属主也生效。

### 2.4 租户上下文传递

```
请求 → 解析会话 → 取 tenant_id → 事务内 set_config('app.tenant_id', ...) → 执行查询
```

**必须在同一个连接上设置变量并执行查询**，否则变量设在连接 A、查询跑在连接 B，RLS 拿不到 tenant_id。因此用事务绑定。

用 `set_config(..., true)` 让作用域限定在事务内，事务结束自动清除，不会泄漏到连接池的下一个请求。

**拿不到 tenant_id 的请求直接 401**，不允许"默认租户"兜底。

RLS 策略用 `current_setting('app.tenant_id', true)`：变量没设时返回 NULL，NULL 比较不成立 → 查不到任何行。**安全的默认。**

---

## 3. 通用约定

| 约定 | 说明 |
|---|---|
| 主键 | `uuid`，`gen_random_uuid()` 生成 |
| 时间 | `timestamptz`，一律 UTC 存储 |
| 金额 | `bigint`，**单位分**，禁止浮点 |
| 软删除 | `deleted_at timestamptz null`，用于业务对象和需要保留审计语义的配置（如评分规则） |
| 审计字段 | 每表必有 `created_at`；可变表同时有 `updated_at`，只增不改的过程/关系表不设 `updated_at` |
| 命名 | 表名复数小写下划线，字段小写下划线 |

### 3.1 容量设计基线

以下是设计和压测基线，不是未经验证的市场承诺：

| 数据 | 单个大租户基线 |
|---|---:|
| 客户 | 100 万 |
| 线索 | 500 万 |
| 商机 | 500 万 |
| 跟进记录 | 5000 万 |
| 状态历史与审计 | 1 亿级前必须完成分区或归档评审 |

平台总量与单租户总量必须分别记录。单租户百万级会产生热点索引和 RLS 查询压力，不能用“全平台合计百万”压测代替。

### 3.2 在线查询约束

- 所有池查询必须先限定 `tenant_id`，SALES 查询再限定 `owner_user_id`；
- 排序索引最后包含稳定唯一键 `id`，游标由排序字段 + `id` 组成；
- 禁止深层 `OFFSET`、无条件 `COUNT(*)` 和列表页全量历史 JOIN；
- 活跃对象使用部分索引，终态和软删除数据不得占据高频索引主路径；
- 查询计划在代表性数据量上使用 `EXPLAIN (ANALYZE, BUFFERS)` 验证；
- 单表达到 1000 万行或 50GB 时必须评审分区；只有追加型过程表允许优先按月分区，三个当前事实主表不盲目分区；
- 新的高容量追加表优先使用 `bigint identity` 作为物理主键，外部业务对象继续使用 UUID。

### 3.3 三个池的主查询形状

| 池 | 列表驱动与排序 | 允许的摘要读取 |
|---|---|---|
| 线索池 | `leads` 先按租户/负责人/状态缩小范围；优先级排序只关联每条线索唯一的 OPEN `tasks`，再以评分和 `id` 稳定排序 | 选出当前页后，按对象索引各取最近 1 条活动；禁止先扫描 activities 再分组 |
| 客户池 | `customers.last_activity_at` + `id` 游标排序；SALES 同时限定负责人 | 当前页内用 contacts 主联系人索引、opportunities 客户索引和 tasks 唯一 OPEN 索引补摘要 |
| 商机池 | `opportunities.stage / stage_entered_at / expected_close_at + id` 游标排序 | 当前页内关联 customer 摘要和唯一 OPEN 任务；阶段历史不参与列表查询 |

`customers.last_activity_at` 是允许的轻量当前摘要：在客户活动或其商机活动写入事务内，以 `greatest(existing, occurred_at)` 更新，不复制活动正文。角色工作台或固定统计需要大范围趋势时，达到启用条件后读取增量汇总，不能改变上述池事实。

---

## 4. 表定义

### 4.1 tenants

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | uuid | ❌ | `gen_random_uuid()` | PK |
| `name` | text | ❌ | | 租户名，1-100 字符 |
| `status` | enum | ❌ | `ACTIVE` | `ACTIVE` / `SUSPENDED` |
| `created_at` | timestamptz | ❌ | `now()` | |
| `updated_at` | timestamptz | ❌ | `now()` | |

**RLS**：**不启用。**

> **为什么 tenants 不启用 RLS**：它是租户清单本身，不属于任何单个租户。
> 若按 `id = current_setting('app.tenant_id')` 隔离，会导致两个必需操作无法进行：
>
> 1. **登录** —— 拿到 tenant_id 之前无法读租户状态
> 2. **定时任务** —— cron 需要遍历所有活跃租户逐个扫描，没有租户上下文时会返回 0 行
>
> 该表只含租户自身元数据（名称、状态），不含任何业务数据，
> 因此"能读到有哪些租户"不构成数据泄露。**访问控制在应用层**：
> 只有 `login`（校验租户状态）和 `/api/cron/*`（遍历租户）可以读它，
> 通过 `withoutTenant()` 访问 —— 该函数**仅限读这一张表**。
>
> 注意：`users` 表**不能**用 `withoutTenant()` 读，它有 RLS，会返回 0 行。登录走 4.2.1 的专用函数。

---

### 4.2 users

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | uuid | ❌ | 自动 | PK |
| `tenant_id` | uuid | ❌ | | FK → tenants |
| `email` | text | ❌ | | 登录标识；写入前 `trim + lower`，**大小写不敏感地全局唯一（跨租户）** |
| `password_hash` | text | ❌ | | bcrypt cost 12 |
| `name` | text | ❌ | | 1-50 字符 |
| `role` | enum | ❌ | `SALES` | `ADMIN` / `MANAGER` / `SALES` |
| `status` | enum | ❌ | `ACTIVE` | `ACTIVE` / `DISABLED` |
| `session_version` | int | ❌ | `1` | **会话版本，见 4.2.2** |
| `failed_login_count` | int | ❌ | `0` | 连续失败次数 |
| `locked_until` | timestamptz | ✅ | | 锁定到期时间 |
| `created_at` / `updated_at` | timestamptz | ❌ | `now()` | |

**规范化与唯一约束**：

- 所有入口（建用户、登录）先执行 `email.trim().toLowerCase()`
- 数据库加 `CHECK (email = lower(btrim(email)))`，防止绕过应用层写入未规范化值
- `UNIQUE (email)`（全局，非租户内）；因为数据库只允许规范化值，所以唯一性天然大小写不敏感

> **为什么邮箱全局唯一**：登录入参只有邮箱 + 密码，此时还没有租户上下文。
> 若邮箱只在租户内唯一，同一邮箱可能属于多个租户，系统无法确定该验证哪一个。
>
> **V1 选全局唯一** —— 目标客户是 20-100 人 B2B 公司，同一人在两家租户使用同一邮箱的场景极少见。
> 代价：同一邮箱无法在两个租户各开账号。真出现时再改为子域名方案（走范围契约第 6 节）。

**索引**：`(tenant_id, role)`
**RLS**：`tenant_id::text = current_setting('app.tenant_id', true)`

#### 4.2.1 登录如何读到用户（RLS 的例外）

**这里有一个必须解决的矛盾**：

```
users 启用了 RLS，未设 app.tenant_id 时查询返回 0 行
        ↓
但登录时还不知道 tenant_id（要靠 email 反查）
        ↓
withoutTenant() 只是"不设变量"，并不绕过 RLS
        ↓
结果：登录永远查不到用户，系统根本登不进去
```

**解法：由专用 `NOLOGIN BYPASSRLS` 角色持有的 `SECURITY DEFINER` 函数。**

仅写 `SECURITY DEFINER` **还不够**：本项目对业务表启用了 `FORCE ROW LEVEL SECURITY`，普通表属主也受 RLS 限制。函数属主必须明确具备 `BYPASSRLS`，否则函数仍然返回 0 行。

```sql
-- 由迁移角色执行。该角色不能登录，也绝不能授予应用角色成员资格。
CREATE ROLE salescrm_auth NOLOGIN BYPASSRLS;

CREATE FUNCTION public.auth_lookup_user(p_email text)
RETURNS TABLE (
  id uuid, tenant_id uuid, password_hash text,
  role public.user_role, status public.user_status,
  session_version int, locked_until timestamptz, failed_login_count int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT u.id, u.tenant_id, u.password_hash, u.role, u.status,
         u.session_version, u.locked_until, u.failed_login_count
  FROM public.users AS u
  WHERE u.email = lower(btrim(p_email))
$$;

ALTER FUNCTION public.auth_lookup_user(text) OWNER TO salescrm_auth;
GRANT USAGE ON SCHEMA public TO salescrm_auth;
GRANT USAGE ON TYPE public.user_role, public.user_status TO salescrm_auth;
GRANT SELECT (id, tenant_id, email, password_hash, role, status,
              session_version, locked_until, failed_login_count)
  ON public.users TO salescrm_auth;
REVOKE ALL ON FUNCTION public.auth_lookup_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_lookup_user(text) TO salescrm;
```

**角色边界是硬约束**：

- `salescrm_auth`：`NOLOGIN BYPASSRLS`，只拥有该函数、必要 schema/type 的 `USAGE` 及上述认证列的 `SELECT`
- `salescrm`：应用连接角色，只能 `EXECUTE`；不得成为 `salescrm_auth` 的成员，不得 `SET ROLE salescrm_auth`
- 函数体内的表、类型全部带 schema；`search_path` 固定为 `pg_catalog`，避免对象劫持
- 若托管 PostgreSQL 不允许创建 `BYPASSRLS` 角色，阶段 0 必须停下并改认证方案，不能删除 `FORCE RLS` 或改用 owner 连接兜底

**为什么这样是安全的**：

| 担心 | 为什么不成立 |
|---|---|
| 绕过了 RLS？ | 只有专用 `BYPASSRLS` 函数属主能绕过；应用角色本身不能绕过 |
| 能拖走整张表？ | 不能。函数不接受通配、不返回列表、无 email 则返回空 |
| 泄露了什么？ | 只返回认证必需的 8 个字段，不含 name、不含业务数据 |
| 谁能调？ | 只有应用角色，且代码里只有 `login` 一处调用 |

**`withoutTenant()` 不再用于读 users。** 它只用于读 `tenants` 表（登录校验租户状态、cron 遍历活跃租户；该表不启用 RLS）。

登录成功拿到 `tenant_id` 后，后续所有操作（包括更新 `failed_login_count`）一律走 `withTenant()`。

#### 4.2.2 会话失效：session_version

**问题**：JWT 是无状态的。签发后在有效期内一直有效——
即使用户被停用、密码被重置，旧 token 依然能用。而 [09](./09-FEATURE-ADMIN.md) 承诺"现有会话立即失效"。

**解法**：

```
① users.session_version 初始为 1
② JWT payload 里带上签发时的 session_version
③ 每次请求先验签 JWT，取 tenant_id，再在 withTenant(tenant_id) 内按
   (id = user_id AND tenant_id = tenant_id) 查询用户当前 role / status / session_version
④ JWT 里的版本 == 数据库当前版本？
     不等 → 401，跳登录页
⑤ 停用用户 / 重置密码 / 改角色时：session_version += 1
```

JWT 中的 `tenantId` 只用于建立查询上下文，**不能单独作为授权事实**：必须验签，并确认该租户下确实存在该 `userId`。权限判断使用数据库查到的当前 `role`，不信任 JWT 中可能过期的角色值。

**代价**：每次请求多一次 users 查询。

可接受，因为：
- 该查询走主键索引，亚毫秒级
- 本来就要查用户拿角色做权限判断，顺带取 `session_version` 不增加往返

> **为什么不用会话表**：那需要额外的表、清理任务和写入开销。
> `session_version` 用一个整数列达到同样效果，是 V1 最小可行解。

---

### 4.3 leads

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | uuid | ❌ | 自动 | PK |
| `tenant_id` | uuid | ❌ | | FK |
| `owner_user_id` | uuid | ✅ | | FK → users，null = 未分配 |
| `contact_name` | text | ❌ | | 1-50 字符 |
| `contact_phone` | text | ❌ | | `^1[3-9]\d{9}$`，**去重依据** |
| `contact_email` | text | ✅ | | 邮箱格式，≤ 100 |
| `company_name` | text | ✅ | | ≤ 100 |
| `title` | text | ✅ | | 职位，≤ 50 |
| `note` | text | ✅ | | ≤ 500 |
| `source` | text | ❌ | `manual` | `manual` / `import` / `form:<id>` / `api:<sourceKey>` |
| `status` | enum | ❌ | `NEW` | 见 4.3.1 |
| `score` | int | ✅ | | 0-100，null = 未评分 |
| `score_reason` | text | ✅ | | ≤ 500，人话理由 |
| `scored_at` | timestamptz | ✅ | | |
| `is_possible_duplicate` | boolean | ❌ | `false` | 疑似重复标记 |
| `discard_reason` | enum | ✅ | | 见 [03](./03-FEATURE-LEAD.md) 6.3 |
| `discard_note` | text | ✅ | | ≤ 200 |
| `deleted_at` | timestamptz | ✅ | | 软删除 |
| `created_at` / `updated_at` | timestamptz | ❌ | `now()` | |

#### 4.3.1 status 枚举

| 值 | 含义 |
|---|---|
| `NEW` | 刚创建，未联系 |
| `CONTACTED` | 已联系过 |
| `QUALIFIED` | 确认有需求 |
| `CONVERTED` | 已转客户（终态） |
| `DISCARDED` | 已放弃 |

#### 索引

| 索引 | 用途 |
|---|---|
| `(tenant_id, owner_user_id, status, score DESC NULLS LAST, id)`（活跃数据部分索引） | SALES 默认列表 |
| `(tenant_id, status, score DESC NULLS LAST, id)`（活跃数据部分索引） | MANAGER / ADMIN 团队列表 |
| `(tenant_id, contact_phone)` | 去重查询 |
| `(tenant_id, created_at DESC, id DESC)` | 按时间排序 |

**复合引用键**：`UNIQUE (tenant_id, id)`，供 `lead_conversions` 和过程表安全引用。
**RLS**：`tenant_id::text = current_setting('app.tenant_id', true)`

---

### 4.4 customers

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | uuid | ❌ | 自动 | PK |
| `tenant_id` | uuid | ❌ | | FK |
| `owner_user_id` | uuid | ❌ | | FK → users |
| `name` | text | ❌ | | 公司名，1-100 |
| `industry` | text | ✅ | | ≤ 50 |
| `region` | text | ✅ | | ≤ 50 |
| `size` | enum | ✅ | | `1-20`/`21-100`/`101-500`/`501-1000`/`1000+` |
| `last_activity_at` | timestamptz | ✅ | | 最近客户跟进时间，事务内维护的轻量摘要 |
| `deleted_at` | timestamptz | ✅ | | |
| `created_at` / `updated_at` | timestamptz | ❌ | `now()` | |

**索引**：`(tenant_id, owner_user_id, last_activity_at DESC NULLS LAST, id)`（未删除数据部分索引）、`(tenant_id, last_activity_at DESC NULLS LAST, id)`（未删除数据部分索引）、`(tenant_id, name, id)`
**复合引用键**：`UNIQUE (tenant_id, id)`，供跨池关系安全引用。
**RLS**：同上

**不增加 `customer_stage` 字段。** 客户经营状态由其商机聚合实时计算，见 [06](./06-FEATURE-CUSTOMER.md) 3.5；商机才是可推进的经营单元。

---

### 4.5 contacts

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | uuid | ❌ | 自动 | PK |
| `tenant_id` | uuid | ❌ | | FK |
| `customer_id` | uuid | ❌ | | FK → customers |
| `name` | text | ❌ | | 1-50 |
| `phone` | text | ❌ | | 手机号格式，**租户内唯一** |
| `email` | text | ✅ | | ≤ 100 |
| `title` | text | ✅ | | ≤ 50 |
| `is_primary` | boolean | ❌ | `false` | 每客户仅一个 true |
| `deleted_at` | timestamptz | ✅ | | |
| `created_at` / `updated_at` | timestamptz | ❌ | `now()` | |

**唯一约束**：`(tenant_id, phone) WHERE deleted_at IS NULL`
**部分唯一索引**：`(customer_id) WHERE is_primary = true AND deleted_at IS NULL` —— 数据库层保证主联系人唯一
**索引**：`(tenant_id, customer_id)`

---

### 4.6 activities

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | uuid | ❌ | 自动 | PK |
| `tenant_id` | uuid | ❌ | | FK |
| `lead_id` | uuid | ✅ | | FK → leads |
| `customer_id` | uuid | ✅ | | FK → customers |
| `opportunity_id` | uuid | ✅ | | FK → opportunities |
| `user_id` | uuid | ❌ | | 记录人 |
| `type` | enum | ❌ | | `CALL`/`MEETING`/`VISIT`/`MESSAGE`/`NOTE` |
| `outcome` | enum | ✅ | | `CONNECTED`/`NO_ANSWER`/`REFUSED`/`INTERESTED`，NOTE 时为 null |
| `summary` | text | ❌ | | ≤ 200 |
| `occurred_at` | timestamptz | ❌ | `now()` | |
| `created_at` | timestamptz | ❌ | `now()` | |

**CHECK 约束**：`num_nonnulls(lead_id, customer_id, opportunity_id) = 1` —— 有且仅有一个归属对象

> 与 `tasks` 口径一致（见 4.7）。跟进记录归属唯一，时间线才不会重复出现同一条。
**索引**：`(tenant_id, lead_id, occurred_at DESC, id DESC)`、`(tenant_id, customer_id, occurred_at DESC, id DESC)`、`(tenant_id, opportunity_id, occurred_at DESC, id DESC)`

---

### 4.7 tasks

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | uuid | ❌ | 自动 | PK |
| `tenant_id` | uuid | ❌ | | FK |
| `lead_id` | uuid | ✅ | | FK |
| `customer_id` | uuid | ✅ | | FK → customers |
| `opportunity_id` | uuid | ✅ | | FK |
| `assignee_user_id` | uuid | ❌ | | 执行人，**非空** |
| `type` | enum | ❌ | | `FIRST_RESPONSE`/`FOLLOW_UP`/`STAGE_PUSH` |
| `due_at` | timestamptz | ❌ | | **超时判定依据** |
| `status` | enum | ❌ | `OPEN` | `OPEN`/`DONE`/`CANCELLED` |
| `completed_at` | timestamptz | ✅ | | |
| `created_at` / `updated_at` | timestamptz | ❌ | `now()` | |

**CHECK**：`num_nonnulls(lead_id, customer_id, opportunity_id) = 1` —— 有且仅有一个归属对象

> **为什么要有 `customer_id`**：客户档案页允许「记跟进 + 设下次跟进时间」（见 [06](./06-FEATURE-CUSTOMER.md) 4.3），
> 转客户后线索已是 `CONVERTED` 终态，后续跟进挂在客户身上。
> 没有这一列，客户侧的下次跟进任务无处安放。

> **为什么 `assignee_user_id` 非空**：任务必须有人负责，否则超时提醒无人可发。
> 由此推出：**未分配的线索不创建任务**（见 [03](./03-FEATURE-LEAD.md) 3.4），分配时才创建。

**部分唯一索引**：
- `(lead_id) WHERE status = 'OPEN' AND lead_id IS NOT NULL`
- `(customer_id) WHERE status = 'OPEN' AND customer_id IS NOT NULL`
- `(opportunity_id) WHERE status = 'OPEN' AND opportunity_id IS NOT NULL`

—— 同一对象同时只能有一个 OPEN 任务

**索引**：`(tenant_id, assignee_user_id, status, due_at, id)` —— 工作台主查询与稳定游标

---

### 4.8 opportunities

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | uuid | ❌ | 自动 | PK |
| `tenant_id` | uuid | ❌ | | FK |
| `customer_id` | uuid | ❌ | | FK → customers |
| `owner_user_id` | uuid | ❌ | | FK → users |
| `primary_contact_id` | uuid | ✅ | | FK → contacts |
| `name` | text | ❌ | | 1-100 |
| `stage` | enum | ❌ | `DISCOVERY` | 见 4.8.1 |
| `stage_entered_at` | timestamptz | ❌ | `now()` | 当前阶段进入时间 |
| `expected_amount` | bigint | ✅ | | **单位：分** |
| `expected_close_at` | date | ✅ | | |
| `actual_amount` | bigint | ✅ | | 赢单时填 |
| `actual_close_at` | date | ✅ | | 赢单时填 |
| `demand_note` | text | ✅ | | ≤ 500 |
| `lost_reason` | enum | ✅ | | 见 [07](./07-FEATURE-OPPORTUNITY.md) 5.2 |
| `lost_note` | text | ✅ | | ≤ 200 |
| `deleted_at` | timestamptz | ✅ | | |
| `created_at` / `updated_at` | timestamptz | ❌ | `now()` | |

#### 4.8.1 stage 枚举

| 值 | 显示 | 终态 |
|---|---|---|
| `DISCOVERY` | 初步接触 | 否 |
| `PROPOSAL` | 方案沟通 | 否 |
| `NEGOTIATION` | 商务谈判 | 否 |
| `WON` | 赢单 | ✅ |
| `LOST` | 丢单 | ✅ |

**池列表索引**（均为未删除、非终态数据的部分索引）：

- `(tenant_id, owner_user_id, stage, stage_entered_at, id)`：SALES 按阶段与停滞时间；
- `(tenant_id, stage, stage_entered_at, id)`：MANAGER / ADMIN 按阶段与停滞时间；
- `(tenant_id, owner_user_id, expected_close_at, id)`：SALES 按预计成交时间；
- `(tenant_id, expected_close_at, id)`：MANAGER / ADMIN 按预计成交时间。

**关系索引**：`(tenant_id, customer_id, stage, id)`，用于客户详情读取其商机摘要。
**复合引用键**：`UNIQUE (tenant_id, id)` 和 `UNIQUE (tenant_id, id, customer_id)`；前者供阶段历史等过程表引用，后者供 `lead_conversions` 校验转化商机与客户一致。

---

### 4.9 opportunity_stage_history

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | FK |
| `opportunity_id` | uuid | FK |
| `from_stage` | enum，可空 | 变更前；商机创建时为 null |
| `to_stage` | enum | 变更后 |
| `note` | text | 推进/回退说明，≤ 200 |
| `operator_user_id` | uuid | 操作人 |
| `created_at` | timestamptz | |

**索引**：`(tenant_id, opportunity_id, created_at DESC)`

商机创建必须写第一条 `null → initialStage` 历史。阶段更新使用 `WHERE id = ? AND tenant_id = ? AND stage = expectedFromStage` 条件更新；影响行数为 0 时返回 `CONFLICT`，且事务内历史、任务和审计均不得写入。

---

### 4.10 score_rules

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | uuid | ❌ | 自动 | PK |
| `tenant_id` | uuid | ❌ | | FK |
| `label` | text | ❌ | | **人话解释**，≤ 30 字 |
| `field` | text | ❌ | | 见 [05](./05-FEATURE-SCORING.md) 4.3 |
| `operator` | enum | ❌ | | 见 [05](./05-FEATURE-SCORING.md) 4.4 |
| `value` | text | ✅ | | EXISTS/NOT_EXISTS 时为 null |
| `weight` | int | ❌ | | -100 ~ 100 |
| `enabled` | boolean | ❌ | `true` | |
| `sort_order` | int | ❌ | `0` | 理由拼接顺序 |
| `deleted_at` | timestamptz | ✅ | | 软删除；删除后不再参与评分、列表和排序 |
| `created_at` / `updated_at` | timestamptz | ❌ | `now()` | |

**索引**：`(tenant_id, enabled, sort_order)`；活跃规则部分索引 `(tenant_id, sort_order, id) WHERE deleted_at IS NULL`

---

### 4.11 score_feedback

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | FK |
| `lead_id` | uuid | FK |
| `user_id` | uuid | 反馈人 |
| `score_at_feedback` | int | 反馈时的分数快照 |
| `verdict` | enum | `ACCURATE` / `INACCURATE` |
| `created_at` / `updated_at` | timestamptz | |

**唯一约束**：`(lead_id, user_id)` —— 同人对同线索只保留最新一条（upsert）

---

### 4.12 notifications

| 字段 | 类型 | 可空 | 说明 |
|---|---|---|---|
| `id` | uuid | ❌ | PK |
| `tenant_id` | uuid | ❌ | FK |
| `user_id` | uuid | ❌ | 收件人 |
| `type` | enum | ❌ | `TASK_OVERDUE`/`TASK_DUE_SOON`/`LEAD_ASSIGNED` |
| `task_id` | uuid | ✅ | 关联任务（去重依据） |
| `lead_id` | uuid | ✅ | |
| `opportunity_id` | uuid | ✅ | |
| `title` | text | ❌ | ≤ 100 |
| `body` | text | ✅ | ≤ 200 |
| `link` | text | ✅ | 点击跳转路径 |
| `read_at` | timestamptz | ✅ | **null = 未读** |
| `created_at` | timestamptz | ❌ | |

**唯一约束**：`(task_id, type) WHERE task_id IS NOT NULL` —— 同一任务同一类型只通知一次
**索引**：`(tenant_id, user_id, read_at, created_at DESC)` —— 未读数与列表查询

---

### 4.13 lead_status_history

线索状态记录是用户可见的产品时间线，不从通用审计日志临时拼装。

| 字段 | 类型 | 可空 | 说明 |
|---|---|---|---|
| `id` | bigserial | ❌ | PK |
| `tenant_id` | uuid | ❌ | FK |
| `lead_id` | uuid | ❌ | FK，复合外键绑定同租户线索 |
| `from_status` | lead_status | ✅ | 创建记录为 null |
| `to_status` | lead_status | ❌ | 变化后的状态 |
| `reason` | text | ✅ | 推进、放弃、恢复或合并原因，≤ 200 |
| `actor_user_id` | uuid | ❌ | 操作者，复合外键绑定同租户用户 |
| `created_at` | timestamptz | ❌ | |

**约束**：`from_status IS NULL OR from_status <> to_status`
**索引**：`(tenant_id, lead_id, created_at DESC, id DESC)`
**只读**：应用角色只能 SELECT / INSERT，不允许 UPDATE / DELETE。

---

### 4.14 audit_logs

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | bigserial | PK |
| `tenant_id` | uuid | |
| `actor_user_id` | uuid | 操作人 |
| `action` | text | 如 `lead.assign` |
| `subject_type` | text | `lead` / `customer` / ... |
| `subject_id` | uuid | |
| `detail` | jsonb | 变更前后关键字段 |
| `created_at` | timestamptz | |

**索引**：`(tenant_id, created_at DESC)`、`(tenant_id, subject_type, subject_id)`
**只读**：不允许 UPDATE / DELETE（数据库层用触发器或权限限制）

---

### 4.15 plugin_registry

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | FK |
| `plugin_key` | text | 如 `form-capture` |
| `enabled` | boolean | |
| `config` | jsonb | 插件自有配置 |
| `created_at` / `updated_at` | timestamptz | |

**唯一约束**：`(tenant_id, plugin_key)`

### 4.15.1 plugin_form_definitions

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` / `plugin_id` | uuid | 复合外键指向同租户 `plugin_registry` |
| `name` | text | 1-100 字 |
| `status` | text | `DRAFT` / `PUBLISHED` |
| `schema` | jsonb | `{ version: 1, fields: [...] }`；2-30 个字段 |
| `created_by_user_id` | uuid | 复合租户外键指向创建人 |
| `published_at` | timestamptz null | 发布时写入 |
| `created_at` / `updated_at` | timestamptz | |

**约束**：发布态与 `published_at` 必须一致；已发布定义由数据库触发器禁止任何原地更新。索引为 `(tenant_id, status, updated_at DESC, id DESC)`。

### 4.15.2 plugin_form_submissions

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` / `form_id` | uuid | 复合外键指向同租户表单 |
| `ip_hash` | text | 64 位十六进制 SHA-256，仅用于限流，不存原始 IP |
| `raw_payload` | jsonb | 通过已发布 schema 严格校验后的原始答案 |
| `submitted_at` | timestamptz | 提交时间 |

**索引**：`(tenant_id, form_id, ip_hash, submitted_at DESC)`，支撑同表单、同来源的一分钟限流窗口。

### 4.15.3 plugin_form_submission_links

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` / `submission_id` | uuid | 复合外键指向同租户提交；每条提交唯一 |
| `lead_id` | uuid | 复合外键指向同租户线索 |
| `created_at` | timestamptz | |

**索引**：`(tenant_id, lead_id, created_at DESC)`，用于线索详情读取来源表单。submission、Lead 和 link 必须在同一事务中写入。

以上四张插件表全部 `ENABLE + FORCE ROW LEVEL SECURITY`，策略同时带 `USING` 与 `WITH CHECK`；应用连接仍使用非 owner 角色。

---

### 4.16 lead_source_keys

外部系统单向写入线索的凭证。明文 token 只在创建时返回一次。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | FK |
| `name` | text | 来源名称，1-50 字 |
| `source_key` | text | URL/来源标识，租户内唯一 |
| `token_hash` | text | SHA-256 hash，禁止保存明文 |
| `last_used_at` | timestamptz null | 最近成功使用 |
| `revoked_at` | timestamptz null | 非空后立即失效 |
| `created_by_user_id` | uuid | 创建人 |
| `created_at` | timestamptz | |

**索引**：`UNIQUE (tenant_id, source_key)`、`UNIQUE (token_hash)`。

### 4.17 lead_intake_requests

记录 API 进线幂等结果，不保存完整 Bearer token。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` / `source_key_id` | uuid | 来源 |
| `idempotency_key` | text | 1-100 字 |
| `external_id` | text null | 调用方记录号 |
| `lead_id` | uuid | 创建结果 |
| `request_fingerprint` | text | 规范化业务载荷 hash |
| `created_at` | timestamptz | |

**唯一约束**：`(source_key_id, idempotency_key)`。相同 key、不同 fingerprint 返回 `409 IDEMPOTENCY_CONFLICT`。

### 4.18 sales_insights

线索或商机当前及历史的质检建议。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | FK |
| `lead_id` / `opportunity_id` | uuid null | 恰一非空 |
| `code` | text | 稳定规则码 |
| `severity` | enum | `INFO` / `ATTENTION` / `HIGH_RISK` |
| `status` | enum | `OPEN` / `ACCEPTED` / `DISMISSED` / `EXPIRED` |
| `title` / `summary` / `suggested_action` | text | 用户可见内容 |
| `suggested_due_at` | timestamptz null | 建议时间 |
| `evidence` | jsonb | 仅业务事实引用和摘要 |
| `source_type` | enum | `RULE` / `PLAYBOOK` / `MODEL` |
| `source_version` | text | 规则或打法版本 |
| `dismiss_reason` | text null | 忽略理由 |
| `accepted_task_id` | uuid null | 采纳后任务 |
| `refresh_failed_at` | timestamptz null | 最近刷新失败时间，成功后清空 |
| `expires_at` / `created_at` / `updated_at` | timestamptz | |

**约束**：`num_nonnulls(lead_id, opportunity_id) = 1`；同一对象、`code` 只允许一条 `OPEN` 建议。

### 4.19 win_reviews

每个赢单商机最多一份自动复盘草稿，保存计算后的节奏指标和证据快照。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` / `opportunity_id` | uuid | `opportunity_id` 租户内唯一 |
| `status` | enum | `DRAFT` / `REVIEWED` / `REJECTED` |
| `summary` | text | 复盘摘要 |
| `metrics` / `evidence` / `data_gaps` | jsonb | 周期、节奏、证据和缺失 |
| `generation_failed_at` | timestamptz null | 最近生成失败时间；成功后清空，读取时按冷却窗口重试 |
| `generation_attempts` | integer | 生成尝试次数，仅用于诊断，不作为质量结论 |
| `reviewed_by_user_id` / `review_reason` / `reviewed_at` | nullable | 主管审核 |
| `created_at` / `updated_at` | timestamptz | |

**审核约束**：只有 `generation_failed_at IS NULL`、摘要非空且至少包含一条事实证据的草稿可以进入 `REVIEWED / REJECTED`；终态不可原地更新。失败草稿保留诊断信息，自动重试至少间隔 5 分钟，避免页面刷新造成写放大。

### 4.20 sales_playbooks / sales_playbook_samples / sales_playbook_feedback

`sales_playbooks` 保存版本化团队打法，状态为 `DRAFT / PUBLISHED / RETIRED`，包含适用范围、不适用范围、检查点、推荐节奏、有效动作、常见风险、版本、审核人和发布时间。

关键字段包括：租户内唯一的 `(family_key, version)`、仅允许活跃商机阶段的 `target_stage`、结构化的适用/排除行业、地区和客户规模数组，以及 `claim_evidence`。`claim_evidence` 必须分别为检查点、推荐节奏、有效动作和常见风险引用当前打法的样本 ID；固定内容和引用均不能为空。`PUBLISHED / RETIRED` 版本由数据库触发器禁止原地更新。

`sales_playbook_samples` 连接打法与 `win_reviews`，同一复盘在同一打法中只能出现一次。发布时数据库事务内复核至少 3 个 `REVIEWED` 样本；父打法进入 `PUBLISHED / RETIRED` 后，触发器锁定并禁止样本关联增删改，证据集合与版本一起不可变。

`sales_playbook_feedback` 记录销售对推荐打法的 `HELPFUL / NOT_HELPFUL / NOT_APPLICABLE` 反馈及原因。同一用户对同一商机和打法版本只保留最新反馈。

推荐只读取当前单商机、客户结构化特征和同阶段已发布打法：非空适用条件必须命中，任一排除条件命中即淘汰；按命中特征数、发布时间和 ID 确定性排序后 `LIMIT 1`。反馈再次复核商机可见性和同一匹配条件，不能对任意已发布打法伪造反馈。

### 4.21 lead_conversions

不可变的跨池转化关系。它是来源追溯，不是新的业务池。

| 字段 | 类型 | 可空 | 说明 |
|---|---|---|---|
| `id` | uuid | ❌ | PK |
| `tenant_id` | uuid | ❌ | FK |
| `lead_id` | uuid | ❌ | FK，租户内唯一 |
| `customer_id` | uuid | ❌ | FK |
| `opportunity_id` | uuid | ❌ | FK，转化时创建的本次转化商机 |
| `converted_by_user_id` | uuid | ❌ | 操作人 |
| `created_at` | timestamptz | ❌ | `now()`，即转化时间 |

**约束与索引**：

- `UNIQUE (tenant_id, lead_id)`：一条线索只能成功转化一次；
- `UNIQUE (tenant_id, opportunity_id)`：一笔商机只能属于一次 Lead 转化；
- `INDEX (tenant_id, customer_id, created_at DESC)`：从客户追溯来源；
- `(tenant_id, lead_id)`、`(tenant_id, customer_id)`、`(tenant_id, opportunity_id, customer_id)`、`(tenant_id, converted_by_user_id)` 分别使用复合外键指向对应父表；其中商机复合外键同时校验商机属于本次转化的客户，数据库层拒绝同租户错配。父表迁移必须提供相应 `UNIQUE` 被引用键。

**RLS 与不可变性**：启用并 `FORCE ROW LEVEL SECURITY`，策略与其他业务表相同。应用角色只有 `SELECT / INSERT`，无 `UPDATE / DELETE` 权限；关系创建后不可更新或删除。数据库迁移增加延迟约束触发器：提交时必须确认 `lead.status = CONVERTED`，并再次确认转化商机属于 `customer_id`。客户后续新增商机不写入此表，仍通过 `opportunities.customer_id` 关联。

#### 4.21.1 旧来源字段收敛迁移

现有实现曾以 `leads.customer_id`、`customers.from_lead_id`、`opportunities.from_lead_id` 表示转化来源。它们与 `lead_conversions` 不能长期并存为可写事实源。以下方案只用于已存在数据库的升级；全新安装从一开始只建 `lead_conversions`，不创建这三个旧来源字段。

**目标和禁止项**：切换完成后，跨池来源关系只从 `lead_conversions` 读取和写入。禁止把一笔新转化同时写入 `lead_conversions` 和旧三列，也禁止以“临时兼容”为由无限期保留双读或双写。

**迁移权限边界**：回填函数由独立的 `salescrm_migration NOLOGIN BYPASSRLS` 角色持有，不能复用只负责登录查询的 `salescrm_auth`。该角色只拥有旧来源/证据表的 `SELECT`、新关系与隔离清单的 `SELECT / INSERT`；另仅授予 `leads.id` 的列级 `UPDATE` 权限以满足 PostgreSQL `SELECT ... FOR UPDATE` 的加锁要求，函数本身不执行更新。应用角色不得成为其成员或执行回填函数。迁移 owner 连接必须显式 `SET ROLE salescrm_migration` 后按每批 `1-5000` 条调用；默认批量为 500。已写入关系和已进入隔离清单的 lead 不在后续批次重复处理，修复隔离项后需由迁移操作显式清理该项再重试。

| 阶段 | 可执行动作 | 通过条件 / 失败处理 |
|---|---|---|
| 1. Expand | 新建 `lead_conversions`、复合外键、唯一索引、RLS、不可变权限和延迟约束；保留旧三列，但不改其历史值。创建仅供迁移角色访问的隔离清单，记录 `tenant_id`、旧对象 ID、原因码和最小证据。 | 表及约束可在隔离库创建；应用仍走旧读路径，尚未有新写入，因此可回滚本阶段迁移。 |
| 2. Backfill | 按 `(tenant_id, lead_id)` 固定顺序分批处理，并为候选 lead 加事务锁。只有同时满足“线索为 `CONVERTED`、三端同租户、能得到唯一 customer 和唯一本次转化 opportunity、商机属于该 customer、能从唯一的 `CONVERTED` 状态历史或 `lead.convert` 审计记录确定操作人和转化时间”时，才插入一行关系。两类证据都唯一时，操作人和时间必须一致；`converted_by_user_id` 与 `created_at` 必须来自该证据，不能使用迁移执行人或迁移时间代替。 | 每批提交后记录数量和冲突数；任何不满足条件、操作人/时间缺失或两类证据冲突的记录进入隔离清单，**不得**猜测客户、补造商机、伪造操作人/时间或静默覆盖。 |
| 3. Verify | 对未隔离数据做四向核对：旧 lead→customer、旧 customer→lead、旧 opportunity→lead、以及新 conversion→三端对象；同时检查每条 lead / opportunity 的唯一性、租户一致性、`CONVERTED` 状态和不可变权限。读接口以影子方式同时计算旧、新来源关系，只比较并记录差异，不改变返回值。 | 差异、未映射记录、重复映射、跨租户映射和未解决隔离记录均必须为 0，才允许切换；否则停止，不进入切换。 |
| 4. Switch | 短暂冻结“转客户”写入口，完成最后一批 backfill 与核对；部署只写、只读 `lead_conversions` 的转化服务，再解除冻结。新转化在同一事务内创建/关联 customer、创建本次转化 opportunity、插入 conversion 并更新线索状态。 | 切换时捕获 `(tenant_id, lead_id)` 唯一冲突；若已存在且三端一致，按幂等成功返回；若不一致，拒绝并进入人工处理，绝不覆盖。 |
| 5. Contract | 在约定的观测窗口内继续影子双读：切换前的关系要求旧、新一致；切换后的新关系要求新表存在且旧三列保持 `NULL`/未变。窗口通过后删除旧读分支、旧列写入口和隔离清单中的已解决项，再以独立迁移删除旧三列。 | 删除旧列前后均执行下方断言并保留迁移前备份/PITR 点；删除旧列是不可逆契约，不与业务功能变更混在同一次发布。 |

**已有客户的转化**：业务上允许线索查重后关联已有客户；本次转化仍必须新建一笔 `opportunity`，并由一行 `lead_conversions` 同时关联 lead、该已有 customer 与本次 opportunity。历史数据若只有旧 `lead.customer_id` 或 `customer.from_lead_id`、却找不到可证明的本次转化商机，属于不完整历史，必须隔离并由业务确认“补录有证据的商机”或“撤销错误来源”；不能为凑迁移通过率虚构商机。

**并发、重复和坏数据**：

- backfill 与在线转化不能并行无约束执行。切换前先停写、做增量 backfill，再做最终核对；
- 新转化依靠事务、lead 行锁和 `UNIQUE (tenant_id, lead_id)` 保证至多成功一次；重复请求只能返回同一关系或显式冲突；
- 一个 lead 指向多个 customer、一个 lead 匹配多个候选 opportunity、customer/opportunity 租户不一致、终态不为 `CONVERTED`、操作人/转化时间无唯一证据、或旧三列彼此矛盾，均进入隔离清单。隔离清单不是产品事实表，未清零不得上线切换；
- 双读只用于有界观测和差异告警，不产生写入。切换后禁止新代码继续更新旧三列。

**上线断言与回滚边界**：

| 时点 | 必须成立的断言 |
|---|---|
| 切换前 | 所有非隔离历史关系均能得到且仅能得到一行 conversion；隔离清单为 0；四向核对无差异；同租户错配、重复 lead、重复 opportunity、非 `CONVERTED` lead 均由数据库或测试拒绝；已保存可恢复备份/PITR 点。 |
| 切换后 | 新转化只新增 `lead_conversions`；切换前关系影子双读一致，切换后关系的新表存在且旧字段不再变化；任一 lead/opportunity 至多一行 conversion；所有关系仍满足租户、customer 与 opportunity 一致性。 |
| 删除旧列后 | 所有来源查询、导出、审计和测试只依赖 `lead_conversions`；仓库扫描不得再出现旧三列的业务读写。 |

在**解除写冻结前**，Expand/Backfill/Verify 失败可撤销新增表和迁移代码，旧系统未受新写入影响。**解除写冻结后不得回退到旧读路径**：新转化没有双写到旧三列，回退旧读会丢失可见性。此时的处置是立即暂停转化入口、保留新表和旧列、用兼容新表的版本向前修复；只有在 Contract 前仍可保留旧列作审计，Contract 后只能通过新的前向迁移或数据库恢复流程处理。

---

## 5. 插件的数据表

| 规则 | 说明 |
|---|---|
| 表名前缀 | `plugin_<key>_`，如 `plugin_form_definitions` |
| RLS | 同样启用，无例外 |
| 核心表 | **不为插件预留任何字段** |
| 关联方式 | 插件用自己的关联表指向核心对象 |
| 迁移 | 独立编号，卸载时可单独回滚 |

---

## 6. 明确不建的表

对照 [产品概览](./01-PRODUCT-OVERVIEW.md) 第 4 节：

- 营销活动 / 渠道 / 归因
- 公海规则 / 划转记录 / 抢单
- 业绩 / 提成 / 目标
- 多套角色 projection / CQRS 读模型 / 事件溯源
- 没有明确指标口径和容量依据的分析宽表
- 不受控的全量历史复制表
- 身份归一（person / identity_conflict / merge_plan）
- SDR 交接
- 工作流 / 自定义字段 / 自定义对象
- 组织架构树 / 自定义角色 / 权限矩阵
- 向量库 / embedding 索引 / 模型对话历史

---

## 7. 迁移规范

| 规则 | 说明 |
|---|---|
| 只增不改 | 编号递增，已应用的迁移不修改 |
| RLS 同迁移 | **每张新业务表的迁移必须同时包含 RLS 策略**，不允许后补 |
| 租户复合外键 | 业务表先提供 `UNIQUE (tenant_id, id)`；跨业务表关系使用 `(tenant_id, foreign_id)` 复合外键，不能只靠应用层检查 |
| 可回滚 | 每个迁移可单独回滚 |
| 同提交 | 迁移与使用它的代码在同一次 git 提交 |
| 用 owner 执行 | 迁移用 `MIGRATION_DATABASE_URL` |
| 大表策略 | 先用复合/部分索引和游标分页；达到 1000 万行或 50GB 后才评审分区 |
| 分析策略 | 先定义固定指标，再用增量汇总；禁止从页面请求直接扫描过程表 |
