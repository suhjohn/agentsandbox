SHELL := /bin/bash

GO ?= go

DOCKER ?= docker
DOCKER_IMAGE ?= agent-go:dev
DOCKER_CONTAINER ?= agent-go-dev
ENV_FILE ?= .env

.PHONY: help run serve proxy build test test-docker fmt vet openapi build-server restart-server build-server-docker build-server-linux-amd64 build-server-linux-arm64 docker-build docker-run docker-run-server docker-stop ghcr-push ghcr-push-amd64 check-env-file

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
	@echo "  make build-server            # scripts/build-agent-server.sh"
	@echo "  make restart-server          # scripts/restart-agent-server.sh"
	@echo "  make build-server-docker     # scripts/build-agent-server.sh --output ./build-artifacts/agent-server"
	@echo "  make build-server-linux-amd64"
	@echo "  make build-server-linux-arm64"
	@echo "  make docker-build            # build image"
	@echo "  make docker-run              # run full container stack using ENV_FILE=$(ENV_FILE)"
	@echo "  make docker-run-server       # run API server only mode using ENV_FILE=$(ENV_FILE)"
	@echo "  make docker-stop             # stop/remove $(DOCKER_CONTAINER)"
	@echo "  make ghcr-push               # build+push to GHCR (linux/amd64)"

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
	./scripts/build-agent-server.sh

restart-server:
	./scripts/restart-agent-server.sh

build-server-docker:
	./scripts/build-agent-server.sh --output ./build-artifacts/agent-server

build-server-linux-amd64:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 ./scripts/build-agent-server.sh

build-server-linux-arm64:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 ./scripts/build-agent-server.sh

docker-build:
	$(DOCKER) build -f Dockerfile -t "$(DOCKER_IMAGE)" ..

check-env-file:
	@test -f "$(ENV_FILE)" || (echo "missing env file: $(ENV_FILE)" && exit 1)

docker-run: check-env-file
	$(DOCKER) run --rm -it --name "$(DOCKER_CONTAINER)" \
		--env-file "$(ENV_FILE)" \
		-p 3131:3131 \
		-p 39393:39393 \
		-p 6080:6080 \
		-p 5900:5900 \
		"$(DOCKER_IMAGE)"

docker-run-server: check-env-file
	$(DOCKER) run --rm -it --name "$(DOCKER_CONTAINER)" \
		--env-file "$(ENV_FILE)" \
		-e AGENT_RUNTIME_MODE=server \
		-p 3131:3131 \
		"$(DOCKER_IMAGE)"

docker-stop:
	-$(DOCKER) rm -f "$(DOCKER_CONTAINER)"

ghcr-push: ghcr-push-amd64

ghcr-push-amd64:
	./scripts/ghcr-push.sh push-amd64
