package codex

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"agent-go/internal/harness/registry"
)

func TestHarnessExecutePassesClientToolRunIDToCodexAndMCPConfig(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	argsPath := filepath.Join(tempDir, "args.txt")
	envPath := filepath.Join(tempDir, "env.txt")
	scriptPath := filepath.Join(tempDir, "codex")
	script := strings.Join([]string{
		"#!/bin/sh",
		"printf '%s\\n' \"$@\" >" + shellQuote(argsPath),
		"printf '%s\\n' \"$AGENT_GO_CLIENT_TOOL_RUN_ID\" >" + shellQuote(envPath),
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"text\":\"ok\"}}'",
		"",
	}, "\n")
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write script: %v", err)
	}

	h := NewHarness(&CodexCLI{Path: scriptPath})
	_, err := h.Execute(context.Background(), registry.ExecuteRequest{
		RunID:             "run-123",
		DefaultWorkingDir: tempDir,
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}

	envRaw, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("read env file: %v", err)
	}
	if got := strings.TrimSpace(string(envRaw)); got != "run-123" {
		t.Fatalf("expected AGENT_GO_CLIENT_TOOL_RUN_ID in child env, got %q", got)
	}

	argsRaw, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args file: %v", err)
	}
	argsText := string(argsRaw)
	if !strings.Contains(argsText, "mcp_servers.agent_go_client_tools.env.AGENT_GO_CLIENT_TOOL_RUN_ID=\"run-123\"") {
		t.Fatalf("expected codex config override in args, got %q", argsText)
	}
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}
