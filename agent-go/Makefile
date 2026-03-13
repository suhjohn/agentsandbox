SHELL := /bin/bash
.DEFAULT_GOAL := help

GO ?= go

DOCKER ?= docker
DOCKER_IMAGE ?= agent-go:dev
PUSH_IMAGE ?= ghcr.io/suhjohn/agentsandbox
PUSH_LATEST ?= 0
HOST_GOOS ?= $(shell $(GO) env GOOS)
HOST_GOARCH ?= $(shell $(GO) env GOARCH)
LOCAL_BINARY_PATH ?= ./build-artifacts/agent-server-$(HOST_GOOS)-$(HOST_GOARCH)
TRACKED_BINARY_PATH ?= ./build-artifacts/agent-server-linux-amd64
ENV_FILE ?= .env

.PHONY: help test build build-docker-binary docker-build docker-dev-build docker-dev docker-push

help:
	@echo "agent-go make targets"
	@echo "  make test                    # go test ./..."
	@echo "  make build                   # build the local server binary at $(LOCAL_BINARY_PATH)"
	@echo "  make build-docker-binary     # build the tracked linux/amd64 server binary at $(TRACKED_BINARY_PATH)"
	@echo "  make docker-build            # build the linux/amd64 Docker image tagged as $(DOCKER_IMAGE)"
	@echo "  make docker-dev-build        # build the Docker image for the local Docker daemon architecture"
	@echo "  make docker-dev              # run the Docker image with env from $(ENV_FILE)"
	@echo "  make docker-push             # push $(PUSH_IMAGE) with tag from GHCR_TAG or current git sha"

build:
	GOOS="$(HOST_GOOS)" GOARCH="$(HOST_GOARCH)" ./scripts/dev.sh build-server --output "$(LOCAL_BINARY_PATH)"

build-docker-binary:
	GOOS=linux GOARCH=amd64 ./scripts/dev.sh build-server --output "$(TRACKED_BINARY_PATH)"

test:
	$(GO) test ./...

docker-build:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(DOCKER_IMAGE)" ./scripts/dev.sh docker-build

docker-dev-build:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(DOCKER_IMAGE)" ./scripts/dev.sh docker-dev-build

docker-dev:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(DOCKER_IMAGE)" ENV_FILE="$(ENV_FILE)" ./scripts/dev.sh docker-run --env-file "$(ENV_FILE)"

docker-push: build-docker-binary
	DOCKER="$(DOCKER)" GHCR_IMAGE="$(PUSH_IMAGE)" GHCR_PUSH_LATEST="$(PUSH_LATEST)" GHCR_SKIP_BINARY_BUILD=1 PREBUILT_BINARY_PATH="$(TRACKED_BINARY_PATH)" ./scripts/dev.sh ghcr-push-amd64
