package pi

// pi.go derivation notes:
// - CLI reference source: https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/README.md
// - RPC protocol source: https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md
// - Local notes source: PI_AGENT_DOCS.md
// - Capture date: 2026-02-26.
// - Local `pi --help` and `man pi` were unavailable in this environment.

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

type PiCLI struct {
	Path string
	Env  []string
	Dir  string
}

func NewPiCLI() *PiCLI {
	path := strings.TrimSpace(os.Getenv("PI_EXECUTABLE_PATH"))
	if path == "" {
		path = strings.TrimSpace(os.Getenv("PI_PATH"))
	}
	if path == "" {
		path = "pi"
	}
	return &PiCLI{Path: path}
}

type PiRunResult struct {
	Args     []string
	ExitCode int
	Stdout   string
	Stderr   string
}

type PiExecError struct {
	Command  string
	ExitCode int
	Stderr   string
}

func (e *PiExecError) Error() string {
	if strings.TrimSpace(e.Stderr) == "" {
		return fmt.Sprintf("pi command failed (exit=%d): %s", e.ExitCode, e.Command)
	}
	return fmt.Sprintf("pi command failed (exit=%d): %s: %s", e.ExitCode, e.Command, strings.TrimSpace(e.Stderr))
}

type PiOptions struct {
	Print        bool
	Mode         string
	ExportIn     string
	ExportOut    string
	Provider     string
	Model        string
	APIKey       string
	Thinking     string
	Models       string
	ListModels   string
	Continue     bool
	Resume       bool
	Session      string
	SessionDir   string
	NoSession    bool
	Tools        string
	NoTools      bool
	Extensions   []string
	NoExtensions bool
	Skills       []string
	NoSkills     bool
	Prompts      []string
	NoPrompts    bool
	Themes       []string
	NoThemes     bool
	SystemPrompt string
	AppendPrompt string
	Verbose      bool
	Files        []string
	Messages     []string
}

type PiPackageOptions struct {
	Source string
	Local  bool
}

type PiUpdateOptions struct {
	Source string
}

type PiJSONLEvent struct {
	Raw        string
	Value      map[string]any
	IsResponse bool
	Command    string
	Success    bool
	ID         string
}

type PiRPCImage struct {
	Type     string `json:"type"`
	Data     string `json:"data"`
	MimeType string `json:"mimeType"`
}

const (
	PiRPCStreamingBehaviorSteer    = "steer"
	PiRPCStreamingBehaviorFollowUp = "followUp"
)

func normalizePiRPCStreamingBehavior(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(trimmed, "-", ""), "_", ""))
	switch normalized {
	case PiRPCStreamingBehaviorSteer:
		return PiRPCStreamingBehaviorSteer
	case "followup":
		return PiRPCStreamingBehaviorFollowUp
	default:
		return trimmed
	}
}

func (c *PiCLI) Args(opts PiOptions) []string {
	args := []string{}
	if opts.Print {
		args = append(args, "-p")
	}
	if v := strings.TrimSpace(opts.Mode); v != "" {
		args = append(args, "--mode", v)
	}
	if v := strings.TrimSpace(opts.ExportIn); v != "" {
		args = append(args, "--export", v)
		if out := strings.TrimSpace(opts.ExportOut); out != "" {
			args = append(args, out)
		}
	}
	if v := strings.TrimSpace(opts.Provider); v != "" {
		args = append(args, "--provider", v)
	}
	if v := strings.TrimSpace(opts.Model); v != "" {
		args = append(args, "--model", v)
	}
	if v := strings.TrimSpace(opts.APIKey); v != "" {
		args = append(args, "--api-key", v)
	}
	if v := strings.TrimSpace(opts.Thinking); v != "" {
		args = append(args, "--thinking", v)
	}
	if v := strings.TrimSpace(opts.Models); v != "" {
		args = append(args, "--models", v)
	}
	if opts.ListModels != "" {
		args = append(args, "--list-models")
		if v := strings.TrimSpace(opts.ListModels); v != "" {
			args = append(args, v)
		}
	}
	if opts.Continue {
		args = append(args, "-c")
	}
	if opts.Resume {
		args = append(args, "-r")
	}
	if v := strings.TrimSpace(opts.Session); v != "" {
		args = append(args, "--session", v)
	}
	if v := strings.TrimSpace(opts.SessionDir); v != "" {
		args = append(args, "--session-dir", v)
	}
	if opts.NoSession {
		args = append(args, "--no-session")
	}
	if v := strings.TrimSpace(opts.Tools); v != "" {
		args = append(args, "--tools", v)
	}
	if opts.NoTools {
		args = append(args, "--no-tools")
	}
	for _, ext := range opts.Extensions {
		ext = strings.TrimSpace(ext)
		if ext != "" {
			args = append(args, "-e", ext)
		}
	}
	if opts.NoExtensions {
		args = append(args, "--no-extensions")
	}
	for _, s := range opts.Skills {
		s = strings.TrimSpace(s)
		if s != "" {
			args = append(args, "--skill", s)
		}
	}
	if opts.NoSkills {
		args = append(args, "--no-skills")
	}
	for _, p := range opts.Prompts {
		p = strings.TrimSpace(p)
		if p != "" {
			args = append(args, "--prompt-template", p)
		}
	}
	if opts.NoPrompts {
		args = append(args, "--no-prompt-templates")
	}
	for _, t := range opts.Themes {
		t = strings.TrimSpace(t)
		if t != "" {
			args = append(args, "--theme", t)
		}
	}
	if opts.NoThemes {
		args = append(args, "--no-themes")
	}
	if v := strings.TrimSpace(opts.SystemPrompt); v != "" {
		args = append(args, "--system-prompt", v)
	}
	if v := strings.TrimSpace(opts.AppendPrompt); v != "" {
		args = append(args, "--append-system-prompt", v)
	}
	if opts.Verbose {
		args = append(args, "--verbose")
	}
	for _, f := range opts.Files {
		f = strings.TrimSpace(f)
		if f != "" {
			if strings.HasPrefix(f, "@") {
				args = append(args, f)
			} else {
				args = append(args, "@"+f)
			}
		}
	}
	for _, msg := range opts.Messages {
		msg = strings.TrimSpace(msg)
		if msg != "" {
			args = append(args, msg)
		}
	}
	return args
}

func (c *PiCLI) InstallArgs(opts PiPackageOptions) []string {
	args := []string{"install"}
	if v := strings.TrimSpace(opts.Source); v != "" {
		args = append(args, v)
	}
	if opts.Local {
		args = append(args, "-l")
	}
	return args
}

func (c *PiCLI) RemoveArgs(opts PiPackageOptions) []string {
	args := []string{"remove"}
	if v := strings.TrimSpace(opts.Source); v != "" {
		args = append(args, v)
	}
	if opts.Local {
		args = append(args, "-l")
	}
	return args
}

func (c *PiCLI) UpdateArgs(opts PiUpdateOptions) []string {
	args := []string{"update"}
	if v := strings.TrimSpace(opts.Source); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *PiCLI) ListArgs() []string {
	return []string{"list"}
}

func (c *PiCLI) ConfigArgs() []string {
	return []string{"config"}
}

func (c *PiCLI) Run(ctx context.Context, args []string, stdin io.Reader) (PiRunResult, error) {
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
	result := PiRunResult{Args: append([]string(nil), args...), Stdout: stdout.String(), Stderr: stderr.String()}
	if err == nil {
		result.ExitCode = 0
		return result, nil
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		result.ExitCode = exitErr.ExitCode()
		return result, &PiExecError{Command: strings.Join(append([]string{c.Path}, args...), " "), ExitCode: exitErr.ExitCode(), Stderr: result.Stderr}
	}

	result.ExitCode = -1
	return result, err
}

func (c *PiCLI) RunJSONL(ctx context.Context, args []string, stdin io.Reader, onEvent func(PiJSONLEvent)) (PiRunResult, error) {
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
		return PiRunResult{}, err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return PiRunResult{}, err
	}

	if err := cmd.Start(); err != nil {
		return PiRunResult{}, err
	}

	var stdoutBuf, stderrBuf bytes.Buffer
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		_ = DecodePiJSONL(stdoutPipe, func(event PiJSONLEvent) {
			stdoutBuf.WriteString(event.Raw)
			stdoutBuf.WriteByte('\n')
			if onEvent != nil {
				onEvent(event)
			}
		})
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(&stderrBuf, stderrPipe)
	}()

	waitErr := cmd.Wait()
	wg.Wait()

	result := PiRunResult{Args: append([]string(nil), args...), Stdout: stdoutBuf.String(), Stderr: stderrBuf.String()}
	if waitErr == nil {
		result.ExitCode = 0
		return result, nil
	}
	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) {
		result.ExitCode = exitErr.ExitCode()
		return result, &PiExecError{Command: strings.Join(append([]string{c.Path}, args...), " "), ExitCode: exitErr.ExitCode(), Stderr: result.Stderr}
	}
	result.ExitCode = -1
	return result, waitErr
}

func DecodePiJSONL(r io.Reader, onEvent func(PiJSONLEvent)) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(line), &payload); err != nil {
			continue
		}
		evt := PiJSONLEvent{Raw: line, Value: payload}
		if t, _ := payload["type"].(string); t == "response" {
			evt.IsResponse = true
			evt.Command, _ = payload["command"].(string)
			evt.Success, _ = payload["success"].(bool)
			evt.ID, _ = payload["id"].(string)
		}
		onEvent(evt)
	}
	return scanner.Err()
}

func EncodePiRPCCommand(cmd map[string]any) ([]byte, error) {
	payload, err := json.Marshal(cmd)
	if err != nil {
		return nil, err
	}
	payload = append(payload, '\n')
	return payload, nil
}

func PiRPCPrompt(id, message string, images []PiRPCImage, streamingBehavior string) map[string]any {
	cmd := map[string]any{"type": "prompt", "message": message}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	if len(images) > 0 {
		cmd["images"] = images
	}
	if v := normalizePiRPCStreamingBehavior(streamingBehavior); v != "" {
		cmd["streamingBehavior"] = v
	}
	return cmd
}

func PiRPCSteer(id, message string, images []PiRPCImage) map[string]any {
	cmd := map[string]any{"type": "steer", "message": message}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	if len(images) > 0 {
		cmd["images"] = images
	}
	return cmd
}

func PiRPCFollowUp(id, message string, images []PiRPCImage) map[string]any {
	cmd := map[string]any{"type": "follow_up", "message": message}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	if len(images) > 0 {
		cmd["images"] = images
	}
	return cmd
}

func PiRPCAbort(id string) map[string]any {
	cmd := map[string]any{"type": "abort"}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	return cmd
}

func PiRPCGetState(id string) map[string]any {
	cmd := map[string]any{"type": "get_state"}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	return cmd
}

func PiRPCGetMessages(id string) map[string]any {
	cmd := map[string]any{"type": "get_messages"}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	return cmd
}

func PiRPCSetModel(id, provider, modelID string) map[string]any {
	cmd := map[string]any{"type": "set_model", "provider": provider, "modelId": modelID}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	return cmd
}

func PiRPCSetThinkingLevel(id, level string) map[string]any {
	cmd := map[string]any{"type": "set_thinking_level", "level": level}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	return cmd
}

func PiRPCCycleModel(id string) map[string]any {
	cmd := map[string]any{"type": "cycle_model"}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	return cmd
}

func PiRPCCycleThinkingLevel(id string) map[string]any {
	cmd := map[string]any{"type": "cycle_thinking_level"}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	return cmd
}

func PiRPCNewSession(id, parentSession string) map[string]any {
	cmd := map[string]any{"type": "new_session"}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	if v := strings.TrimSpace(parentSession); v != "" {
		cmd["parentSession"] = v
	}
	return cmd
}

func PiRPCSwitchSession(id, sessionPath string) map[string]any {
	cmd := map[string]any{"type": "switch_session"}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	if v := strings.TrimSpace(sessionPath); v != "" {
		cmd["sessionPath"] = v
	}
	return cmd
}

func PiRPCFork(id, entryID string) map[string]any {
	cmd := map[string]any{"type": "fork"}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	if v := strings.TrimSpace(entryID); v != "" {
		cmd["entryId"] = v
	}
	return cmd
}

func PiRPCExportHTML(id, outputPath string) map[string]any {
	cmd := map[string]any{"type": "export_html"}
	if id = strings.TrimSpace(id); id != "" {
		cmd["id"] = id
	}
	if outputPath = strings.TrimSpace(outputPath); outputPath != "" {
		cmd["outputPath"] = outputPath
	}
	return cmd
}
