#!/bin/sh
set -e

echo "=== [CRM Docker Entrypoint] Starting initialization ==="

# Wait for PostgreSQL to become available
if [ -n "$MIGRATION_DATABASE_URL" ]; then
  echo "Waiting for PostgreSQL database to be reachable..."
  until node -e '
    const pg = require("pg");
    const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    client.connect()
      .then(() => { client.end(); process.exit(0); })
      .catch((e) => { process.exit(1); });
  '; do
    echo "PostgreSQL is unavailable - sleeping 2 seconds..."
    sleep 2
  done
  echo "✓ PostgreSQL is reachable!"

  # Automatically run database migrations (protected by PostgreSQL advisory locks against multi-replica race conditions)
  if [ "$RUN_MIGRATIONS" != "false" ] && [ "$RUN_MIGRATIONS" != "0" ]; then
    echo "Running database migrations (protected by PostgreSQL advisory lock)..."
    pnpm db:migrate || {
      echo "⚠️ Warning: Database migration exited with code $?, retrying once..."
      sleep 2
      pnpm db:migrate
    }
    echo "✓ Database migrations completed successfully!"
  else
    echo "ℹ️ RUN_MIGRATIONS is set to false, skipping auto-migration (handled by external Job)."
  fi

  # Seed demo data if SEED_DEMO=true
  # 开源版（AGPL-3.0）：原 db:seed:demo 演示集含大量闭源插件数据，已随插件移除；
  # SEED_DEMO 现指向核心验收种子（db:seed:acceptance）。
  if [ "$SEED_DEMO" = "true" ] || [ "$SEED_DEMO" = "1" ]; then
    echo "SEED_DEMO is enabled. Seeding core acceptance demo data..."
    pnpm db:seed:acceptance || echo "⚠️ Demo seed completed with notice."
  elif [ "$SEED_DEV" = "true" ] || [ "$SEED_DEV" = "1" ]; then
    echo "SEED_DEV is enabled. Seeding dev data..."
    pnpm db:seed || echo "⚠️ Dev seed completed with notice."
  fi
fi

# Execute passed command or start Next.js standalone server
if [ "$#" -gt 0 ]; then
  echo "Executing custom command: $@"
  exec "$@"
elif [ -f "./server.js" ]; then
  echo "Starting Next.js standalone server on port ${PORT:-3000}..."
  exec node server.js
else
  echo "Starting Next.js via pnpm start on port ${PORT:-3000}..."
  exec pnpm start
fi
