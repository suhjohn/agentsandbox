package registry

import (
	"context"
	"testing"
)

type stubDefinition struct {
	id string
}

func (s stubDefinition) ID() string { return s.id }

func (s stubDefinition) NormalizeModelSelection(rawModel, rawEffort *string) (*string, *string, error) {
	return rawModel, rawEffort, nil
}

func (s stubDefinition) ResolveDefaults(defaultModel, defaultEffort string) (*string, *string, error) {
	return nil, nil, nil
}

func (s stubDefinition) PrepareStartRun(req StartRunRequest) (StartRunPreparation, error) {
	return StartRunPreparation{}, nil
}

func (s stubDefinition) Execute(ctx context.Context, req ExecuteRequest) (RunResult, error) {
	return RunResult{}, nil
}

func (s stubDefinition) SetupRuntime(ctx SetupContext) error {
	return nil
}

func TestNewRejectsDuplicateHarnessesAfterNormalization(t *testing.T) {
	_, err := New(
		stubDefinition{id: "Codex"},
		stubDefinition{id: " codex "},
	)
	if err == nil {
		t.Fatal("expected duplicate harness error")
	}
}

func TestGetNormalizesHarnessLookup(t *testing.T) {
	registry, err := New(stubDefinition{id: "Codex"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	def, ok := registry.Get(" codex ")
	if !ok {
		t.Fatal("expected lookup to succeed")
	}
	if got := def.ID(); got != "Codex" {
		t.Fatalf("expected original definition, got %q", got)
	}
}
