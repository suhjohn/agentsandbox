package opencode

// opencode.go derivation notes:
// - CLI reference source: https://github.com/anomalyco/opencode
// - Command surface derived from `packages/opencode/src/cli/cmd/run.ts`
//   on the `dev` branch, inspected on 2026-03-09.
// - Root command registration source: `packages/opencode/src/index.ts`.
// - JSONL event shapes derived from the `emit(...)` calls in
//   `packages/opencode/src/cli/cmd/run.ts`.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
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

type OpencodeJSONLEvent struct {
	Raw   string
	Value map[string]any
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

type OpencodeRunOptions struct {
	Command  string
	Continue bool
	Session  string
	Fork     bool
	Share    bool
	Model    string
	Agent    string
	Format   string
	Files    []string
	Title    string
	Attach   string
	Password string
	Dir      string
	Port     int
	Variant  string
	Thinking bool
	Messages []string
}

func (c *OpencodeCLI) Args(opts OpencodeRunOptions) []string {
	args := []string{"run"}
	if v := strings.TrimSpace(opts.Command); v != "" {
		args = append(args, "--command", v)
	}
	if opts.Continue {
		args = append(args, "--continue")
	}
	if v := strings.TrimSpace(opts.Session); v != "" {
		args = append(args, "--session", v)
	}
	if opts.Fork {
		args = append(args, "--fork")
	}
	if opts.Share {
		args = append(args, "--share")
	}
	if v := strings.TrimSpace(opts.Model); v != "" {
		args = append(args, "--model", v)
	}
	if v := strings.TrimSpace(opts.Agent); v != "" {
		args = append(args, "--agent", v)
	}
	if v := strings.TrimSpace(opts.Format); v != "" {
		args = append(args, "--format", v)
	}
	for _, file := range opts.Files {
		file = strings.TrimSpace(file)
		if file != "" {
			args = append(args, "--file", file)
		}
	}
	if title := strings.TrimSpace(opts.Title); title != "" {
		args = append(args, "--title", title)
	}
	if v := strings.TrimSpace(opts.Attach); v != "" {
		args = append(args, "--attach", v)
	}
	if v := strings.TrimSpace(opts.Password); v != "" {
		args = append(args, "--password", v)
	}
	if v := strings.TrimSpace(opts.Dir); v != "" {
		args = append(args, "--dir", v)
	}
	if opts.Port > 0 {
		args = append(args, "--port", fmt.Sprintf("%d", opts.Port))
	}
	if v := strings.TrimSpace(opts.Variant); v != "" {
		args = append(args, "--variant", v)
	}
	if opts.Thinking {
		args = append(args, "--thinking")
	}
	for _, message := range opts.Messages {
		message = strings.TrimSpace(message)
		if message != "" {
			args = append(args, message)
		}
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

func (c *OpencodeCLI) RunJSONL(ctx context.Context, args []string, stdin io.Reader, onEvent func(OpencodeJSONLEvent)) (OpencodeRunResult, error) {
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

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return OpencodeRunResult{}, err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return OpencodeRunResult{}, err
	}

	if err := cmd.Start(); err != nil {
		return OpencodeRunResult{}, err
	}

	var stdoutBuf, stderrBuf bytes.Buffer
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdoutPipe)
		scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			stdoutBuf.WriteString(line)
			stdoutBuf.WriteByte('\n')
			if onEvent == nil {
				continue
			}
			var parsed map[string]any
			if err := json.Unmarshal([]byte(line), &parsed); err != nil {
				continue
			}
			onEvent(OpencodeJSONLEvent{Raw: line, Value: parsed})
		}
	}()

	go func() {
		defer wg.Done()
		_, _ = io.Copy(&stderrBuf, stderrPipe)
	}()

	waitErr := cmd.Wait()
	wg.Wait()

	result := OpencodeRunResult{
		Args:   append([]string(nil), args...),
		Stdout: stdoutBuf.String(),
		Stderr: stderrBuf.String(),
	}
	if waitErr == nil {
		result.ExitCode = 0
		return result, nil
	}
	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) {
		result.ExitCode = exitErr.ExitCode()
		return result, &OpencodeExecError{
			Command:  strings.Join(append([]string{c.Path}, args...), " "),
			ExitCode: exitErr.ExitCode(),
			Stderr:   result.Stderr,
		}
	}
	result.ExitCode = -1
	return result, waitErr
}
