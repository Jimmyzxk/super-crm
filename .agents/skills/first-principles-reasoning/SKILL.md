---
name: first-principles-reasoning
description: >-
  First-Principles Problem Decomposition & State-Machine Mathematical Modeling.
  Use when architecting new complex features, debugging elusive multi-state bugs,
  or designing mission-critical state transitions.
---

# First-Principles Reasoning & State-Machine Modeling

## Core Principle
"Never reason by analogy or surface resemblance. Break every feature down to fundamental truths: Entities, State Transitions, Pre-conditions, Invariants, and Post-conditions."

---

## 1. The 5-Step First-Principles Framework

1. **Identify the True Entity State (状态真理)**:
   - What is the minimal state required to describe this system?
   - Example: A Customer is either `PRIVATE(owner_user_id = UUID)` or `PUBLIC(owner_user_id = NULL)`.
2. **Define Legal State Transitions (合法状态跃迁)**:
   - `PRIVATE -> PUBLIC`: Valid ONLY if in-flight deals count == 0.
   - `PUBLIC -> PRIVATE`: Valid ONLY if caller is authorized sales rep AND updates `claimed_at = NOW()`.
3. **Establish Invariants (系统不变量)**:
   - Formula: `ClosedARR(rep) = SUM(deals.amount WHERE status = 'WON' AND owner = rep)`. This sum must NEVER decrease when a customer enters the public pool.
4. **Enforce Design-by-Contract (契约式设计)**:
   - Pre-condition: Check input validity & permissions at API boundary.
   - Post-condition: Assert expected state after DB commit.
5. **Verify with Extreme Boundary Cases (极限边界压测)**:
   - 0 users, 1 user, 100,000 users.
   - Dec 31 23:59:59 -> Jan 1 00:00:00 year boundary.
   - Concurrent simultaneous claim race conditions.
