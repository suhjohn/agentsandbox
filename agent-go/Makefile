SHELL := /bin/bash

GO ?= go

DOCKER ?= docker
DOCKER_IMAGE ?= agent-go:dev
DOCKER_CONTAINER ?= agent-go-dev
ENV_FILE ?= .env

.PHONY: help run serve proxy build test test-docker fmt vet openapi build-server restart-server build-server-docker build-server-linux-amd64 build-server-linux-arm64 docker-build docker-run docker-run-server docker-stop docker-refresh docker-refresh-server ghcr-push ghcr-push-amd64 check-env-file

help:
	@echo "agent-go make targets"
	@echo "  make run                     # go run ./cmd/agent-go"
	@echo "  make serve                   # go run ./cmd/agent-go serve"
	@echo "  make proxy                   # go run ./cmd/agent-go openvscode-proxy"
	@echo "  make build                   # go build ./cmd/agent-go"
	@echo "  make test                    # go test ./..."
	@echo "  make test-docker             # go test -tags dockerintegration ./..."
	@echo "  make fmt                     # go fmt ./..."
	@echo "  make vet                     # go vet ./..."
	@echo "  make openapi                 # print OpenAPI spec path"
	@echo "  make build-server            # scripts/dev.sh build-server"
	@echo "  make restart-server          # scripts/dev.sh restart-server"
	@echo "  make build-server-docker     # scripts/dev.sh build-server --output ./build-artifacts/agent-server"
	@echo "  make build-server-linux-amd64"
	@echo "  make build-server-linux-arm64"
	@echo "  make docker-build            # scripts/dev.sh docker-build"
	@echo "  make docker-run              # scripts/dev.sh docker-run using ENV_FILE=$(ENV_FILE)"
	@echo "  make docker-run-server       # scripts/dev.sh docker-run --server-only"
	@echo "  make docker-stop             # scripts/dev.sh docker-stop"
	@echo "  make docker-refresh          # scripts/dev.sh docker-refresh"
	@echo "  make docker-refresh-server   # scripts/dev.sh docker-refresh --server-only"
	@echo "  make ghcr-push               # scripts/dev.sh ghcr-push-amd64"

run:
	$(GO) run ./cmd/agent-go

serve:
	$(GO) run ./cmd/agent-go serve

proxy:
	$(GO) run ./cmd/agent-go openvscode-proxy

build:
	$(GO) build ./cmd/agent-go

test:
	$(GO) test ./...

test-docker:
	$(GO) test -tags dockerintegration ./...

fmt:
	$(GO) fmt ./...

vet:
	$(GO) vet ./...

openapi:
	@echo "OpenAPI spec: agent-go/internal/openapi/openapi.json"

build-server:
	./scripts/dev.sh build-server

restart-server:
	./scripts/dev.sh restart-server

build-server-docker:
	./scripts/dev.sh build-server --output ./build-artifacts/agent-server

build-server-linux-amd64:
	./scripts/dev.sh build-server --goos linux --goarch amd64

build-server-linux-arm64:
	./scripts/dev.sh build-server --goos linux --goarch arm64

docker-build:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(DOCKER_IMAGE)" ./scripts/dev.sh docker-build

check-env-file:
	@test -f "$(ENV_FILE)" || (echo "missing env file: $(ENV_FILE)" && exit 1)

docker-run: check-env-file
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(DOCKER_IMAGE)" DOCKER_CONTAINER="$(DOCKER_CONTAINER)" ENV_FILE="$(ENV_FILE)" ./scripts/dev.sh docker-run --env-file "$(ENV_FILE)"

docker-run-server: check-env-file
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(DOCKER_IMAGE)" DOCKER_CONTAINER="$(DOCKER_CONTAINER)" ENV_FILE="$(ENV_FILE)" ./scripts/dev.sh docker-run --env-file "$(ENV_FILE)" --server-only

docker-stop:
	DOCKER="$(DOCKER)" DOCKER_CONTAINER="$(DOCKER_CONTAINER)" ./scripts/dev.sh docker-stop

docker-refresh:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(DOCKER_IMAGE)" DOCKER_CONTAINER="$(DOCKER_CONTAINER)" ENV_FILE="$(ENV_FILE)" ./scripts/dev.sh docker-refresh --env-file "$(ENV_FILE)"

docker-refresh-server:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(DOCKER_IMAGE)" DOCKER_CONTAINER="$(DOCKER_CONTAINER)" ENV_FILE="$(ENV_FILE)" ./scripts/dev.sh docker-refresh --env-file "$(ENV_FILE)" --server-only

ghcr-push: ghcr-push-amd64

ghcr-push-amd64:
	DOCKER="$(DOCKER)" ./scripts/dev.sh ghcr-push-amd64
