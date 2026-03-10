package opencode

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"agent-go/internal/harness/registry"
)

func TestNormalizeModelSelection(t *testing.T) {
	h := NewHarness(nil)

	model, effort, err := h.NormalizeModelSelection(registry.StringPtr("github-copilot/gpt-4o"), registry.StringPtr("high"))
	if err != nil {
		t.Fatalf("NormalizeModelSelection returned error: %v", err)
	}
	if got := ptrValue(model); got != "copilot.gpt-4o" {
		t.Fatalf("expected copilot.gpt-4o, got %q", got)
	}
	if got := ptrValue(effort); got != "high" {
		t.Fatalf("expected high effort, got %q", got)
	}

	model, effort, err = h.NormalizeModelSelection(registry.StringPtr("gpt-4.1:medium"), nil)
	if err != nil {
		t.Fatalf("NormalizeModelSelection inline effort returned error: %v", err)
	}
	if got := ptrValue(model); got != "gpt-4.1" {
		t.Fatalf("expected gpt-4.1, got %q", got)
	}
	if got := ptrValue(effort); got != "medium" {
		t.Fatalf("expected medium effort, got %q", got)
	}

	if _, _, err := h.NormalizeModelSelection(registry.StringPtr("gpt-5.2"), nil); err == nil {
		t.Fatalf("expected unsupported model error")
	}
}

func TestResolveDefaultsIgnoresUnsupportedModel(t *testing.T) {
	h := NewHarness(nil)

	model, effort, err := h.ResolveDefaults("gpt-5.2", "high")
	if err != nil {
		t.Fatalf("ResolveDefaults returned error: %v", err)
	}
	if model != nil {
		t.Fatalf("expected nil model for unsupported default, got %q", ptrValue(model))
	}
	if got := ptrValue(effort); got != "high" {
		t.Fatalf("expected high effort, got %q", got)
	}
}

func TestSetupRuntimeSeedsManagedOpenCodeContext(t *testing.T) {
	tmpDir := t.TempDir()
	runtimeDir := filepath.Join(tmpDir, "runtime")

	h := NewHarness(nil)
	err := h.SetupRuntime(registry.SetupContext{
		RuntimeContext: registry.RuntimeContext{
			RootDir:                 filepath.Join(tmpDir, "runtime-root"),
			RuntimeDir:              runtimeDir,
			AgentHome:               tmpDir,
			AgentID:                 "agent-123",
			DefaultWorkingDir:       filepath.Join(tmpDir, "workspace"),
			ToolsDir:                filepath.Join(tmpDir, "tools"),
			ToolReadmes:             []string{filepath.Join(tmpDir, "tools", "browser-tools", "README.md")},
			Display:                 ":99",
			ScreenWidth:             "1280",
			ScreenHeight:            "720",
			ScreenDepth:             "24",
			ChromiumRemoteDebugPort: "9222",
			ChromiumUserDataDir:     filepath.Join(tmpDir, "browser"),
		},
	})
	if err != nil {
		t.Fatalf("SetupRuntime: %v", err)
	}

	contextRaw, err := os.ReadFile(filepath.Join(runtimeDir, "opencode", "OpenCode.md"))
	if err != nil {
		t.Fatalf("ReadFile OpenCode.md: %v", err)
	}
	contextText := string(contextRaw)
	if !strings.Contains(contextText, "agent-go:managed kind=agents-md harness=opencode version=1") {
		t.Fatalf("expected managed header, got %q", contextText)
	}
	if !strings.Contains(contextText, "You are OpenCode running inside a sandbox container.") {
		t.Fatalf("expected OpenCode-specific content, got %q", contextText)
	}
}

func TestEnsureSessionConfigWritesRuntimeScopedConfig(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "xdg", "opencode", ".opencode.json")
	dataDir := filepath.Join(tmpDir, "data")
	contextPath := filepath.Join(tmpDir, "runtime", "opencode", "OpenCode.md")

	if err := ensureSessionConfig(configPath, dataDir, contextPath, registry.StringPtr("gpt-4.1"), registry.StringPtr("high")); err != nil {
		t.Fatalf("ensureSessionConfig: %v", err)
	}

	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("ReadFile config: %v", err)
	}
	text := string(raw)
	for _, want := range []string{
		`"directory": "` + dataDir + `"`,
		`"` + contextPath + `"`,
		`"model": "gpt-4.1"`,
		`"reasoningEffort": "high"`,
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected %q in config: %s", want, text)
		}
	}
}
