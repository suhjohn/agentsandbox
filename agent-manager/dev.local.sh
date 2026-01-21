#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Starting infra via docker compose"
bash "$SCRIPT_DIR/docker-compose.infra.sh"

echo "==> Starting agent-manager locally (bun --watch)"
cd "$SCRIPT_DIR"
exec bun run dev

