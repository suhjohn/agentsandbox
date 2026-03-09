package registry

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

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
}

type ExecuteRequest struct {
	Session                  Session
	Input                    []Input
	DefaultWorkingDir        string
	RuntimeDir               string
	EmitEvent                func(map[string]any)
	PersistExternalSessionID func(string)
}

type StartRunRequest struct {
	Session    Session
	RuntimeDir string
}

type StartRunPreparation struct {
	ExternalSessionID *string
	ResponseFields    map[string]any
}

type Definition interface {
	ID() string
	NormalizeModelSelection(rawModel, rawEffort *string) (model *string, effort *string, err error)
	ResolveDefaults(defaultModel, defaultEffort string) (model *string, effort *string, err error)
	PrepareStartRun(req StartRunRequest) (StartRunPreparation, error)
	Execute(ctx context.Context, req ExecuteRequest) (RunResult, error)
}

type Registry struct {
	byID map[string]Definition
}

func New(defs ...Definition) (*Registry, error) {
	byID := make(map[string]Definition, len(defs))
	for _, def := range defs {
		if def == nil {
			return nil, fmt.Errorf("harness definition is nil")
		}
		id := strings.ToLower(strings.TrimSpace(def.ID()))
		if id == "" {
			return nil, fmt.Errorf("harness id is required")
		}
		if _, exists := byID[id]; exists {
			return nil, fmt.Errorf("duplicate harness %q", id)
		}
		byID[id] = def
	}
	return &Registry{byID: byID}, nil
}

func (r *Registry) Get(id string) (Definition, bool) {
	if r == nil {
		return nil, false
	}
	def, ok := r.byID[strings.ToLower(strings.TrimSpace(id))]
	return def, ok
}

func (r *Registry) IDs() []string {
	if r == nil {
		return nil
	}
	out := make([]string, 0, len(r.byID))
	for id := range r.byID {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}
