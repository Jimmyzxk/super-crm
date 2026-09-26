import "dotenv/config";
import pg from "pg";

type Counts = { customers: number; leads: number; opportunities: number; activities: number };

const DEFAULT_COUNTS: Counts = { customers: 1_000, leads: 5_000, opportunities: 5_000, activities: 20_000 };

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} 必须是非负整数`);
  return parsed;
}

function readCounts(): Counts {
  const args = new Map(process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split("=", 2);
    return [key, value] as const;
  }));
  return {
    customers: positiveInteger(args.get("--customers"), DEFAULT_COUNTS.customers, "customers"),
    leads: positiveInteger(args.get("--leads"), DEFAULT_COUNTS.leads, "leads"),
    opportunities: positiveInteger(args.get("--opportunities"), DEFAULT_COUNTS.opportunities, "opportunities"),
    activities: positiveInteger(args.get("--activities"), DEFAULT_COUNTS.activities, "activities"),
  };
}

function assertSafeCapacityDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const database = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_capacity(?:_[a-z0-9_]+)?$/.test(database)) {
    throw new Error("容量数据生成器只允许连接名称以 _capacity 结尾的数据库");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("容量数据生成器只允许连接本机 PostgreSQL；如需远程压测请建立单独的受控流程");
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.CAPACITY_DATABASE_URL;
  if (!connectionString) throw new Error("CAPACITY_DATABASE_URL is required");
  assertSafeCapacityDatabase(connectionString);

  const counts = readCounts();
  if (counts.opportunities > 0 && counts.customers === 0) throw new Error("生成商机时 customers 必须大于 0");
  if (counts.activities > 0 && counts.opportunities === 0) throw new Error("生成跟进记录时 opportunities 必须大于 0");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const schema = await client.query<{ tenants: string | null; users: string | null }>("select to_regclass('public.tenants')::text as tenants, to_regclass('public.users')::text as users");
    if (!schema.rows[0]?.tenants || !schema.rows[0]?.users) throw new Error("容量数据库尚未完成迁移");
    await client.query("begin");
    await client.query("set local synchronous_commit = off");

    const tenant = await client.query<{ id: string }>(
      "insert into tenants (name) values ($1) returning id",
      [`容量基线 ${new Date().toISOString()}`],
    );
    const tenantId = tenant.rows[0].id;
    const users = await client.query<{ id: string; role: string }>(
      `insert into users (tenant_id, email, password_hash, name, role)
       values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', '容量销售', 'SALES'),
              ($1, $3, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', '容量主管', 'MANAGER')
       returning id, role`,
      [tenantId, `capacity-sales-${tenantId}@example.com`, `capacity-manager-${tenantId}@example.com`],
    );
    const salesId = users.rows.find((user) => user.role === "SALES")?.id;
    const managerId = users.rows.find((user) => user.role === "MANAGER")?.id;
    if (!salesId || !managerId) throw new Error("容量基线用户创建失败");

    await client.query("create temp table capacity_customer_ids (ordinal bigint primary key, id uuid not null, owner_user_id uuid not null) on commit drop");
    if (counts.customers > 0) {
      await client.query(
        `insert into capacity_customer_ids (ordinal, id, owner_user_id)
         select n, gen_random_uuid(), $2 from generate_series(1, $1::bigint) as rows(n)`,
        [counts.customers, salesId],
      );
      await client.query(
        `insert into customers (id, tenant_id, owner_user_id, name, industry, region, last_activity_at)
         select id, $1, owner_user_id, '容量客户-' || ordinal, case when ordinal % 3 = 0 then '制造业' else '软件' end,
           case when ordinal % 2 = 0 then '华东' else '华南' end,
           now() - ((ordinal % 30)::text || ' days')::interval
         from capacity_customer_ids`,
        [tenantId],
      );
    }

    await client.query("create temp table capacity_opportunity_ids (ordinal bigint primary key, id uuid not null, customer_id uuid not null, owner_user_id uuid not null) on commit drop");
    if (counts.opportunities > 0 && counts.customers > 0) {
      await client.query(
        `insert into capacity_opportunity_ids (ordinal, id, customer_id, owner_user_id)
         select rows.n, gen_random_uuid(), c.id, $2
         from generate_series(1, $1::bigint) as rows(n)
         join capacity_customer_ids c on c.ordinal = ((rows.n - 1) % $3::bigint) + 1`,
        [counts.opportunities, salesId, counts.customers],
      );
      await client.query(
        `insert into opportunities (id, tenant_id, customer_id, owner_user_id, name, stage, expected_close_at, demand_note)
         select id, $1, customer_id, owner_user_id, '容量商机-' || ordinal,
           case when ordinal % 10 < 5 then 'DISCOVERY'::opportunity_stage
                when ordinal % 10 < 8 then 'PROPOSAL'::opportunity_stage
                else 'NEGOTIATION'::opportunity_stage end,
           current_date + ((ordinal % 90)::int), '容量基线需求'
         from capacity_opportunity_ids`,
        [tenantId],
      );
    }

    await client.query("create temp table capacity_lead_ids (ordinal bigint primary key, id uuid not null, owner_user_id uuid) on commit drop");
    if (counts.leads > 0) {
      await client.query(
        `insert into capacity_lead_ids (ordinal, id, owner_user_id)
         select n, gen_random_uuid(), case when n % 20 = 0 then null else $2::uuid end
         from generate_series(1, $1::bigint) as rows(n)`,
        [counts.leads, salesId],
      );
      await client.query(
        `insert into leads (id, tenant_id, owner_user_id, contact_name, contact_phone, company_name, source, status, score, score_reason, scored_at)
         select id, $1, owner_user_id, '容量线索-' || ordinal, '138' || lpad((ordinal % 100000000)::text, 8, '0'),
           '容量公司-' || ordinal, 'import', case when ordinal % 10 < 6 then 'NEW'::lead_status when ordinal % 10 < 9 then 'CONTACTED'::lead_status else 'QUALIFIED'::lead_status end,
           (ordinal % 101)::int, '容量基线规则', now()
         from capacity_lead_ids`,
        [tenantId],
      );
    }

    if (counts.activities > 0 && counts.opportunities > 0) {
      await client.query(
        `insert into activities (tenant_id, opportunity_id, user_id, type, outcome, summary, occurred_at)
         select $1, o.id, $3,
           case when rows.n % 5 = 0 then 'NOTE'::activity_type when rows.n % 2 = 0 then 'CALL'::activity_type else 'MESSAGE'::activity_type end,
           case when rows.n % 5 = 0 then null else 'CONNECTED'::activity_outcome end,
           '容量基线跟进-' || rows.n, now() - ((rows.n % 180)::text || ' days')::interval
         from generate_series(1, $2::bigint) as rows(n)
         join capacity_opportunity_ids o on o.ordinal = ((rows.n - 1) % $4::bigint) + 1`,
        [tenantId, counts.activities, salesId, counts.opportunities],
      );
    }

    const leadTaskCount = counts.leads > 0 ? Math.max(1, Math.floor(counts.leads / 20)) : 0;
    if (leadTaskCount > 0) {
      await client.query(
        `insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
         select $1, l.id, $3, 'FOLLOW_UP'::task_type,
           case when l.ordinal % 2 = 0 then now() - interval '2 hours' else now() + interval '2 days' end
         from capacity_lead_ids l where l.ordinal <= $2`,
        [tenantId, leadTaskCount, salesId],
      );
    }
    const opportunityTaskCount = counts.opportunities > 0 ? Math.max(1, Math.floor(counts.opportunities / 20)) : 0;
    if (opportunityTaskCount > 0) {
      await client.query(
        `insert into tasks (tenant_id, opportunity_id, assignee_user_id, type, due_at)
         select $1, o.id, $3, 'STAGE_PUSH'::task_type,
           case when o.ordinal % 2 = 0 then now() - interval '2 hours' else now() + interval '2 days' end
         from capacity_opportunity_ids o where o.ordinal <= $2`,
        [tenantId, opportunityTaskCount, salesId],
      );
    }
    const customerTaskCount = counts.customers > 0 ? Math.max(1, Math.floor(counts.customers / 20)) : 0;
    if (customerTaskCount > 0) {
      await client.query(
        `insert into tasks (tenant_id, customer_id, assignee_user_id, type, due_at)
         select $1, c.id, $3, 'FOLLOW_UP'::task_type,
           case when c.ordinal % 2 = 0 then now() - interval '2 hours' else now() + interval '2 days' end
         from capacity_customer_ids c where c.ordinal <= $2`,
        [tenantId, customerTaskCount, salesId],
      );
    }

    await client.query("analyze leads");
    await client.query("analyze customers");
    await client.query("analyze opportunities");
    await client.query("analyze activities");
    await client.query("analyze tasks");
    await client.query("commit");

    console.log(JSON.stringify({ tenantId, salesId, managerId, counts, leadTaskCount, opportunityTaskCount, customerTaskCount }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
