#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
CALLER_DIR="$(pwd)"

GOOS_VALUE="${GOOS:-linux}"
GOARCH_VALUE="${GOARCH:-$(go env GOARCH)}"
CGO_ENABLED_VALUE="${CGO_ENABLED:-0}"
LDFLAGS_VALUE="${LDFLAGS:--s -w}"
OUTPUT_PATH=""

usage() {
  cat <<'EOF'
Build the agent-go server binary as a standalone artifact.

Usage:
  build-agent-server.sh [--output PATH] [--goos OS] [--goarch ARCH]

Environment overrides:
  GOOS, GOARCH, CGO_ENABLED, LDFLAGS
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT_PATH="$2"
      shift 2
      ;;
    --goos)
      GOOS_VALUE="$2"
      shift 2
      ;;
    --goarch)
      GOARCH_VALUE="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${OUTPUT_PATH}" ]]; then
  OUTPUT_PATH="${MODULE_DIR}/build-artifacts/agent-server-${GOOS_VALUE}-${GOARCH_VALUE}"
fi

if [[ "${OUTPUT_PATH}" != /* ]]; then
  OUTPUT_PATH="${CALLER_DIR}/${OUTPUT_PATH}"
fi
OUTPUT_DIR="$(dirname -- "${OUTPUT_PATH}")"
OUTPUT_BASENAME="$(basename -- "${OUTPUT_PATH}")"
mkdir -p "${OUTPUT_DIR}"
OUTPUT_PATH="$(cd -- "${OUTPUT_DIR}" && pwd)/${OUTPUT_BASENAME}"

(
  cd "${MODULE_DIR}"
  CGO_ENABLED="${CGO_ENABLED_VALUE}" \
  GOOS="${GOOS_VALUE}" \
  GOARCH="${GOARCH_VALUE}" \
  go build -trimpath -ldflags="${LDFLAGS_VALUE}" -o "${OUTPUT_PATH}" ./cmd/agent-go
)

chmod +x "${OUTPUT_PATH}"
echo "built ${OUTPUT_PATH}"
