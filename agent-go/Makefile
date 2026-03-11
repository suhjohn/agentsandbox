SHELL := /bin/bash
.DEFAULT_GOAL := help

GO ?= go
UV ?= uv

DOCKER ?= docker
DOCKER_IMAGE ?= agent-go:dev
PUSH_IMAGE ?= ghcr.io/suhjohn/agentsandbox
PUSH_LATEST ?= 0
BINARY_PATH ?= ./build-artifacts/agent-server
ENV_FILE ?= .env

.PHONY: help test build build-docker-binary docker-build docker-dev docker-push sync-agent-manager-tools

help:
	@echo "agent-go make targets"
	@echo "  make test                    # go test ./..."
	@echo "  make build                   # build the tracked server binary at $(BINARY_PATH)"
	@echo "  make build-docker-binary     # build the tracked server binary for linux/amd64 at $(BINARY_PATH)"
	@echo "  make docker-build            # build the Docker image tagged as $(DOCKER_IMAGE)"
	@echo "  make docker-dev              # run the Docker image with env from $(ENV_FILE)"
	@echo "  make sync-agent-manager-tools  # regenerate the root Python manager client and mirror agent_manager_client into tools/agent-manager-tools"
	@echo "  make docker-push             # push $(PUSH_IMAGE) with tag from GHCR_TAG or current git sha"

build:
	./scripts/dev.sh build-server --output "$(BINARY_PATH)"

build-docker-binary:
	GOOS=linux GOARCH=amd64 ./scripts/dev.sh build-server --output "$(BINARY_PATH)"

test:
	$(GO) test ./...

docker-build:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(DOCKER_IMAGE)" ./scripts/dev.sh docker-build

docker-dev:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(DOCKER_IMAGE)" ENV_FILE="$(ENV_FILE)" ./scripts/dev.sh docker-run --env-file "$(ENV_FILE)"

sync-agent-manager-tools:
	$(UV) run --project ../agent-manager-client ../agent-manager-client/scripts/generate.py

docker-push: sync-agent-manager-tools build-docker-binary
	DOCKER="$(DOCKER)" GHCR_IMAGE="$(PUSH_IMAGE)" GHCR_PUSH_LATEST="$(PUSH_LATEST)" GHCR_SKIP_BINARY_BUILD=1 PREBUILT_BINARY_PATH="$(BINARY_PATH)" ./scripts/dev.sh ghcr-push-amd64
