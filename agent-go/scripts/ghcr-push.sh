#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

usage() {
  cat <<'EOF'
Build and push the agent-go Docker image to GHCR (linux/amd64).

Usage:
  agent-go/scripts/ghcr-push.sh push-amd64

Auth:
  - If already logged into GHCR via `docker login ghcr.io`, you can omit env vars.
  - Otherwise set GHCR_TOKEN (a GitHub token with packages:write) and GITHUB_USERNAME.

Optional env:
  GHCR_IMAGE        (default: ghcr.io/$GITHUB_USERNAME/agent, else ghcr.io/suhjohn/agent)
  GHCR_TAG          (default: git short sha, else 'latest' if git missing)
  GHCR_PUSH_LATEST=0  (disable also tag+push :latest; default: enabled)
  DOCKER_CONTEXT    (force docker context; useful for OrbStack)
EOF
}

command="${1:-}"
if [[ -z "${command}" || "${command}" == "--help" || "${command}" == "-h" ]]; then
  usage
  exit 2
fi

if [[ "${command}" != "push-amd64" ]]; then
  usage >&2
  exit 2
fi

docker_cmd=(docker)
if [[ -n "${DOCKER_CONTEXT:-}" ]]; then
  docker_cmd=(docker --context "${DOCKER_CONTEXT}")
  unset DOCKER_HOST || true
fi

if ! "${docker_cmd[@]}" info >/dev/null 2>&1; then
  echo "Docker daemon is not reachable." >&2
  echo "If you switched to OrbStack on macOS: docker context use orbstack" >&2
  exit 1
fi

image="${GHCR_IMAGE:-}"
if [[ -n "${image}" ]]; then
  image="${image%/}"
else
  if [[ -n "${GITHUB_USERNAME:-}" ]]; then
    image="ghcr.io/${GITHUB_USERNAME}/agent"
  else
    image="ghcr.io/suhjohn/agent"
  fi
fi

tag="${GHCR_TAG:-}"
if [[ -z "${tag}" ]]; then
  if git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    tag="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || true)"
  fi
  tag="${tag:-latest}"
fi

build_version="${tag}"
if git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  sha="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || true)"
  if [[ -n "${sha}" ]]; then
    if [[ -n "$(git -C "${REPO_ROOT}" status --porcelain=v1 2>/dev/null || true)" ]]; then
      build_version="${sha}-dirty"
    else
      build_version="${sha}"
    fi
  fi
fi

push_latest=true
if [[ "${GHCR_PUSH_LATEST:-}" == "0" ]]; then
  push_latest=false
fi

tags=("${image}:${tag}")
if "${push_latest}" && [[ "${tag}" != "latest" ]]; then
  tags+=("${image}:latest")
fi

if [[ -n "${GHCR_TOKEN:-}" && -n "${GITHUB_USERNAME:-}" ]]; then
  printf '%s' "${GHCR_TOKEN}" | docker login ghcr.io -u "${GITHUB_USERNAME}" --password-stdin
elif [[ -n "${GHCR_TOKEN:-}" || -n "${GITHUB_USERNAME:-}" ]]; then
  echo "Set both GHCR_TOKEN and GITHUB_USERNAME (or neither if already logged in)." >&2
  exit 1
fi

"${REPO_ROOT}/agent-go/scripts/build-agent-server.sh" \
  --goos linux \
  --goarch amd64 \
  --output "${REPO_ROOT}/agent-go/build-artifacts/agent-server"

build_args=(
  --platform linux/amd64
  --push
  --build-arg "AGENT_IMAGE_VERSION=${build_version}"
  -f "${REPO_ROOT}/agent-go/Dockerfile"
)

tag_args=()
for t in "${tags[@]}"; do
  tag_args+=(-t "${t}")
done

"${docker_cmd[@]}" buildx build "${build_args[@]}" "${tag_args[@]}" "${REPO_ROOT}"

echo "Pushed ${tags[*]} (linux/amd64)"
