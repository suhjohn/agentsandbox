package opencode

// opencode.go derivation notes:
// - Source repo inspected locally from https://github.com/opencode-ai/opencode
// - Local clone path used for inspection: ~/opencode
// - CLI help/reference source: local `go run . --help` from that repo on 2026-03-09
// - Root command implementation source: ~/opencode/cmd/root.go
// - Project status from README.md in that repo: archived on 2025-09-17; ongoing development moved to Crush.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

type OpencodeCLI struct {
	Path string
	Env  []string
	Dir  string
}

func NewOpencodeCLI() *OpencodeCLI {
	path := strings.TrimSpace(os.Getenv("OPENCODE_EXECUTABLE_PATH"))
	if path == "" {
		path = strings.TrimSpace(os.Getenv("OPENCODE_PATH"))
	}
	if path == "" {
		path = "opencode"
	}
	return &OpencodeCLI{Path: path}
}

type OpencodeRunResult struct {
	Args     []string
	ExitCode int
	Stdout   string
	Stderr   string
}

type OpencodeExecError struct {
	Command  string
	ExitCode int
	Stderr   string
}

func (e *OpencodeExecError) Error() string {
	if strings.TrimSpace(e.Stderr) == "" {
		return fmt.Sprintf("opencode command failed (exit=%d): %s", e.ExitCode, e.Command)
	}
	return fmt.Sprintf("opencode command failed (exit=%d): %s: %s", e.ExitCode, e.Command, strings.TrimSpace(e.Stderr))
}

type OpencodeOptions struct {
	Help         bool
	Version      bool
	Debug        bool
	CWD          string
	Prompt       string
	OutputFormat string
	Quiet        bool
}

func (c *OpencodeCLI) Args(opts OpencodeOptions) []string {
	args := []string{}
	if opts.Help {
		args = append(args, "--help")
	}
	if opts.Version {
		args = append(args, "--version")
	}
	if opts.Debug {
		args = append(args, "--debug")
	}
	if v := strings.TrimSpace(opts.CWD); v != "" {
		args = append(args, "--cwd", v)
	}
	if v := strings.TrimSpace(opts.Prompt); v != "" {
		args = append(args, "--prompt", v)
	}
	if v := strings.TrimSpace(opts.OutputFormat); v != "" {
		args = append(args, "--output-format", v)
	}
	if opts.Quiet {
		args = append(args, "--quiet")
	}
	return args
}

func (c *OpencodeCLI) Run(ctx context.Context, args []string, stdin io.Reader) (OpencodeRunResult, error) {
	cmd := exec.CommandContext(ctx, c.Path, args...)
	if c.Dir != "" {
		cmd.Dir = c.Dir
	}
	if len(c.Env) > 0 {
		cmd.Env = append(os.Environ(), c.Env...)
	}
	if stdin != nil {
		cmd.Stdin = stdin
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	result := OpencodeRunResult{
		Args:   append([]string(nil), args...),
		Stdout: stdout.String(),
		Stderr: stderr.String(),
	}
	if err == nil {
		result.ExitCode = 0
		return result, nil
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		result.ExitCode = exitErr.ExitCode()
		return result, &OpencodeExecError{
			Command:  strings.Join(append([]string{c.Path}, args...), " "),
			ExitCode: exitErr.ExitCode(),
			Stderr:   result.Stderr,
		}
	}

	result.ExitCode = -1
	return result, err
}
