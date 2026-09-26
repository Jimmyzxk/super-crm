---
name: crm-domain-guard
description: >-
  Enterprise B2B CRM Domain Invariants and Adversarial Business Logic Guard.
  Activate whenever modifying CRM customer lifecycle, lead conversion, deal ownership,
  quota management, public/private pool transitions, or data privacy rules.
---

# B2B CRM Domain Invariants & Adversarial Business Logic Guard

This skill equips the agent with domain-specific verification procedures for enterprise B2B CRM engineering. It prevents regression on high-risk business logic such as deal hijacking, performance falsification, period fallback bugs, and data privacy leaks.

---

## 1. Adversarial Scenario Checklist (对抗性业务场景审查清单)

Whenever modifying customer pools, lead lifecycle, or deal pipelines, verify against these scenarios:

### Scenario A: Deal Hijacking & Historical Won/Lost Protection
* **Risk**: When a customer moves from Private Pool to Public Pool, or is claimed by Sales B, a naive query might reassign `deal.owner_user_id` to Sales B or `null`.
* **Invariant**: 
  - Historical won/lost deals (`status IN ('WON', 'LOST')`) MUST permanently remain assigned to the salesperson who closed them (`owner_user_id` never changes).
  - Commission and leaderboard history must be immutable.

### Scenario B: In-Flight Deal Lock on Pool Release
* **Risk**: A sales rep releases a customer to public pool while actively negotiating a high-value deal, or a competing rep claims the customer and steals the deal in progress.
* **Invariant**:
  - If a customer has active, non-terminal deals (`status NOT IN ('WON', 'LOST')`), the system MUST reject release to public pool and reject claims by other reps.
  - The UI/service must prompt the user to win, lose, or explicitly transfer the deal before releasing the customer.

### Scenario C: Sleep Customer Re-Claim Protection Period
* **Risk**: A sales rep claims a dormant customer from the public pool. Because the customer hasn't had activity in 30 days, the recycling cron immediately reclaims the customer back to the public pool the next hour.
* **Invariant**:
  - A claimed customer MUST record `claimed_at = NOW()`.
  - The pool recycling logic must consider `GREATEST(claimed_at, last_activity_at)` to guarantee a minimum protection window (e.g. 7 days).

### Scenario D: Quota Period Precision & Cross-Month Isolation
* **Risk**: A quota query uses `WHERE (period = $1 OR period IS NOT NULL) LIMIT 1`, causing August to display January's target if August has no quota configured.
* **Invariant**:
  - Quota queries MUST use strict equality: `WHERE period = $currentPeriod`.
  - If no quota exists for the requested period, fall back to the system default base target (e.g. 200,000) or explicit zero, NEVER borrow from a different month.
  - Dynamic time generation MUST use `new Date().getFullYear()` instead of hardcoded strings like `'2026'`.

### Scenario E: Row-Level Data Privacy & PII Masking
* **Risk**: Returning all team members' phone numbers and emails to a regular sales rep without authorization or audit logging.
* **Invariant**:
  - `SALES` role queries on quotas, leads, or customers must enforce `WHERE user_id = ctx.userId` in the backend service layer.
  - Phone numbers and emails displayed in lists must use the `MaskedPhone` component.
  - Viewing unmasked PII must trigger an `audit_logs` entry.

---

## 2. Pre-Commit Verification Workflow

Before concluding any CRM feature or bugfix:

1. **Typecheck & Integrity**: Run `pnpm typecheck` (zero TypeScript errors).
2. **Automated Integration Tests**: Run `pnpm test` (all integration and unit suites pass).
3. **Design System Consistency**:
   - Header CTA buttons use `size="md"` with standard SVG plus icon.
   - Table action buttons use concise 2-character verb (`编辑`).
4. **Git Discipline**: Ensure clean, atomic git commits with descriptive messages.
