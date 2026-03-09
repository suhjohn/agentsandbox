SHELL := /bin/bash
.DEFAULT_GOAL := help

GO ?= go

DOCKER ?= docker
DOCKER_IMAGE ?= agent-go:dev
BINARY_PATH ?= ./build-artifacts/agent-server

.PHONY: help test build docker-build docker-push

help:
	@echo "agent-go make targets"
	@echo "  make test                    # go test ./..."
	@echo "  make build                   # build the tracked server binary at $(BINARY_PATH)"
	@echo "  make docker-build            # build the Docker image tagged as $(DOCKER_IMAGE)"
	@echo "  make docker-push             # build the tracked binary, then build and push the linux/amd64 image via buildx"

build:
	./scripts/dev.sh build-server --output "$(BINARY_PATH)"

test:
	$(GO) test ./...

docker-build:
	DOCKER="$(DOCKER)" DOCKER_IMAGE="$(DOCKER_IMAGE)" ./scripts/dev.sh docker-build

docker-push: build
	DOCKER="$(DOCKER)" ./scripts/dev.sh ghcr-push-amd64
