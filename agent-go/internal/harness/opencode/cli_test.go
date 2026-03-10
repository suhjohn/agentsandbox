package opencode

import (
	"strings"
	"testing"
)

func TestOpencodeRunArgs(t *testing.T) {
	cli := NewOpencodeCLI()
	args := cli.Args(OpencodeRunOptions{
		Session:  "session-123",
		Model:    "openai/gpt-4.1",
		Format:   "json",
		Files:    []string{"diagram.png"},
		Dir:      "/repo",
		Variant:  "high",
		Thinking: true,
		Messages: []string{"fix tests"},
	})

	joined := strings.Join(args, " ")
	checks := []string{
		"run",
		"--session session-123",
		"--model openai/gpt-4.1",
		"--format json",
		"--file diagram.png",
		"--dir /repo",
		"--variant high",
		"--thinking",
		"fix tests",
	}
	for _, want := range checks {
		if !strings.Contains(joined, want) {
			t.Fatalf("expected %q in args: %v", want, args)
		}
	}
}
