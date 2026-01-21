#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose --project-directory "$SCRIPT_DIR" -f "$SCRIPT_DIR/docker-compose.yml")

echo "==> Starting infra (postgres, redis, temporaldb)"
"${COMPOSE[@]}" up -d postgres redis temporaldb

echo "==> Waiting for Postgres (agent-manager) to be ready"
for _ in $(seq 1 120); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U postgres -d agent_manager >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! "${COMPOSE[@]}" exec -T postgres pg_isready -U postgres -d agent_manager >/dev/null 2>&1; then
  echo "Postgres did not become ready in time." >&2
  exit 1
fi

echo "==> Running DB migrations locally (drizzle-kit)"
pushd "$SCRIPT_DIR" >/dev/null
DATABASE_URL="postgres://postgres:password@localhost:5679/agent_manager" bunx drizzle-kit migrate
popd >/dev/null

echo "==> Starting remaining services (temporal, temporal-ui, agent-manager)"
"${COMPOSE[@]}" up -d --build temporal temporal-ui agent-manager

echo "==> Streaming agent-manager logs"
"${COMPOSE[@]}" logs -f agent-manager
