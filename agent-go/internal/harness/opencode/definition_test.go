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

	model, effort, err := h.NormalizeModelSelection(registry.StringPtr("openai/gpt-4.1"), registry.StringPtr("high"))
	if err != nil {
		t.Fatalf("NormalizeModelSelection returned error: %v", err)
	}
	if got := ptrValue(model); got != "openai/gpt-4.1" {
		t.Fatalf("expected openai/gpt-4.1, got %q", got)
	}
	if got := ptrValue(effort); got != "high" {
		t.Fatalf("expected high variant, got %q", got)
	}

	model, effort, err = h.NormalizeModelSelection(registry.StringPtr("openai/gpt-4.1:medium"), nil)
	if err != nil {
		t.Fatalf("NormalizeModelSelection inline effort returned error: %v", err)
	}
	if got := ptrValue(model); got != "openai/gpt-4.1" {
		t.Fatalf("expected openai/gpt-4.1, got %q", got)
	}
	if got := ptrValue(effort); got != "medium" {
		t.Fatalf("expected medium variant, got %q", got)
	}

	if _, _, err := h.NormalizeModelSelection(registry.StringPtr("openai/not-a-real-model"), nil); err == nil {
		t.Fatalf("expected unsupported model error")
	}
}

func TestResolveDefaultsPrefixesOpenAIModelIDs(t *testing.T) {
	h := NewHarness(nil)

	model, effort, err := h.ResolveDefaults("gpt-4.1", "high")
	if err != nil {
		t.Fatalf("ResolveDefaults returned error: %v", err)
	}
	if got := ptrValue(model); got != "openai/gpt-4.1" {
		t.Fatalf("expected openai/gpt-4.1, got %q", got)
	}
	if got := ptrValue(effort); got != "high" {
		t.Fatalf("expected high variant, got %q", got)
	}
}

func TestSetupRuntimeSeedsManagedAgentsFile(t *testing.T) {
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

	contextRaw, err := os.ReadFile(filepath.Join(runtimeDir, "opencode", "AGENTS.md"))
	if err != nil {
		t.Fatalf("ReadFile AGENTS.md: %v", err)
	}
	contextText := string(contextRaw)
	if !strings.Contains(contextText, "agent-go:managed kind=agents-md harness=opencode version=1") {
		t.Fatalf("expected managed header, got %q", contextText)
	}
	if !strings.Contains(contextText, "You are OpenCode running inside a sandbox container.") {
		t.Fatalf("expected OpenCode-specific content, got %q", contextText)
	}
}

func TestCompactEventForStream(t *testing.T) {
	toolEvent, ok := compactEventForStream(map[string]any{
		"type":      "tool_use",
		"sessionID": "session-123",
		"part": map[string]any{
			"id":   "tool-1",
			"tool": "read",
			"state": map[string]any{
				"status": "completed",
				"input": map[string]any{
					"filePath": "/tmp/file.txt",
				},
				"output": "done",
			},
		},
	})
	if !ok {
		t.Fatalf("expected tool event to compact")
	}
	if got := registry.FirstNonEmptyString(toolEvent["type"]); got != "tool_use" {
		t.Fatalf("expected tool_use type, got %q", got)
	}

	textEvent, ok := compactEventForStream(map[string]any{
		"type": "text",
		"part": map[string]any{
			"id":   "part-1",
			"text": "final answer",
		},
	})
	if !ok {
		t.Fatalf("expected text event to compact")
	}
	part, _ := textEvent["part"].(map[string]any)
	if got := registry.FirstNonEmptyString(part["text"]); got != "final answer" {
		t.Fatalf("expected text payload, got %q", got)
	}
}

func TestOpencodeRunEnvForcesAllowAllPermissions(t *testing.T) {
	runtimeDir := filepath.Join(t.TempDir(), "runtime")
	env := opencodeRunEnv([]string{
		"OPENCODE_CONFIG_DIR=/custom/opencode",
		`OPENCODE_PERMISSION={"read":"deny"}`,
	}, runtimeDir, "session-123")

	if got := envValue(env, "OPENCODE_CONFIG_DIR"); got != "/custom/opencode" {
		t.Fatalf("expected custom config dir, got %q", got)
	}
	if got := envValue(env, "OPENCODE_PERMISSION"); got != opencodePermissionAllowAll {
		t.Fatalf("expected allow-all permission config, got %q", got)
	}
	if got := envValue(env, "XDG_CONFIG_HOME"); got != filepath.Join(runtimeDir, "opencode", "sessions", "session-123", "xdg", "config") {
		t.Fatalf("unexpected XDG_CONFIG_HOME: %q", got)
	}
}

func ptrValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func envValue(env []string, key string) string {
	for _, entry := range env {
		currentKey, value, ok := strings.Cut(entry, "=")
		if ok && strings.EqualFold(strings.TrimSpace(currentKey), strings.TrimSpace(key)) {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
