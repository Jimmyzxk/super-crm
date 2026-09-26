#!/bin/sh
set -e

echo "=== [CRM Docker Dev Entrypoint] Starting Live Development Environment ==="

if [ -n "$MIGRATION_DATABASE_URL" ]; then
  echo "Waiting for PostgreSQL database to be reachable..."
  until node -e '
    const pg = require("pg");
    const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    client.connect()
      .then(() => { client.end(); process.exit(0); })
      .catch(() => process.exit(1));
  '; do
    echo "PostgreSQL is unavailable - sleeping 1s..."
    sleep 1
  done
  echo "✓ PostgreSQL is ready!"

  echo "Applying database migrations..."
  pnpm db:migrate || true

  # 开源版（AGPL-3.0）：SEED_DEMO 指向核心验收种子（原 demo 集含闭源插件数据，已移除）
  if [ "$SEED_DEMO" = "true" ] || [ "$SEED_DEMO" = "1" ]; then
    echo "Seeding core acceptance demo data..."
    pnpm db:seed:acceptance || true
  fi
fi

if [ "$#" -gt 0 ]; then
  echo "Executing custom command: $@"
  exec "$@"
fi

echo "🚀 Launching Next.js with Live Hot-Reload (Fast Refresh) on port 3000..."
exec pnpm dev -H 0.0.0.0 -p 3000
