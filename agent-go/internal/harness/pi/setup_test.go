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
	repoDir := filepath.Join(tmpDir, "repo")
	sourceDir := filepath.Join(repoDir, bundledClientToolsExtensionRelativeDir)
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatalf("MkdirAll source extension dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "index.ts"), []byte("export default function () {}\n"), 0o644); err != nil {
		t.Fatalf("WriteFile source extension index: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "package.json"), []byte("{\"pi\":{\"extensions\":[\"./index.ts\"]}}\n"), 0o644); err != nil {
		t.Fatalf("WriteFile source extension package: %v", err)
	}
	t.Setenv("AGENT_GO_REPO_DIR", repoDir)

	h := NewHarness(nil)
	err := h.SetupRuntime(registry.SetupContext{
		RuntimeContext: registry.RuntimeContext{
			RootDir:          filepath.Join(tmpDir, "runtime-root"),
			AgentHome:        tmpDir,
			AgentID:          "agent-123",
			CodexHome:        filepath.Join(tmpDir, ".codex"),
			PIDir:            piDir,
			SharedAgentsPath: filepath.Join(tmpDir, "shared", "image", "AGENTS.md"),
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

	installedDir := filepath.Join(piDir, "agent", "extensions", "client_tools")
	indexRaw, err := os.ReadFile(filepath.Join(installedDir, "index.ts"))
	if err != nil {
		t.Fatalf("ReadFile installed index.ts: %v", err)
	}
	if got := string(indexRaw); got != "export default function () {}\n" {
		t.Fatalf("unexpected installed index.ts contents: %q", got)
	}
	packageRaw, err := os.ReadFile(filepath.Join(installedDir, "package.json"))
	if err != nil {
		t.Fatalf("ReadFile installed package.json: %v", err)
	}
	if got := string(packageRaw); got != "{\"pi\":{\"extensions\":[\"./index.ts\"]}}\n" {
		t.Fatalf("unexpected installed package.json contents: %q", got)
	}
}
