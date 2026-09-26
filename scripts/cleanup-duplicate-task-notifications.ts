import pg from "pg";
import "dotenv/config";

async function main() {
  const connectionString =
    process.env.DATABASE_URL || "postgres://salescrm:salescrm_dev@localhost:54329/salescrm";
  const client = new pg.Client({ connectionString });
  await client.connect();

  console.log("Connecting to DB and checking duplicate task notifications...");

  const checkSql = `
    with ranked as (
      select
        id,
        tenant_id,
        coalesce(
          task_id::text,
          substring(link from '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
          link,
          title
        ) as dedup_key,
        type,
        row_number() over (
          partition by
            tenant_id,
            coalesce(
              task_id::text,
              substring(link from '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
              link,
              title
            ),
            type
          order by created_at desc, id desc
        ) as rn
      from notifications
      where type in ('TASK_OVERDUE', 'TASK_DUE_SOON')
    )
    select count(*)::int as dup_count from ranked where rn > 1;
  `;

  const beforeRes = await client.query<{ dup_count: number }>(checkSql);
  const dupCount = Number(beforeRes.rows[0]?.dup_count || 0);
  console.log(`Found ${dupCount} duplicate task notifications.`);

  if (dupCount > 0) {
    const deleteSql = `
      with ranked as (
        select
          id,
          tenant_id,
          coalesce(
            task_id::text,
            substring(link from '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
            link,
            title
          ) as dedup_key,
          type,
          row_number() over (
            partition by
              tenant_id,
              coalesce(
                task_id::text,
                substring(link from '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
                link,
                title
              ),
              type
            order by created_at desc, id desc
          ) as rn
        from notifications
        where type in ('TASK_OVERDUE', 'TASK_DUE_SOON')
      )
      delete from notifications
      where id in (
        select id from ranked where rn > 1
      );
    `;
    const deleteRes = await client.query(deleteSql);
    console.log(`Deleted ${deleteRes.rowCount} duplicate task notifications successfully.`);
  } else {
    console.log("No duplicate task notifications to delete.");
  }

  await client.end();
}

main().catch((err) => {
  console.error("Cleanup script failed:", err);
  process.exit(1);
});
