---
name: fullstack-security-audit
description: >-
  Next.js & PostgreSQL Fullstack Security, RLS & Performance Auditor.
  Use when conducting code security reviews, auditing multi-tenant isolation,
  inspecting SQL query efficiency, or validating OWASP compliance before releases.
---

# Next.js & PostgreSQL Fullstack Security & Performance Auditor

This skill provides an automated audit playbook for multi-tenant Next.js App Router and PostgreSQL systems.

---

## 1. Security & Compliance Checklist

1. **Multi-Tenant Isolation (RLS / Tenant Context)**:
   - Ensure every database interaction passes through `withTenant` or explicitly filters `WHERE tenant_id = $tenantId`.
   - Verify `SALES` role queries cannot access other reps' quotas, unassigned pool secrets, or audit logs.
2. **Server Actions & Mutation Authorization**:
   - Verify all Next.js Server Actions validate `await requireAuth(role)` at the very top of the function.
   - Enforce Zod schema validation on all inputs before executing SQL queries.
3. **PII Data Protection & Masking**:
   - Verify phone numbers and emails in API responses and UI are masked by default.
   - Ensure unmasking actions generate audit logs in `audit_logs` table.
4. **SQL Injection & Invariant Defense**:
   - Use parameterized queries with `$1, $2` placeholders; never concatenate user inputs into raw SQL strings.
   - Guard against `LIMIT 1` period fallback bugs (e.g. quota cross-month borrowing).

---

## 2. Performance & Reliability Checklist

1. **N+1 Query Elimination**:
   - Replace loop queries with `JOIN` or `WHERE id = ANY($1)`.
2. **Postgres Index Coverage**:
   - Verify high-frequency filter columns (`tenant_id`, `status`, `owner_user_id`, `created_at`, `period`) have composite B-tree indexes.
3. **Client-Side Rendering Purity**:
   - Avoid non-pure calls (`new Date()`, `Math.random()`) in `useState` initializers.
   - Prevent setState waterfalls inside `useEffect`.
