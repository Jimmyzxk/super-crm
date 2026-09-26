---
name: development-workflow-guard
description: >-
  Standard Operating Procedure for Fullstack Engineering, Refactoring, and Git Workflows.
  Activate whenever planning features, refactoring existing modules, modifying layouts,
  or preparing git commits.
---

# Fullstack Development Workflow & Engineering Standards

This skill defines the mandatory engineering process from requirement intake to production-ready commit.

---

## 1. Five-Stage Development Protocol (五阶段工程交付铁律)

```mermaid
graph TD
    A[1. 影响面与边界评估] --> B[2. 设计方案与不变量对齐]
    B --> C[3. 范围收敛开发 (严禁改动无关文件)]
    C --> D[4. 双重全量验证 (Typecheck + Vitest)]
    D --> E[5. 本地 Git 原子提交]
```

### Stage 1: 影响面与边界评估 (Impact Analysis)
- 严禁盲目直接修改核心公共组件（如 `Button.tsx`、全局布局 `layout.tsx`）。
- 若需求只针对特定局部（如页面头部按钮），优先在局部组件内针对性调整或新增专用 variant，绝对不可全局覆盖导致其他页面/表格列破坏。

### Stage 2: 设计方案与不变量对齐 (Invariants Alignment)
- 修改数据流转或状态机前，必须检查 4 大业务不变量：
  1. 历史业绩与商机所有权不可篡改；
  2. 在途商机未结案阻断公海释放；
  3. 认领记录真实 `claimed_at` 保护期；
  4. 数据权限服务端行级强制隔离。

### Stage 3: 范围收敛开发 (Scope Confinement)
- **侧边栏与核心布局锁**: 严格保留左侧导航侧边栏 (`AppSidebar.tsx`)，严禁私自替换为顶部导航栏。
- **改动最小化**: 仅修改需求明确指出的文件与逻辑，不引入无意义的跨模块重构。

### Stage 4: 双重全量验证 (Mandatory Verification)
- 必须执行 `pnpm typecheck`（TypeScript 零错误）。
- 必须执行 `pnpm test`（49 个测试套件、280+ 测试用例 100% 通过）。

### Stage 5: 本地 Git 原子提交 (Atomic Git Commit)
- 每次开始新任务前确保 `git status` 干净。
- 每个独立功能或修复形成独立的原子提交，提交信息严格遵循 Conventional Commits（`feat:`, `fix:`, `refactor:`）。
