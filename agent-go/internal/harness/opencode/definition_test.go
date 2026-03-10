package opencode

import (
	"context"
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

	configRaw, err := os.ReadFile(filepath.Join(runtimeDir, "opencode", "config.json"))
	if err != nil {
		t.Fatalf("ReadFile config.json: %v", err)
	}
	if got := string(configRaw); got != opencodeRunConfigAllowAll {
		t.Fatalf("unexpected config.json contents: %q", got)
	}
}

func TestCompactEventForStream(t *testing.T) {
	if got := streamedMessageText(map[string]any{
		"type": "text",
		"part": map[string]any{
			"id":   "part-1",
			"text": "final answer",
		},
	}); got != "final answer" {
		t.Fatalf("expected text payload, got %q", got)
	}
}

func TestExecuteAppendsAllStreamedMessageTextAndEmitsRawEvents(t *testing.T) {
	tmpDir := t.TempDir()
	runtimeDir := filepath.Join(tmpDir, "runtime")
	scriptPath := filepath.Join(tmpDir, "fake-opencode.sh")
	script := strings.Join([]string{
		"#!/bin/sh",
		"printf '%s\\n' '{\"type\":\"step_start\",\"sessionID\":\"session-abc\",\"part\":{\"type\":\"step-start\"}}'",
		"printf '%s\\n' '{\"type\":\"reasoning\",\"part\":{\"text\":\"thinking\"}}'",
		"printf '%s\\n' '{\"type\":\"text\",\"part\":{\"text\":\"final answer\"}}'",
		"printf '%s\\n' '{\"type\":\"step_finish\",\"part\":{\"type\":\"step-finish\",\"tokens\":{\"input\":1,\"output\":2}}}'",
	}, "\n")
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("WriteFile fake opencode: %v", err)
	}

	h := NewHarness(&OpencodeCLI{Path: scriptPath})
	var streamed []map[string]any
	result, err := h.Execute(context.Background(), registry.ExecuteRequest{
		Session: registry.Session{
			ID: "session-123",
		},
		Input: []registry.Input{
			{Type: "text", Text: "fix tests"},
		},
		DefaultWorkingDir: tmpDir,
		RuntimeDir:        runtimeDir,
		EmitEvent: func(evt map[string]any) {
			streamed = append(streamed, evt)
		},
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if got := result.Text; got != "thinking\n\nfinal answer" {
		t.Fatalf("expected all streamed message text to be appended, got %q", got)
	}
	if result.ExternalSessionID != "session-abc" {
		t.Fatalf("expected raw session id to be preserved, got %q", result.ExternalSessionID)
	}
	if len(streamed) != 4 {
		t.Fatalf("expected 4 raw streamed events, got %d", len(streamed))
	}
	if got := registry.FirstNonEmptyString(streamed[0]["type"]); got != "step_start" {
		t.Fatalf("expected first raw event type step_start, got %q", got)
	}
	part, _ := streamed[3]["part"].(map[string]any)
	tokens, _ := part["tokens"].(map[string]any)
	if got := tokens["output"]; got != float64(2) {
		t.Fatalf("expected raw token usage to be preserved, got %#v", got)
	}
}

func TestOpencodeRunEnvForcesAllowAllPermissions(t *testing.T) {
	runtimeDir := filepath.Join(t.TempDir(), "runtime")
	env := opencodeRunEnv([]string{
		"OPENCODE_CONFIG_DIR=/custom/opencode",
		"OPENCODE_CONFIG=/tmp/ignored.json",
	}, runtimeDir, "session-123")

	if got := envValue(env, "OPENCODE_CONFIG_DIR"); got != "/custom/opencode" {
		t.Fatalf("expected custom config dir, got %q", got)
	}
	if got := envValue(env, "OPENCODE_CONFIG"); got != filepath.Join(runtimeDir, "opencode", "config.json") {
		t.Fatalf("expected managed OPENCODE_CONFIG, got %q", got)
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
