package server

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExecutePiCLIRunUsesPrintMode(t *testing.T) {
	tmpDir := t.TempDir()
	argsPath := filepath.Join(tmpDir, "pi-args.txt")
	fakePiPath := filepath.Join(tmpDir, "fake-pi")

	script := "#!/bin/sh\n" +
		"set -eu\n" +
		": > \"" + argsPath + "\"\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> \"" + argsPath + "\"\n" +
		"done\n" +
		"printf '%s\\n' '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"ok\"}}'\n" +
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]}}'\n"
	if err := os.WriteFile(fakePiPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake pi: %v", err)
	}

	app := &server{
		cfg: serveConfig{
			RuntimeDir: tmpDir,
		},
		pi: &PiCLI{
			Path: fakePiPath,
			Dir:  tmpDir,
		},
	}

	sessionID := "1234567890abcdef1234567890abcdef"
	session := &sessionRecord{ID: sessionID, Harness: "pi"}

	events := make([]map[string]any, 0, 1)
	result, err := app.executePiCLIRun(context.Background(), session, []normalizedInput{
		{Type: "text", Text: "hello from pi"},
	}, func(evt map[string]any) {
		events = append(events, evt)
	})
	if err != nil {
		t.Fatalf("executePiCLIRun: %v", err)
	}
	if result.Text != "ok" {
		t.Fatalf("expected text %q, got %q", "ok", result.Text)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}

	expectedSessionFile := filepath.Join(tmpDir, "runtime", "pi-sessions", sessionID+".jsonl")
	if result.ExternalSessionID != expectedSessionFile {
		t.Fatalf("expected external session file %q, got %q", expectedSessionFile, result.ExternalSessionID)
	}

	rawArgs, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	args := strings.Split(strings.TrimSpace(string(rawArgs)), "\n")
	expectArg(t, args, "-p")
	expectArg(t, args, "--mode")
	expectArg(t, args, "json")
	expectArg(t, args, "--session")
	expectArg(t, args, expectedSessionFile)
	expectArg(t, args, "--session-dir")
	expectArg(t, args, filepath.Dir(expectedSessionFile))
	expectArg(t, args, "hello from pi")
}

func TestExecutePiCLIRunPreservesUsageOnMessageEnd(t *testing.T) {
	tmpDir := t.TempDir()
	fakePiPath := filepath.Join(tmpDir, "fake-pi")

	script := "#!/bin/sh\n" +
		"set -eu\n" +
		"printf '%s\\n' '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"ok\"}],\"usage\":{\"input\":100,\"output\":50,\"cacheRead\":0,\"cacheWrite\":0,\"cost\":{\"total\":0.00105}}}}'\n"
	if err := os.WriteFile(fakePiPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake pi: %v", err)
	}

	app := &server{
		cfg: serveConfig{
			RuntimeDir: tmpDir,
		},
		pi: &PiCLI{
			Path: fakePiPath,
			Dir:  tmpDir,
		},
	}

	session := &sessionRecord{ID: "1234567890abcdef1234567890abcdef", Harness: "pi"}

	events := make([]map[string]any, 0, 1)
	_, err := app.executePiCLIRun(context.Background(), session, []normalizedInput{
		{Type: "text", Text: "hello from pi"},
	}, func(evt map[string]any) {
		events = append(events, evt)
	})
	if err != nil {
		t.Fatalf("executePiCLIRun: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}

	message, _ := events[0]["message"].(map[string]any)
	if message == nil {
		t.Fatalf("expected compacted message payload, got %#v", events[0])
	}
	usage, _ := message["usage"].(map[string]any)
	if usage == nil {
		t.Fatalf("expected usage to be preserved, got %#v", message)
	}
	if got := usage["input"]; got != float64(100) {
		t.Fatalf("expected usage.input 100, got %#v", got)
	}
	cost, _ := usage["cost"].(map[string]any)
	if cost == nil {
		t.Fatalf("expected usage.cost to be preserved, got %#v", usage)
	}
	if got := cost["total"]; got != float64(0.00105) {
		t.Fatalf("expected usage.cost.total 0.00105, got %#v", got)
	}
}

func expectArg(t *testing.T, args []string, want string) {
	t.Helper()
	for _, arg := range args {
		if arg == want {
			return
		}
	}
	t.Fatalf("expected arg %q, got %v", want, args)
}
