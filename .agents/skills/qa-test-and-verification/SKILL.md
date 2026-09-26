---
name: qa-test-and-verification
description: >-
  Automated Quality Assurance, Database Migration, and Regression Testing Playbook.
  Activate whenever creating migrations, fixing business bugs, adding test suites,
  or validating system reliability.
---

# QA Test & Verification Playbook

This skill outlines testing standards, regression coverage strategies, and database verification routines.

---

## 1. Regression Test First Invariant (缺陷回归测试前置)

Whenever fixing a logic defect (e.g. quota cross-month borrowing, unauthorized data leak, deal hijacking):

1. **编写复现测试用例**: 在 `tests/integration/` 或 `tests/unit/` 中先写出能精准命中该 Bug 的测试用例（Red）。
2. **执行代码修复**: 修复底层 SQL 或业务逻辑（Green）。
3. **回归验证**: 确保新增测试用例通过，且既有全部 49 个测试文件无任何断言失败。

---

## 2. Database Migration Safety Standards (数据库迁移安全)

1. **增量唯一命名**: 迁移文件遵循 `scripts/migrations/XXXX_description.sql` 递增编号规范。
2. **幂等与非破坏性**:
   - 表创建使用 `CREATE TABLE IF NOT EXISTS`；
   - 索引创建使用 `CREATE INDEX IF NOT EXISTS`；
   - 新增字段若不允许为空必须提供合法的 `DEFAULT` 值。
3. **测试库自动同步**: 确保 `scripts/prepare-test-db.ts` 能在隔离测试数据库上自动顺序执行全量迁移。

---

## 3. Mandatory Test Commands

```bash
# 1. 类型校验 (必须 0 错误)
pnpm typecheck

# 2. 自动化全量单元与集成测试 (必须 100% Pass)
pnpm test
```
