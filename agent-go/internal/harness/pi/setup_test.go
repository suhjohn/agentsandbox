package pi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"agent-go/internal/harness/registry"
)

func TestSetupRuntimeSeedsAgentsFileWithSharedPrelude(t *testing.T) {
	tmpDir := t.TempDir()
	piDir := filepath.Join(tmpDir, ".pi")

	h := NewHarness(nil)
	err := h.SetupRuntime(registry.SetupContext{
		RuntimeContext: registry.RuntimeContext{
			RootDir:          filepath.Join(tmpDir, "runtime-root"),
			AgentHome:        tmpDir,
			AgentID:          "agent-123",
			CodexHome:        filepath.Join(tmpDir, ".codex"),
			PIDir:            piDir,
			SharedAgentsPath: filepath.Join(tmpDir, "shared", "AGENTS.md"),
			SharedAgentsContent: strings.TrimSpace(`
# Shared Personality
You are a happy person.
`),
		},
	})
	if err != nil {
		t.Fatalf("SetupRuntime: %v", err)
	}

	agentsRaw, err := os.ReadFile(filepath.Join(piDir, "AGENTS.md"))
	if err != nil {
		t.Fatalf("ReadFile AGENTS.md: %v", err)
	}
	agentsText := string(agentsRaw)
	if !strings.Contains(agentsText, "agent-go:managed kind=agents-md harness=pi version=2") {
		t.Fatalf("expected managed AGENTS header, got %q", agentsText)
	}
	if !strings.Contains(agentsText, "# Shared Instructions") || !strings.Contains(agentsText, "You are a happy person.") {
		t.Fatalf("expected shared instructions, got %q", agentsText)
	}
	if !strings.Contains(agentsText, "You are PI running inside a sandbox container.") {
		t.Fatalf("expected PI-specific content, got %q", agentsText)
	}
	if strings.Index(agentsText, "# Shared Instructions") > strings.Index(agentsText, "# Environment") {
		t.Fatalf("expected shared instructions before environment, got %q", agentsText)
	}
}
