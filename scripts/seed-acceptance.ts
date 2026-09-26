import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";
import { normalizeEmail } from "../src/core/auth/types";
import { assertSeedAllowed } from "./seed/guard";

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const password = process.env.DEV_ADMIN_PASSWORD ?? "";
const managerEmail = normalizeEmail(process.env.DEV_MANAGER_EMAIL ?? "manager@example.com");
const salesEmail = normalizeEmail(process.env.DEV_SALES_EMAIL ?? "sales@example.com");

const ids = {
  tenant: "00000000-0000-4000-8000-000000000001",
  activeLead: "10000000-0000-4000-8000-000000000001",
  activeCustomer: "20000000-0000-4000-8000-000000000001",
  activeContact: "30000000-0000-4000-8000-000000000001",
  activeOpportunity: "40000000-0000-4000-8000-000000000001",
  activeActivity: "50000000-0000-4000-8000-000000000001",
  activeTask: "60000000-0000-4000-8000-000000000001",
  demoLeadNew: "10000000-0000-4000-8000-000000000002",
  demoLeadContacted: "10000000-0000-4000-8000-000000000003",
  demoLeadQualified: "10000000-0000-4000-8000-000000000004",
  wonCustomers: [


    "20000000-0000-4000-8000-000000000011",
    "20000000-0000-4000-8000-000000000012",
    "20000000-0000-4000-8000-000000000013",
  ],
  wonOpportunities: [
    "40000000-0000-4000-8000-000000000011",
    "40000000-0000-4000-8000-000000000012",
    "40000000-0000-4000-8000-000000000013",
  ],
  winReviews: [
    "70000000-0000-4000-8000-000000000011",
    "70000000-0000-4000-8000-000000000012",
    "70000000-0000-4000-8000-000000000013",
  ],
  playbook: "80000000-0000-4000-8000-000000000001",
  playbookSamples: [
    "90000000-0000-4000-8000-000000000011",
    "90000000-0000-4000-8000-000000000012",
    "90000000-0000-4000-8000-000000000013",
  ],
} as const;

function assertSafeDevelopmentDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Acceptance seed must not run in production");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Acceptance seed only allows a local PostgreSQL host");
  }
  if (url.pathname !== "/salescrm") {
    throw new Error("Acceptance seed only allows the local salescrm database");
  }
}

async function upsertDemoUser(
  client: pg.Client,
  input: { email: string; name: string; role: "MANAGER" | "SALES" },
): Promise<string> {
  const found = await client.query<{ id: string; tenant_id: string; password_hash: string }>(
    "select id, tenant_id, password_hash from users where email = $1 for update",
    [input.email],
  );
  const existing = found.rows[0];
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 12);
    const inserted = await client.query<{ id: string }>(
      `insert into users (tenant_id, email, password_hash, name, role, status)
       values ($1, $2, $3, $4, $5, 'ACTIVE') returning id`,
      [ids.tenant, input.email, passwordHash, input.name, input.role],
    );
    return inserted.rows[0].id;
  }
  if (existing.tenant_id !== ids.tenant) {
    throw new Error(`Demo email already belongs to another tenant: ${input.email}`);
  }
  const passwordMatches = await bcrypt.compare(password, existing.password_hash);
  const passwordHash = passwordMatches ? existing.password_hash : await bcrypt.hash(password, 12);
  await client.query(
    `update users set password_hash = $2, name = $3, role = $4, status = 'ACTIVE',
       session_version = session_version + case when $5::boolean then 0 else 1 end,
       failed_login_count = 0, locked_until = null, updated_at = now()
     where id = $1`,
    [existing.id, passwordHash, input.name, input.role, passwordMatches],
  );
  return existing.id;
}

async function main(): Promise<void> {
  if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required");
  if (password.length < 8 || !managerEmail || !salesEmail || managerEmail === salesEmail) {
    throw new Error("A valid DEV_ADMIN_PASSWORD and two distinct demo emails are required");
  }
  assertSafeDevelopmentDatabase(migrationUrl);

  const client = new pg.Client({ connectionString: migrationUrl });
  try {
    await client.connect();
    await client.query("begin");
    await client.query(
      `insert into tenants (id, name, status) values ($1, '本地演示企业', 'ACTIVE')
       on conflict (id) do update set name = excluded.name, status = excluded.status, updated_at = now()`,
      [ids.tenant],
    );
    await client.query(
      `insert into plugin_registry (tenant_id, plugin_key, enabled)
       values
         ($1, 'form-capture', true),
         ($1, 'knowledge-base', true),
         ($1, 'lead-routing', true)
       on conflict (tenant_id, plugin_key) do update set enabled = true`,
      [ids.tenant],
    );
    const managerId = await upsertDemoUser(client, { email: managerEmail, name: "演示主管", role: "MANAGER" });
    const salesId = await upsertDemoUser(client, { email: salesEmail, name: "演示销售", role: "SALES" });

    await client.query(
      `insert into customers (id, tenant_id, owner_user_id, name, industry, region, size)
       values ($1, $2, $3, '华东制造示范客户', '制造', '华东', '101-500')
       on conflict (id) do nothing`,
      [ids.activeCustomer, ids.tenant, salesId],
    );
    await client.query(
      `insert into contacts (id, tenant_id, customer_id, name, phone, title, is_primary)
       values ($1, $2, $3, '陈采购', '13800009001', '采购总监', true)
       on conflict (id) do nothing`,
      [ids.activeContact, ids.tenant, ids.activeCustomer],
    );
    await client.query(
      `insert into leads (id, tenant_id, owner_user_id, customer_id, contact_name, contact_phone,
         company_name, title, source, status, score, score_reason, scored_at)
       values ($1, $2, $3, $4, '陈采购', '13800009001', '华东制造示范客户', '采购总监',
         'manual', 'CONVERTED', 86, '需求明确、角色关键且已有下一步计划', now())
       on conflict (id) do nothing`,
      [ids.activeLead, ids.tenant, salesId, ids.activeCustomer],
    );
    await client.query(
      `insert into opportunities (id, tenant_id, customer_id, owner_user_id, primary_contact_id,
         from_lead_id, name, stage, expected_amount, expected_close_at, demand_note,
         created_at, stage_entered_at)
       values ($1, $2, $3, $4, $5, $6, '产线数字化升级', 'PROPOSAL', 480000,
         current_date + 30, '已完成需求访谈，待确认方案评审参与人。',
         now() - interval '12 days', now() - interval '3 days')
       on conflict (id) do nothing`,
      [ids.activeOpportunity, ids.tenant, ids.activeCustomer, salesId, ids.activeContact, ids.activeLead],
    );
    await client.query(
      `insert into lead_conversions (tenant_id, lead_id, customer_id, opportunity_id, converted_by_user_id,
         created_at)
       values ($1, $2, $3, $4, $5, now() - interval '12 days')
       on conflict (tenant_id, lead_id) do nothing`,
      [ids.tenant, ids.activeLead, ids.activeCustomer, ids.activeOpportunity, salesId],
    );
    await client.query(
      `insert into activities (id, tenant_id, opportunity_id, user_id, type, outcome, summary, occurred_at)
       values ($1, $2, $3, $4, 'MEETING', 'INTERESTED', '完成需求访谈，客户同意进入方案评审', now() - interval '2 days')
       on conflict (id) do nothing`,
      [ids.activeActivity, ids.tenant, ids.activeOpportunity, salesId],
    );
    await client.query(
      `insert into tasks (id, tenant_id, opportunity_id, assignee_user_id, type, due_at)
       values ($1, $2, $3, $4, 'STAGE_PUSH', now() + interval '1 day')
       on conflict (id) do nothing`,
      [ids.activeTask, ids.tenant, ids.activeOpportunity, salesId],
    );

    // 1. 待首次响应线索 (NEW)
    await client.query(
      `insert into leads (id, tenant_id, owner_user_id, contact_name, contact_phone,
         company_name, title, source, status, score, score_reason, scored_at)
       values ($1, $2, $3, '王总监', '13911112222', '智造未来科技有限公司', '信息总监',
         'api:website', 'NEW', 92, '角色关键、高匹配度行业与规模', now())
       on conflict (id) do update set status = 'NEW', updated_at = now()`,
      [ids.demoLeadNew, ids.tenant, salesId],
    );
    await client.query(
      `insert into tasks (id, tenant_id, lead_id, assignee_user_id, type, due_at)
       values ('60000000-0000-4000-8000-000000000002', $1, $2, $3, 'FIRST_RESPONSE', now() + interval '4 hours')
       on conflict (id) do nothing`,
      [ids.tenant, ids.demoLeadNew, salesId],
    );

    // 2. 已联系线索 (CONTACTED)
    await client.query(
      `insert into leads (id, tenant_id, owner_user_id, contact_name, contact_phone,
         company_name, title, source, status, score, score_reason, scored_at)
       values ($1, $2, $3, '李经理', '13833334444', '华南工业互联装备', '采购经理',
         'manual', 'CONTACTED', 75, '已完成首次电话沟通，有意向进一步交流', now())
       on conflict (id) do update set status = 'CONTACTED', updated_at = now()`,
      [ids.demoLeadContacted, ids.tenant, salesId],
    );
    await client.query(
      `insert into activities (id, tenant_id, lead_id, user_id, type, outcome, summary, occurred_at)
       values ('50000000-0000-4000-8000-000000000002', $1, $2, $3, 'CALL', 'INTERESTED', '电话沟通顺利，客户正在评估新一代MES生产管理系统', now() - interval '1 day')
       on conflict (id) do nothing`,
      [ids.tenant, ids.demoLeadContacted, salesId],
    );
    await client.query(
      `insert into tasks (id, tenant_id, lead_id, assignee_user_id, type, due_at)
       values ('60000000-0000-4000-8000-000000000003', $1, $2, $3, 'FOLLOW_UP', now() + interval '1 day')
       on conflict (id) do nothing`,
      [ids.tenant, ids.demoLeadContacted, salesId],
    );

    // 3. 已确认需求线索 (QUALIFIED)
    await client.query(
      `insert into leads (id, tenant_id, owner_user_id, contact_name, contact_phone,
         company_name, title, source, status, score, score_reason, scored_at)
       values ($1, $2, $3, '张总', '13755556666', '东方重工制造集团', '总经理',
         'import', 'QUALIFIED', 88, '需求已明确，预算已获批，等待建商机推进', now())
       on conflict (id) do update set status = 'QUALIFIED', updated_at = now()`,
      [ids.demoLeadQualified, ids.tenant, salesId],
    );

    await client.query(
      `insert into activities (id, tenant_id, lead_id, user_id, type, outcome, summary, occurred_at)
       values ('50000000-0000-4000-8000-000000000003', $1, $2, $3, 'VISIT', 'INTERESTED', '上门拜访，与客户高层就改造方案与交付期达成一致', now() - interval '2 days')
       on conflict (id) do nothing`,
      [ids.tenant, ids.demoLeadQualified, salesId],
    );


    for (let index = 0; index < ids.wonCustomers.length; index += 1) {
      await client.query(
        `insert into customers (id, tenant_id, owner_user_id, name, industry, region, size)
         values ($1, $2, $3, $4, '制造', '华东', '101-500')
         on conflict (id) do nothing`,
        [ids.wonCustomers[index], ids.tenant, salesId, `赢单样本客户 ${index + 1}`],
      );
      await client.query(
        `insert into opportunities (id, tenant_id, customer_id, owner_user_id, name, stage,
           actual_amount, actual_close_at, created_at, stage_entered_at)
         values ($1, $2, $3, $4, $5, 'WON', $6, current_date - $7::int,
           now() - (($7::text || ' days')::interval + interval '20 days'), now() - ($7::text || ' days')::interval)
         on conflict (id) do nothing`,
        [ids.wonOpportunities[index], ids.tenant, ids.wonCustomers[index], salesId,
          `制造业数字化赢单 ${index + 1}`, 320000 + index * 80000, 10 + index],
      );
      await client.query(
        `insert into win_reviews (id, tenant_id, opportunity_id, status, summary, metrics, evidence,
           reviewed_by_user_id, review_reason, reviewed_at)
         values ($1, $2, $3, 'REVIEWED', $4, $5::jsonb, $6::jsonb, $7,
           '事实与原始跟进记录一致，可作为团队打法样本', now() - interval '2 days')
         on conflict (id) do nothing`,
        [
          ids.winReviews[index], ids.tenant, ids.wonOpportunities[index],
          `样本 ${index + 1} 在方案阶段确认决策链和下次会议时间，并按三天节奏推进。以上仅陈述已记录事实。`,
          JSON.stringify({ effectiveFollowUpCount: 5 + index, actualAmount: String(320000 + index * 80000) }),
          JSON.stringify([{ kind: "FACT", summary: "方案评审前确认决策链与下一步日期" }]),
          managerId,
        ],
      );
    }

    const claimEvidence = {
      checkpoints: ids.winReviews,
      recommendedCadence: ids.winReviews,
      effectiveActions: ids.winReviews,
      commonRisks: ids.winReviews,
    };
    await client.query(
      `insert into sales_playbooks (id, tenant_id, family_key, version, name, target_stage,
         applicable_industries, excluded_industries, applicable_regions, excluded_regions,
         applicable_customer_sizes, excluded_customer_sizes, checkpoints, recommended_cadence,
         effective_actions, common_risks, claim_evidence, created_by_user_id)
       values ($1, $2, 'manufacturing-proposal', 1, '制造业方案推进法', 'PROPOSAL',
         '["制造"]', '[]', '["华东"]', '[]', '["101-500"]', '[]',
         '["确认预算、决策链和方案评审参与人"]', '["每 3 天至少一次有效推进"]',
         '["每次沟通结束前确认下一步日期"]', '["只有口头认可但没有明确下一步时间"]',
         $3::jsonb, $4)
       on conflict (id) do nothing`,
      [ids.playbook, ids.tenant, JSON.stringify(claimEvidence), managerId],
    );
    const playbook = await client.query<{ status: "DRAFT" | "PUBLISHED" | "RETIRED" }>(
      "select status from sales_playbooks where id = $1",
      [ids.playbook],
    );
    if (playbook.rows[0]?.status === "DRAFT") {
      for (let index = 0; index < ids.playbookSamples.length; index += 1) {
        await client.query(
          `insert into sales_playbook_samples (id, tenant_id, playbook_id, win_review_id)
           values ($1, $2, $3, $4) on conflict (id) do nothing`,
          [ids.playbookSamples[index], ids.tenant, ids.playbook, ids.winReviews[index]],
        );
      }
    }

    await client.query("commit");
    console.log(JSON.stringify({
      tenantId: ids.tenant,
      managerEmail,
      salesEmail,
      activeOpportunityId: ids.activeOpportunity,
      playbookStatus: playbook.rows[0]?.status,
    }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

// CLI 入口 guard：破坏性种子必须先过白名单/显式确认（fail-closed）
try {
  assertSeedAllowed();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
