package pi

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"agent-go/internal/harness/registry"
)

func TestExecuteIncludesBundledClientToolsExtensionAndRunIDEnv(t *testing.T) {
	tmpDir := t.TempDir()
	repoDir := filepath.Join(tmpDir, "repo")
	extensionPath := filepath.Join(repoDir, bundledClientToolsExtensionRelativePath)
	if err := os.MkdirAll(filepath.Dir(extensionPath), 0o755); err != nil {
		t.Fatalf("MkdirAll extension dir: %v", err)
	}
	if err := os.WriteFile(extensionPath, []byte("export default function () {}\n"), 0o644); err != nil {
		t.Fatalf("WriteFile extension index: %v", err)
	}
	t.Setenv("AGENT_GO_REPO_DIR", repoDir)

	argsPath := filepath.Join(tmpDir, "pi-args.txt")
	runIDPath := filepath.Join(tmpDir, "pi-run-id.txt")
	fakePiPath := filepath.Join(tmpDir, "fake-pi")
	script := "#!/bin/sh\n" +
		"set -eu\n" +
		": > \"" + argsPath + "\"\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> \"" + argsPath + "\"\n" +
		"done\n" +
		"printf '%s' \"${AGENT_GO_CLIENT_TOOL_RUN_ID:-}\" > \"" + runIDPath + "\"\n" +
		"cat >/dev/null\n" +
		"printf '%s\\n' '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"ok\"}}'\n"
	if err := os.WriteFile(fakePiPath, []byte(script), 0o755); err != nil {
		t.Fatalf("WriteFile fake pi: %v", err)
	}

	h := NewHarness(&PiCLI{
		Path: fakePiPath,
		Dir:  tmpDir,
	})

	_, err := h.Execute(context.Background(), registry.ExecuteRequest{
		Session: registry.Session{
			ID: "1234567890abcdef1234567890abcdef",
		},
		Input:      []registry.Input{{Type: "text", Text: "hello"}},
		RuntimeDir: tmpDir,
		RunID:      "run-123",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	rawArgs, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("ReadFile args: %v", err)
	}
	args := strings.Split(strings.TrimSpace(string(rawArgs)), "\n")
	expectArg := func(want string) {
		t.Helper()
		for _, arg := range args {
			if arg == want {
				return
			}
		}
		t.Fatalf("expected arg %q in %v", want, args)
	}
	expectArg("-e")
	expectArg(extensionPath)

	rawRunID, err := os.ReadFile(runIDPath)
	if err != nil {
		t.Fatalf("ReadFile run id: %v", err)
	}
	if got := strings.TrimSpace(string(rawRunID)); got != "run-123" {
		t.Fatalf("expected AGENT_GO_CLIENT_TOOL_RUN_ID run-123, got %q", got)
	}
}
