---
name: b2b-company-intelligence
description: >-
  Deep B2B Company Intelligence & Account Research.
  Use when the user or sales rep wants to research a prospect company, enrich customer profile
  (business scope, revenue scale, decision maker map, tech stack), or prepare pre-call intelligence.
---

# B2B Company Intelligence & Account Enrichment

This skill orchestrates multi-source web intelligence to build comprehensive enterprise dossiers for sales prospecting and deal closing.

---

## 1. Intelligence Collection Dimensions

When analyzing a target enterprise, query live web and structured databases for:

1. **Company Foundations**:
   - Legal entity name, registration capital, headquarters, employee headcount bracket.
   - Core business model, revenue streams, and industry vertical (ICP classification).
2. **Key Decision Maker Map (EB / Tech / Procurement)**:
   - C-level executives (CEO, CTO, CIO, VP of Sales/Ops).
   - Department leads (Procurement Director, IT Director).
3. **Tech Stack & Digital Maturity**:
   - Current software infrastructure (ERP, CRM, Cloud Provider, Data Stack).
   - Recent digital transformation tenders, bidding announcements, and hiring signals.
4. **Financial Health & Recent Triggers**:
   - Funding rounds, quarterly earnings, expansion plans, M&A activity.
   - Risk alerts (legal disputes, negative PR, executive turnover).

---

## 2. Standard Output Dossier Format

Output the synthesized research as a structured markdown dossier:

```markdown
### 🏢 [Company Name] 深度企业情报档案

* **基本画像**: 行业领域 | 估算规模 (人数/营收) | 所在地
* **核心业务**: 一句话业务模式与主打产品
* **决策链画像 (EB/采购/技术)**:
  - 核心拍板人 (EB): 姓名 / 职务 / 背景
  - 技术评估人: 姓名 / 职务
* **痛点与切入契机 (Sales Trigger Events)**:
  - 近期动态 (中标/招聘/融资/扩产)
  - 业务痛点与采购诉求
* **推荐打单策略 (Actionable Next Steps)**:
  - 破冰切入点
  - 重点推介产品 SKU
```
