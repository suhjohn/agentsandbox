#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose --project-directory "$SCRIPT_DIR" -f "$SCRIPT_DIR/docker-compose.yml")

DOWN_ARGS=()
case "${1:-}" in
  -v|--volumes|--clean)
    DOWN_ARGS+=(-v)
    ;;
  "" )
    ;;
  * )
    echo "Usage: $0 [-v|--volumes|--clean]" >&2
    exit 2
    ;;
esac

"${COMPOSE[@]}" down "${DOWN_ARGS[@]}"

