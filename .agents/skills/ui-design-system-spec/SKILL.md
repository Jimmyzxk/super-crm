---
name: ui-design-system-spec
description: >-
  Atomic Design System Tokens, UI Layout, and Visual Component Standardization.
  Activate whenever modifying buttons, table action columns, search toolbars,
  navigation sidebars, modal headers, or layout components.
---

# UI Design System & Visual Standardization Spec

This skill enforces strict visual alignment, component tokens, and layout invariants across the entire CRM web application.

---

## 1. Button Specification Matrix (全站按钮规范标准)

| 场景 / 类型 | 属性配置 | 视觉样式与尺寸 | 图标与文案规范 |
| :--- | :--- | :--- | :--- |
| **页面头部主要 CTA** | `variant="primary"` `size="md"` | `bg-slate-900 hover:bg-slate-800 text-white font-semibold shadow-xs px-3.5 py-1.5 rounded-lg text-xs` | 内置 `w-4 h-4` 矢量加号 SVG (`strokeWidth="2"`), **严禁使用文本加号 `+`** |
| **页面头部次要操作** | `variant="secondary"` `size="md"` | `bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 shadow-2xs px-3.5 py-1.5 rounded-lg text-xs font-semibold` | 纯文本或辅助功能图标（如同步/导入） |
| **数据表格行内操作** | `variant="secondary"` `size="xs"` | `bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 shadow-2xs h-6 px-2 text-[11px] rounded-md` | 统一采用双字动词（如 `编辑`、`查看`、`删除`、`交接`） |
| **危险破坏性操作** | `variant="danger"` `size="xs" / "sm"` | `bg-rose-600 hover:bg-rose-700 text-white shadow-xs` | 触发时必须伴随确认弹窗二次拦截 |

---

## 2. Search & Filter Toolbar Standards (搜索与筛选工具条规范)

- **容器结构**: `flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white p-2.5 shadow-2xs`
- **左侧状态胶囊 (Segmented Track)**: `inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100/90 rounded-lg border border-slate-200/70 shadow-2xs`
- **右侧集成搜索框 (Full-Flex)**: 内置放大镜图标与一键清空 `×` 按钮，防止折行与宽度异常挤压。

---

## 3. Global Layout Invariants (全局布局不可变性)

- **左侧导航侧边栏 (`AppSidebar.tsx`) 永久保留**:
  - 宽度固定、深色主题、高阶状态指示点与 Badge。
  - **严禁将左侧侧边栏替换为顶部横向导航栏**。
