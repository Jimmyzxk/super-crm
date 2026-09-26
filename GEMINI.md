# Antigravity & Gemini Project Guidelines: Enterprise B2B Sales CRM

This document defines the strategic and operational invariants for the **Sales CRM** project. Every AI agent working on this codebase must strictly adhere to these rules without exception.

---

## 1. 开发流程铁律 (Engineering & Git Workflow)

1. **影响面评估与范围收敛 (Impact Analysis & Scope Confinement)**:
   - 严禁为了局部需求直接修改核心公共组件（如 `Button.tsx` 的全局 variant/size），避免造成其他页面或表格操作列破损；
   - 严格保留左侧导航侧边栏 (`AppSidebar.tsx`)，严禁将侧边栏私自改为顶部导航栏。
2. **本地 Git 原子提交规范 (Atomic Commits)**:
   - 任务开始前确保工作区干净；
   - 每一个独立功能或修复形成单独提交，严格遵循 `feat:`, `fix:`, `refactor:`, `test:` 规范。

---

## 2. 核心业务与资产不可篡改规范 (B2B Domain Invariants)

1. **历史赢单/输单业绩永久锁定 (Historical Deal Immutability)**:
   - `WON` 和 `LOST` 历史商机业绩永远归属于原成交销售，客户公海流转或被新销售认领时严禁重新划拨历史已结案商机。
2. **在途商机流转阻断 (In-Flight Deal Protection)**:
   - 名下存在跟进中（非结案）商机的客户，严禁直接释放进公海或被他人认领；必须先完成关单、结案或商机显式交接。
3. **真实认领时间与沉睡保护期 (Claim Timestamp & Anti-Snatch Invariant)**:
   - 客户公海认领必须维护真实 `claimed_at`，定时回收必须以 `GREATEST(claimed_at, last_activity_at)` 计算保护期（>=7天）。
4. **联系人归属绑定原则 (Contact Belongs to Customer Entity)**:
   - 联系人归属于企业客户主体，没有独立的公海认领权限；联系人表格严禁提供独立认领按钮。
   - 术语规范：企业级资质为「客户画像」，联系人仅称为「联系人档案 / 决策角色」，严禁称联系人为画像。
5. **时间与周期严格幂等 (No Hardcoded Years/Dates)**:
   - 严禁硬编码年份（如 `2026`），统一动态从系统时钟获取；
   - 配额目标查询必须精确匹配 `period = $currentPeriod`，严禁跨月松散 Fallback 覆盖。

---

## 3. 服务端数据安全与行级隔离 (Data Privacy & RBAC)

1. **严格最小权限原则 (Server-Side Enforcement)**:
   - 销售角色（`SALES`）查询目标配额、线索、客户时，服务端必须强制追加 `WHERE user_id = ctx.userId`，严禁拉取全量数据后交由前端过滤。
2. **敏感数据脱敏与审计 (PII Masking & Mandatory Audit Logs)**:
   - 手机号、邮箱等敏感资产必须使用 `MaskedPhone` 脱敏展示，点击查看明文必须写入 `audit_logs` 审计表。
3. **多租户 RLS 隔离**: 所有 DB 操作必须在 `withTenant` 或传递 `tenantId` 上下文中执行。

---

## 4. 质量测试与回归流程 (QA & Testing Protocol)

1. **缺陷测试前置 (Regression Test First)**:
   - 修复复杂业务漏洞前，必须在 `tests/integration/` 或 `tests/unit/` 中编写复现测试用例。
2. **双重全量强制检验**:
   - 必须通过 `pnpm typecheck`（TypeScript 零错误）；
   - 必须通过 `pnpm test`（全量 49 个测试文件、280+ 测试用例 100% 绿灯）。

---

## 5. UI 视觉与原子组件规范 (UI Design System Tokens)

1. **绝对禁止 Emoji 表情图标 (Zero Emoji Tolerance)**:
   - **严禁在任何前端 UI、弹窗提示、反馈文本、操作按钮或表格单元格中使用任何 Emoji 表情图标**（如 🎉, ✨, 📞, ✉️, ⚠️, 💬, 📱 等）；
   - 所有图标需求必须统一使用专业规范的 Heroicons SVG 矢量图标或纯文本。
2. **头部核心操作按钮标准 (Header CTA Buttons)**:
   - 主操作：`Button variant="primary" size="md"`（`bg-slate-900 text-white hover:bg-slate-800 px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs`）；
   - 次操作：`Button variant="secondary" size="md"`（`bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 shadow-2xs`）；
   - 矢量加号图标：`<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>`；
   - **严禁使用文本 `+` 字符**。
3. **表格操作列统一规范 (Table Action Buttons)**:
   - 表格行内操作统一采用简洁双字动词（`编辑`、`查看`、`删除`），统一使用 `<Button variant="secondary" size="xs">`。

---

## 6. 容器化运行与多副本集群规范 (Docker & Deployment Invariants)

1. **日常敏捷开发 (Live Hot-Reload)**:
   - 统一采用 `pnpm docker:dev` (`docker compose -f docker-compose.dev.yml up -d`) 启动环境；
   - 宿主机代码目录通过卷挂载实时透传至容器，支持 Next.js Fast Refresh 毫秒级热更新，无需每次改代码重新构建镜像。
2. **全真生产交付与安全密钥管理 (Production Secrets & Invariants)**:
   - 阶段性发版或全链路验证使用 `pnpm docker:prod` (`docker compose up -d --build`)；
   - **生产 compose (`docker-compose.yml`) 严禁硬编码明文密钥与弱口令**：`SESSION_SECRET`、`CRON_SECRET`、`POSTGRES_PASSWORD`、`APP_DATABASE_PASSWORD` 等核心机密必须从 `.env` 注入，且提供标准 `.env.example` 模板。
3. **多副本容器并发启动安全 (Multi-Replica Advisory Lock)**:
   - `scripts/migrate.ts` 与 `scripts/seed-acceptance.ts` 已内置 PostgreSQL Session Advisory Lock 会话锁机制（`pg_advisory_lock`），多副本横向扩容时天然防范 DDL 竞态碰撞与重复迁移；
   - 支持通过 `RUN_MIGRATIONS=false` 环境变量跳过内置迁移，支持由 Kubernetes 独立 InitContainer / Job 统一执行迁移。
4. **数据库连接池韧性守护**:
   - `src/db/client.ts` 必须严格维持 `pool.on("error")` 监听捕获与 `globalThis.__db_pool` 全局单例保护，严防连接池泄露与空闲套接字断连导致进程猝死。
5. **回归质量门禁**:
   - 必须通过全量测试：`pnpm test` (60 个测试文件 / 446+ 测试用例 100% 通过) 与 `pnpm typecheck` (0 错误)。
