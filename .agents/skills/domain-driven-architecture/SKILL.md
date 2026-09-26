---
name: domain-driven-architecture
description: >-
  Domain-Driven Design (DDD) & Bounded Contexts Methodology for B2B CRM.
  Use when defining entities, value objects, aggregate roots, and boundary interactions.
---

# Domain-Driven Design (DDD) & Bounded Contexts

## Core Principle
"Probabilistic Brain, Deterministic Skeleton. LLMs reason creatively, but domain boundaries and business aggregates must be strictly enforced."

---

## 1. Bounded Context Map (CRM 限界上下文矩阵)

```
+-------------------------------------------------------------+
|                      Customer Context                       |
|  [Customer Aggregate Root]                                  |
|     ├── Contact (Child Entity - No Standalone Claim)        |
|     ├── PoolStatus (Value Object: Private / Public)         |
|     └── LifecycleStage (Lead -> Customer -> Account)        |
+-------------------------------------------------------------+
                              │
                    1:N (Deal Association)
                              ▼
+-------------------------------------------------------------+
|                        Deal Context                         |
|  [Deal / Opportunity Aggregate Root]                        |
|     ├── OwnerUserId (Immutable on WON/LOST)                 |
|     ├── LineItems (Product Snapshot & Unit Pricing)         |
|     └── Stage (QUALIFICATION -> PROPOSAL -> WON / LOST)    |
+-------------------------------------------------------------+
                              │
                    Calculates Attainment
                              ▼
+-------------------------------------------------------------+
|                        Quota Context                        |
|  [Sales Quota Aggregate]                                    |
|     ├── Period (Strict Value Object: '2026-08')             |
|     ├── TargetAmount (Decimal Numeric)                      |
|     └── ActualAttainment (Sum of Closed WON in Period)      |
+-------------------------------------------------------------+
```

## 2. Anti-Patterns to Prevent
1. **Domain Logic Bleed**: Letting a Contact entity trigger a Customer pool transition.
2. **Context Mixing**: Allowing Deals to borrow target metrics from mismatched quota periods.
3. **Anemic Domain Models**: Relying solely on client UI checks without rich backend invariant validation.
