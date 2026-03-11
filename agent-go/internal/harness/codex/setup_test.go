package codex

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"agent-go/internal/harness/registry"
)

func TestSetupRuntimeSeedsAgentsAndAuthFiles(t *testing.T) {
	tmpDir := t.TempDir()
	codexHome := filepath.Join(tmpDir, ".codex")

	h := NewHarness(nil)
	err := h.SetupRuntime(registry.SetupContext{
		RuntimeContext: registry.RuntimeContext{
			RootDir:                 filepath.Join(tmpDir, "runtime-root"),
			AgentHome:               tmpDir,
			AgentID:                 "agent-123",
			CodexHome:               codexHome,
			PIDir:                   filepath.Join(tmpDir, ".pi"),
			ToolsDir:                filepath.Join(tmpDir, "tools"),
			BundledToolsDir:         filepath.Join(tmpDir, "tools", "default"),
			ToolReadmes:             []string{filepath.Join(tmpDir, "tools", "default", "browser-tools", "README.md")},
			Display:                 ":99",
			ScreenWidth:             "1280",
			ScreenHeight:            "720",
			ScreenDepth:             "24",
			ChromiumRemoteDebugPort: "9222",
			ChromiumUserDataDir:     filepath.Join(tmpDir, "browser"),
		},
		OpenAIAPIKey: "sk-test",
	})
	if err != nil {
		t.Fatalf("SetupRuntime: %v", err)
	}

	agentsRaw, err := os.ReadFile(filepath.Join(codexHome, "AGENTS.md"))
	if err != nil {
		t.Fatalf("ReadFile AGENTS.md: %v", err)
	}
	agentsText := string(agentsRaw)
	if !strings.Contains(agentsText, "agent-go:managed kind=agents-md harness=codex version=1") {
		t.Fatalf("expected managed AGENTS header, got %q", agentsText)
	}
	if !strings.Contains(agentsText, "You are Codex running inside a sandbox container.") {
		t.Fatalf("expected Codex-specific content, got %q", agentsText)
	}
	if !strings.Contains(agentsText, filepath.Join(tmpDir, "tools", "default")) {
		t.Fatalf("expected bundled tools dir, got %q", agentsText)
	}

	authRaw, err := os.ReadFile(filepath.Join(codexHome, "auth.json"))
	if err != nil {
		t.Fatalf("ReadFile auth.json: %v", err)
	}
	authText := string(authRaw)
	if !strings.Contains(authText, `"auth_mode":"apikey"`) {
		t.Fatalf("expected auth_mode apikey, got %q", authText)
	}
	if !strings.Contains(authText, `"OPENAI_API_KEY":"sk-test"`) {
		t.Fatalf("expected OPENAI_API_KEY, got %q", authText)
	}
}
