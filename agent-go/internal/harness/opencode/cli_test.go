package opencode

import (
	"strings"
	"testing"
)

func TestOpencodeArgs(t *testing.T) {
	cli := NewOpencodeCLI()
	args := cli.Args(OpencodeOptions{
		Help:         true,
		Version:      true,
		Debug:        true,
		CWD:          "/repo",
		Prompt:       "fix tests",
		OutputFormat: "json",
		Quiet:        true,
	})

	joined := strings.Join(args, " ")
	checks := []string{
		"--help",
		"--version",
		"--debug",
		"--cwd /repo",
		"--prompt fix tests",
		"--output-format json",
		"--quiet",
	}
	for _, want := range checks {
		if !strings.Contains(joined, want) {
			t.Fatalf("expected %q in args: %v", want, args)
		}
	}
}
