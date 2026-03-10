# Harness Registry Spec

This spec defines a harness architecture that removes most `codex`/`pi` hardcoding from:

- `agent-go`
- `agent-manager`
- `agent-manager-web`

The goal is to make adding a new harness such as `opencode` mostly mechanical and localized.

For CLI-backed harnesses, the runtime should also give each harness a clear, stable
container-level config root when the upstream tool expects one
for example `CODEX_HOME`, `PI_CODING_AGENT_DIR`, or `OPENCODE_CONFIG_DIR`.

---

## 1. Goals

1. `agent-manager` should treat harness IDs as opaque strings and pass them through unchanged.
2. `agent-go` should execute harnesses through a registry instead of `if harness == "pi" { ... } else { ... }`.
3. `agent-manager-web` should resolve harness behavior from one registry instead of branching throughout `agent-session.tsx`.
4. Adding a new harness should require:
   - one new harness package in `agent-go`
   - one new harness module in `agent-manager-web`
   - no scattered edits across session UI logic

## 2. Non-Goals

1. Runtime discovery of Go packages from the filesystem.
2. A plugin system loaded dynamically at runtime.
3. Making all harnesses share the exact same event schema.
4. Preserving the current hardcoded enum contracts in manager APIs.

---

## 3. Current Problems

Today the system is split across explicit `codex`/`pi` branches:

- `agent-go/internal/server/serve.go`
- `agent-go/internal/server/model_resolution.go`
- `agent-manager/src/routes/session.ts`
- `agent-manager/src/routes/agents.ts`
- `agent-manager/src/services/session.service.ts`
- `agent-manager-web/src/workspace/panels/agent-session.tsx`
- `agent-manager-web/src/workspace/panels/agent-detail.tsx`

This causes three problems:

1. Adding a harness requires touching many files.
2. Unknown harnesses are silently coerced or dropped in the web UI.
3. The manager layer validates a runtime concern that it mostly does not understand.

---

## 4. End-State Summary

### 4.1 `agent-manager`

`agent-manager` becomes harness-agnostic:

- request validation accepts `harness?: string`
- service types use `string`
- manager forwards `harness`, `model`, and `modelReasoningEffort` to the runtime unchanged

Harness-specific validation lives in `agent-go`.

### 4.2 `agent-go`

`agent-go` owns harness semantics through a typed registry:

- each harness package implements a shared interface
- server code resolves the current harness through the registry
- model normalization, default resolution, execution, and response metadata become harness responsibilities

### 4.3 `agent-manager-web`

`agent-manager-web` owns harness presentation through a frontend registry:

- one harness definition per harness
- `agent-session.tsx` becomes lookup-driven
- `agent-detail.tsx` preserves arbitrary harness strings instead of narrowing to `codex | pi`
- harness modules can be auto-loaded with `import.meta.glob()`

---

## 5. `agent-go` Design

## 5.1 Registry Package

Create a package such as:

- `agent-go/internal/harness/registry`

Core types:

```go
package registry

import "context"

type Session struct {
	ID                   string
	Harness              string
	ExternalSessionID    *string
	Model                *string
	ModelReasoningEffort *string
}

type Input struct {
	Type string
	Text string
	Path string
}

type RunResult struct {
	ExternalSessionID string
	Text              string
	ResponseMeta      map[string]any
}

type ExecuteRequest struct {
	Session           Session
	Input             []Input
	DefaultWorkingDir string
	RuntimeDir        string
	EmitEvent         func(map[string]any)
}

type StartRunResponseMeta struct {
	Fields map[string]any
}

type Definition interface {
	ID() string

	NormalizeModelSelection(rawModel, rawEffort *string) (model *string, effort *string, err error)
	ResolveDefaults(defaultModel, defaultEffort string) (model *string, effort *string, err error)
	Execute(ctx context.Context, req ExecuteRequest) (RunResult, error)
	BuildStartRunResponseMeta(sessionID string, session Session) (StartRunResponseMeta, error)
}
```

Registry shape:

```go
package registry

type Registry struct {
	byID map[string]Definition
}

func New(defs ...Definition) (*Registry, error)
func (r *Registry) Get(id string) (Definition, bool)
func (r *Registry) IDs() []string
```

## 5.2 Server Responsibilities

Update `agent-go/internal/server/serve.go` so the server stores:

```go
type server struct {
	cfg       serveConfig
	store     *store
	state     *sessionstate.State
	http      *http.Client
	harnesses *registry.Registry
	outbox    *eventOutbox
	runCtx    context.Context
}
```

Server behavior changes:

1. `POST /session`
   - resolve harness from registry
   - reject only when the harness is missing from the registry
2. `POST /session/:id/message`
   - reuse the session's harness definition
   - let the definition resolve model/effect defaults
3. run execution
   - dispatch through `Definition.Execute(...)`
4. run response payload
   - merge harness-specific fields from `BuildStartRunResponseMeta(...)`

This removes the current binary branching in:

- `serve.go`
- `model_resolution.go`

## 5.3 Harness Package Shape

Each harness package should expose a constructor returning `registry.Definition`.

Example:

```go
package codex

type Harness struct {
	CLI *CodexCLI
}

func New(cli *CodexCLI) *Harness

func (h *Harness) ID() string
func (h *Harness) NormalizeModelSelection(rawModel, rawEffort *string) (*string, *string, error)
func (h *Harness) ResolveDefaults(defaultModel, defaultEffort string) (*string, *string, error)
func (h *Harness) Execute(ctx context.Context, req registry.ExecuteRequest) (registry.RunResult, error)
func (h *Harness) BuildStartRunResponseMeta(sessionID string, session registry.Session) (registry.StartRunResponseMeta, error)
```

Expected harness-local concerns:

1. CLI arg construction
2. event normalization
3. model canonicalization
4. reasoning-effort validation
5. resume/session identity semantics

## 5.4 Registration Strategy

Do not use implicit `init()` registration as the primary design.

Reasoning:

1. imports become side-effectful
2. tests become harder to reason about
3. package presence on disk still does not imply it is linked into the binary

Preferred options:

### Option A: explicit aggregator

One file imports and registers all harnesses:

- `agent-go/internal/harness/all/all.go`

This is simple and idiomatic, but still requires one edit per harness.

### Option B: generated aggregator

Use `go generate` to scan harness packages and write:

- `agent-go/internal/harness/all/all.generated.go`

This is the recommended path if the desired workflow is "drop in a package and regenerate".

The generated file should:

1. instantiate each CLI
2. apply env/dir wiring
3. build the registry

## 5.5 Runtime OpenAPI Contract

`agent-go` remains the source of truth for harness validation.

OpenAPI should expose:

- `harness` as string if the runtime chooses not to publish a closed list
- or a generated enum if the registry is also used to generate the spec

The simpler and more future-proof option is `string`, with validation still enforced at runtime by registry lookup.

---

## 6. `agent-manager` Design

`agent-manager` should not maintain a closed harness enum unless it has harness-specific behavior.

Target shape:

```ts
type StartAgentSessionBody = {
  readonly sessionId?: string
  readonly message: string
  readonly title?: string
  readonly harness?: string
  readonly model?: string
  readonly modelReasoningEffort?: string
}
```

Route validation should use:

```ts
harness: z.string().min(1).optional()
modelReasoningEffort: z.string().min(1).optional()
```

Manager responsibilities:

1. validate shape, not harness semantics
2. preserve values
3. forward them to `agent-go`

This keeps harness logic in one backend place.

---

## 7. `agent-manager-web` Design

## 7.1 Frontend Harness Registry

Create:

- `agent-manager-web/src/harnesses/types.ts`
- `agent-manager-web/src/harnesses/registry.ts`

Core types:

```ts
import type { ComponentType } from 'react'
import type { GetSessionId200MessagesItem } from '@/api/generated/agent'

export type ThinkingLevel = string

export type CatalogModel = {
  readonly id: string
  readonly name: string
  readonly provider: string
}

export type HarnessMessageProps = {
  readonly messages: readonly GetSessionId200MessagesItem[]
}

export type HarnessDefinition = {
  readonly id: string
  readonly label: string
  readonly getModels: () => readonly CatalogModel[]
  readonly getThinkingLevels: () => readonly ThinkingLevel[]
  readonly formatSelectedModel?: (model: string) => {
    readonly name: string
    readonly provider: string
  }
  readonly MessageView: ComponentType<HarnessMessageProps>
}
```

Registry behavior:

```ts
export function getHarness(id: string | null | undefined): HarnessDefinition | null
export function getHarnessOrFallback(id: string | null | undefined): HarnessDefinition
export function listHarnesses(): readonly HarnessDefinition[]
```

## 7.2 Auto-Registration

Use:

```ts
const modules = import.meta.glob('./*/index.ts', { eager: true })
```

This allows one harness module per folder:

- `src/harnesses/codex/index.ts`
- `src/harnesses/pi/index.ts`
- `src/harnesses/opencode/index.ts`

Each module exports one default `HarnessDefinition`.

## 7.3 Harness Module Shape

Example:

```ts
import { OpencodeMessages } from '@/components/messages/opencode-message'
import type { HarnessDefinition } from '../types'

const def: HarnessDefinition = {
  id: 'opencode',
  label: 'OpenCode',
  getModels: () => [],
  getThinkingLevels: () => ['low', 'medium', 'high'],
  MessageView: OpencodeMessages
}

export default def
```

## 7.4 `agent-session.tsx` Changes

`agent-session.tsx` should:

1. resolve the active harness from the registry
2. stop narrowing harness to `codex | pi`
3. render messages through `harness.MessageView`
4. populate model/thinking controls from the selected harness
5. use a fallback definition for unknown harnesses instead of coercing to `codex`

## 7.5 `agent-detail.tsx` Changes

`agent-detail.tsx` should preserve any non-empty string harness in panel config.

It should not coerce or drop unknown values during:

1. config deserialization
2. session-list open
3. session-picker selection

---

## 8. Addition Workflow

Target workflow for a new harness `opencode`:

### Backend

1. add `agent-go/internal/harness/opencode/`
2. implement `registry.Definition`
3. add or regenerate the harness aggregator
4. ensure the runtime image includes the required binary/config

### Frontend

1. add `agent-manager-web/src/harnesses/opencode/index.ts`
2. add `agent-manager-web/src/components/messages/opencode-message.tsx`

### Manager

No harness-specific code change should be required once manager types are string-based.

---

## 9. Tradeoffs

## 9.1 Why not `init()` registration in Go

It is less explicit, less testable, and still requires imports somewhere to link packages.

## 9.2 Why not keep manager enums

The manager mostly forwards harness values and should not duplicate runtime semantics.

## 9.3 Why use registry lookup on the web

It localizes harness behavior and removes current hardcoded branches from session UI logic.

## 9.4 Why prefer generated registration in Go

It gives the closest approximation to "add a harness package and be done" without leaning on implicit global side effects.

---

## 10. Required Follow-On Updates

When implementing this spec, update:

1. runtime OpenAPI and generated clients
2. harness-specific tests in `agent-go`
3. session UI tests in `agent-manager-web`
4. workspace docs if harness-specific composer behavior changes
5. services docs if manager API type signatures change
