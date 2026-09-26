---
name: adversarial-red-teaming
description: >-
  Adversarial Red-Teaming & Exploit Simulation Playbook.
  Activate before finalizing any business workflow, permission model, or pool transition
  to simulate malicious users, greedy sales reps, and edge-case exploiters.
---

# Adversarial Red-Teaming (对抗性红蓝攻防自审)

## Core Principle
"If a sales rep can exploit a loophole to steal a deal, claim unearned commission, or peek at competitor reps' quotas, they eventually will. Code must be mathematically exploit-proof."

---

## The 5 Adversarial Personas (五大红队破坏者演练)

Before closing any PR or feature, roleplay as these 5 exploiters:

### 1. The Deal Hijacker (抢单套利者)
- *Attack Vector*: Customer A is in public pool with 3 active deals. Can I claim the customer and instantly take over $500,000 in-flight pipeline?
- *Defense Check*: System MUST block pool release and claim whenever active deals exist.

### 2. The Performance Forger (业绩窃取者)
- *Attack Vector*: Customer B closed a $1M deal last year under Sales Alice. Can Sales Bob claim Customer B from the pool and have the $1M historical ARR credited to Bob?
- *Defense Check*: Historical `WON/LOST` deals are strictly immutable (`owner_user_id` is locked forever).

### 3. The Pool Sniper (公海狙击手)
- *Attack Vector*: A dormant customer has had no activity for 60 days. Sales Alice claims it. Does the background recycling cron immediately snatch it back in 10 minutes?
- *Defense Check*: Claim records `claimed_at = NOW()`, giving Alice a guaranteed 7-day immunity window.

### 4. The Peeping Tom (越权偷窥者)
- *Attack Vector*: As a junior rep with `SALES` role, can I call the Quota API or inspect network payloads to view the top rep's targets, customer phone numbers, or management notes?
- *Defense Check*: Backend service layer MUST enforce `WHERE user_id = ctx.userId` and return masked PII.

### 5. The Time Traveler (时序穿梭者)
- *Attack Vector*: If August has no quota configured, can I query the leaderboard and inherit January's 990,000 target?
- *Defense Check*: Exact period equality (`period = $currentPeriod`) with deterministic zero/base fallback.
