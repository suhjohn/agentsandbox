package codex

// codex.go derivation notes:
// - Command/flag surface derived from local CLI help output on 2026-02-26:
//   `codex --help` and subcommand help pages (e.g. `codex exec --help`,
//   `codex mcp --help`, `codex cloud --help`, `codex app-server --help`,
//   `codex debug app-server send-message-v2 --help`).
// - Additional reference: https://developers.openai.com/codex/cli
// - `man codex` was unavailable in this environment.

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

type CodexCLI struct {
	Path string
	Env  []string
	Dir  string
}

func NewCodexCLI() *CodexCLI {
	path := strings.TrimSpace(os.Getenv("CODEX_EXECUTABLE_PATH"))
	if path == "" {
		path = strings.TrimSpace(os.Getenv("CODEX_PATH"))
	}
	if path == "" {
		path = "codex"
	}
	return &CodexCLI{Path: path}
}

type CodexRunResult struct {
	Args     []string
	ExitCode int
	Stdout   string
	Stderr   string
}

type CodexJSONLEvent struct {
	Raw   string
	Value map[string]any
}

type CodexExecError struct {
	Command  string
	ExitCode int
	Stderr   string
}

func (e *CodexExecError) Error() string {
	if strings.TrimSpace(e.Stderr) == "" {
		return fmt.Sprintf("codex command failed (exit=%d): %s", e.ExitCode, e.Command)
	}
	return fmt.Sprintf("codex command failed (exit=%d): %s: %s", e.ExitCode, e.Command, strings.TrimSpace(e.Stderr))
}

type CodexGlobalOptions struct {
	Config  []string
	Enable  []string
	Disable []string
}

type CodexRootOptions struct {
	CodexGlobalOptions
	Prompt            string
	Images            []string
	Model             string
	OSS               bool
	LocalProvider     string
	Profile           string
	Sandbox           string
	ApprovalPolicy    string
	FullAuto          bool
	DangerouslyBypass bool
	CD                string
	Search            bool
	AddDirs           []string
	NoAltScreen       bool
}

type CodexExecOptions struct {
	CodexRootOptions
	SkipGitRepoCheck  bool
	Ephemeral         bool
	OutputSchema      string
	Color             string
	ProgressCursor    bool
	JSON              bool
	OutputLastMessage string
}

type CodexResumeOptions struct {
	CodexGlobalOptions
	SessionID string
	Prompt    string
	Last      bool
	Fork      bool
}

type CodexReviewOptions struct {
	CodexGlobalOptions
	Prompt string
	JSON   bool
}

type CodexMCPAddOptions struct {
	CodexGlobalOptions
	Name  string
	URL   string
	Token string
}

type CodexMCPGetOptions struct {
	CodexGlobalOptions
	Name string
}

type CodexMCPRemoveOptions struct {
	CodexGlobalOptions
	Name string
}

type CodexMCPLoginOptions struct {
	CodexGlobalOptions
	Name string
}

type CodexMCPLogoutOptions struct {
	CodexGlobalOptions
	Name string
}

type CodexCompletionOptions struct {
	CodexGlobalOptions
	Shell string
}

type CodexApplyOptions struct {
	CodexGlobalOptions
	TaskID string
}

type CodexCloudExecOptions struct {
	CodexGlobalOptions
	EnvID    string
	Query    string
	Attempts int
	Branch   string
}

type CodexCloudListOptions struct {
	CodexGlobalOptions
	EnvID  string
	Limit  int
	Cursor string
	JSON   bool
}

type CodexCloudTaskOptions struct {
	CodexGlobalOptions
	TaskID  string
	Attempt int
}

type CodexAppServerOptions struct {
	CodexGlobalOptions
	Listen                  string
	AnalyticsDefaultEnabled bool
}

type CodexDebugAppServerSendMessageV2Options struct {
	CodexGlobalOptions
	UserMessage string
	JSONBody    string
}

func (c *CodexCLI) RootArgs(opts CodexRootOptions) []string {
	args := c.appendGlobalFlags(nil, opts.CodexGlobalOptions)
	args = c.appendRootFlags(args, opts)
	if prompt := strings.TrimSpace(opts.Prompt); prompt != "" {
		args = append(args, prompt)
	}
	return args
}

func (c *CodexCLI) ExecArgs(opts CodexExecOptions) []string {
	args := c.appendGlobalFlags([]string{"exec"}, opts.CodexGlobalOptions)
	args = c.appendRootFlags(args, opts.CodexRootOptions)
	if opts.SkipGitRepoCheck {
		args = append(args, "--skip-git-repo-check")
	}
	if opts.Ephemeral {
		args = append(args, "--ephemeral")
	}
	if v := strings.TrimSpace(opts.OutputSchema); v != "" {
		args = append(args, "--output-schema", v)
	}
	if v := strings.TrimSpace(opts.Color); v != "" {
		args = append(args, "--color", v)
	}
	if opts.ProgressCursor {
		args = append(args, "--progress-cursor")
	}
	if opts.JSON {
		args = append(args, "--json")
	}
	if v := strings.TrimSpace(opts.OutputLastMessage); v != "" {
		args = append(args, "--output-last-message", v)
	}
	if prompt := strings.TrimSpace(opts.Prompt); prompt != "" {
		args = append(args, prompt)
	}
	return args
}

func (c *CodexCLI) ExecResumeArgs(opts CodexResumeOptions) []string {
	args := c.appendGlobalFlags([]string{"exec", "resume"}, opts.CodexGlobalOptions)
	if opts.Last {
		args = append(args, "--last")
	}
	if v := strings.TrimSpace(opts.SessionID); v != "" {
		args = append(args, v)
	}
	if v := strings.TrimSpace(opts.Prompt); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) ExecReviewArgs(opts CodexReviewOptions) []string {
	args := c.appendGlobalFlags([]string{"exec", "review"}, opts.CodexGlobalOptions)
	if opts.JSON {
		args = append(args, "--json")
	}
	if v := strings.TrimSpace(opts.Prompt); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) ReviewArgs(opts CodexReviewOptions) []string {
	args := c.appendGlobalFlags([]string{"review"}, opts.CodexGlobalOptions)
	if opts.JSON {
		args = append(args, "--json")
	}
	if v := strings.TrimSpace(opts.Prompt); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) ResumeArgs(opts CodexResumeOptions) []string {
	args := []string{"resume"}
	if opts.Fork {
		args[0] = "fork"
	}
	args = c.appendGlobalFlags(args, opts.CodexGlobalOptions)
	if opts.Last {
		args = append(args, "--last")
	}
	if v := strings.TrimSpace(opts.SessionID); v != "" {
		args = append(args, v)
	}
	if v := strings.TrimSpace(opts.Prompt); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) MCPListArgs(global CodexGlobalOptions) []string {
	return c.appendGlobalFlags([]string{"mcp", "list"}, global)
}

func (c *CodexCLI) MCPGetArgs(opts CodexMCPGetOptions) []string {
	args := c.appendGlobalFlags([]string{"mcp", "get"}, opts.CodexGlobalOptions)
	if v := strings.TrimSpace(opts.Name); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) MCPAddArgs(opts CodexMCPAddOptions) []string {
	args := c.appendGlobalFlags([]string{"mcp", "add"}, opts.CodexGlobalOptions)
	if v := strings.TrimSpace(opts.Name); v != "" {
		args = append(args, v)
	}
	if v := strings.TrimSpace(opts.URL); v != "" {
		args = append(args, v)
	}
	if v := strings.TrimSpace(opts.Token); v != "" {
		args = append(args, "--token", v)
	}
	return args
}

func (c *CodexCLI) MCPRemoveArgs(opts CodexMCPRemoveOptions) []string {
	args := c.appendGlobalFlags([]string{"mcp", "remove"}, opts.CodexGlobalOptions)
	if v := strings.TrimSpace(opts.Name); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) MCPLoginArgs(opts CodexMCPLoginOptions) []string {
	args := c.appendGlobalFlags([]string{"mcp", "login"}, opts.CodexGlobalOptions)
	if v := strings.TrimSpace(opts.Name); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) MCPLogoutArgs(opts CodexMCPLogoutOptions) []string {
	args := c.appendGlobalFlags([]string{"mcp", "logout"}, opts.CodexGlobalOptions)
	if v := strings.TrimSpace(opts.Name); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) MCPServerArgs(global CodexGlobalOptions) []string {
	return c.appendGlobalFlags([]string{"mcp-server"}, global)
}

func (c *CodexCLI) CompletionArgs(opts CodexCompletionOptions) []string {
	args := c.appendGlobalFlags([]string{"completion"}, opts.CodexGlobalOptions)
	if v := strings.TrimSpace(opts.Shell); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) SandboxArgs(global CodexGlobalOptions, passthrough []string) []string {
	args := c.appendGlobalFlags([]string{"sandbox"}, global)
	args = append(args, passthrough...)
	return args
}

func (c *CodexCLI) LoginArgs(global CodexGlobalOptions) []string {
	return c.appendGlobalFlags([]string{"login"}, global)
}

func (c *CodexCLI) LogoutArgs(global CodexGlobalOptions) []string {
	return c.appendGlobalFlags([]string{"logout"}, global)
}

func (c *CodexCLI) ApplyArgs(opts CodexApplyOptions) []string {
	args := c.appendGlobalFlags([]string{"apply"}, opts.CodexGlobalOptions)
	if v := strings.TrimSpace(opts.TaskID); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) FeaturesListArgs(global CodexGlobalOptions) []string {
	return c.appendGlobalFlags([]string{"features", "list"}, global)
}

func (c *CodexCLI) FeaturesEnableArgs(global CodexGlobalOptions, feature string) []string {
	args := c.appendGlobalFlags([]string{"features", "enable"}, global)
	if v := strings.TrimSpace(feature); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) FeaturesDisableArgs(global CodexGlobalOptions, feature string) []string {
	args := c.appendGlobalFlags([]string{"features", "disable"}, global)
	if v := strings.TrimSpace(feature); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) CloudExecArgs(opts CodexCloudExecOptions) []string {
	args := c.appendGlobalFlags([]string{"cloud", "exec"}, opts.CodexGlobalOptions)
	if v := strings.TrimSpace(opts.EnvID); v != "" {
		args = append(args, "--env", v)
	}
	if opts.Attempts > 0 {
		args = append(args, "--attempts", fmt.Sprintf("%d", opts.Attempts))
	}
	if v := strings.TrimSpace(opts.Branch); v != "" {
		args = append(args, "--branch", v)
	}
	if v := strings.TrimSpace(opts.Query); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) CloudStatusArgs(opts CodexCloudTaskOptions) []string {
	args := c.appendGlobalFlags([]string{"cloud", "status"}, opts.CodexGlobalOptions)
	if v := strings.TrimSpace(opts.TaskID); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) CloudListArgs(opts CodexCloudListOptions) []string {
	args := c.appendGlobalFlags([]string{"cloud", "list"}, opts.CodexGlobalOptions)
	if v := strings.TrimSpace(opts.EnvID); v != "" {
		args = append(args, "--env", v)
	}
	if opts.Limit > 0 {
		args = append(args, "--limit", fmt.Sprintf("%d", opts.Limit))
	}
	if v := strings.TrimSpace(opts.Cursor); v != "" {
		args = append(args, "--cursor", v)
	}
	if opts.JSON {
		args = append(args, "--json")
	}
	return args
}

func (c *CodexCLI) CloudApplyArgs(opts CodexCloudTaskOptions) []string {
	args := c.appendGlobalFlags([]string{"cloud", "apply"}, opts.CodexGlobalOptions)
	if opts.Attempt > 0 {
		args = append(args, "--attempt", fmt.Sprintf("%d", opts.Attempt))
	}
	if v := strings.TrimSpace(opts.TaskID); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) CloudDiffArgs(opts CodexCloudTaskOptions) []string {
	args := c.appendGlobalFlags([]string{"cloud", "diff"}, opts.CodexGlobalOptions)
	if opts.Attempt > 0 {
		args = append(args, "--attempt", fmt.Sprintf("%d", opts.Attempt))
	}
	if v := strings.TrimSpace(opts.TaskID); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) AppServerArgs(opts CodexAppServerOptions) []string {
	args := c.appendGlobalFlags([]string{"app-server"}, opts.CodexGlobalOptions)
	if v := strings.TrimSpace(opts.Listen); v != "" {
		args = append(args, "--listen", v)
	}
	if opts.AnalyticsDefaultEnabled {
		args = append(args, "--analytics-default-enabled")
	}
	return args
}

func (c *CodexCLI) AppServerGenerateTSArgs(global CodexGlobalOptions) []string {
	return c.appendGlobalFlags([]string{"app-server", "generate-ts"}, global)
}

func (c *CodexCLI) AppServerGenerateJSONSchemaArgs(global CodexGlobalOptions) []string {
	return c.appendGlobalFlags([]string{"app-server", "generate-json-schema"}, global)
}

func (c *CodexCLI) DebugAppServerSendMessageV2Args(opts CodexDebugAppServerSendMessageV2Options) []string {
	args := c.appendGlobalFlags([]string{"debug", "app-server", "send-message-v2"}, opts.CodexGlobalOptions)
	if v := strings.TrimSpace(opts.JSONBody); v != "" {
		args = append(args, "--json", v)
	}
	if v := strings.TrimSpace(opts.UserMessage); v != "" {
		args = append(args, v)
	}
	return args
}

func (c *CodexCLI) appendGlobalFlags(args []string, opts CodexGlobalOptions) []string {
	for _, cfg := range opts.Config {
		cfg = strings.TrimSpace(cfg)
		if cfg != "" {
			args = append(args, "-c", cfg)
		}
	}
	for _, f := range opts.Enable {
		f = strings.TrimSpace(f)
		if f != "" {
			args = append(args, "--enable", f)
		}
	}
	for _, f := range opts.Disable {
		f = strings.TrimSpace(f)
		if f != "" {
			args = append(args, "--disable", f)
		}
	}
	return args
}

func (c *CodexCLI) appendRootFlags(args []string, opts CodexRootOptions) []string {
	for _, image := range opts.Images {
		image = strings.TrimSpace(image)
		if image != "" {
			args = append(args, "--image", image)
		}
	}
	if v := strings.TrimSpace(opts.Model); v != "" {
		args = append(args, "--model", v)
	}
	if opts.OSS {
		args = append(args, "--oss")
	}
	if v := strings.TrimSpace(opts.LocalProvider); v != "" {
		args = append(args, "--local-provider", v)
	}
	if v := strings.TrimSpace(opts.Profile); v != "" {
		args = append(args, "--profile", v)
	}
	if v := strings.TrimSpace(opts.Sandbox); v != "" {
		args = append(args, "--sandbox", v)
	}
	if v := strings.TrimSpace(opts.ApprovalPolicy); v != "" {
		args = append(args, "--ask-for-approval", v)
	}
	if opts.FullAuto {
		args = append(args, "--full-auto")
	}
	if opts.DangerouslyBypass {
		args = append(args, "--dangerously-bypass-approvals-and-sandbox")
	}
	if v := strings.TrimSpace(opts.CD); v != "" {
		args = append(args, "--cd", v)
	}
	if opts.Search {
		args = append(args, "--search")
	}
	for _, dir := range opts.AddDirs {
		dir = strings.TrimSpace(dir)
		if dir != "" {
			args = append(args, "--add-dir", dir)
		}
	}
	if opts.NoAltScreen {
		args = append(args, "--no-alt-screen")
	}
	return args
}

func (c *CodexCLI) Run(ctx context.Context, args []string, stdin io.Reader) (CodexRunResult, error) {
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
	result := CodexRunResult{Args: append([]string(nil), args...), Stdout: stdout.String(), Stderr: stderr.String()}
	if err == nil {
		result.ExitCode = 0
		return result, nil
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		result.ExitCode = exitErr.ExitCode()
		return result, &CodexExecError{Command: strings.Join(append([]string{c.Path}, args...), " "), ExitCode: exitErr.ExitCode(), Stderr: result.Stderr}
	}

	result.ExitCode = -1
	return result, err
}

func (c *CodexCLI) RunJSONL(ctx context.Context, args []string, stdin io.Reader, onEvent func(CodexJSONLEvent)) (CodexRunResult, error) {
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
		return CodexRunResult{}, err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return CodexRunResult{}, err
	}

	if err := cmd.Start(); err != nil {
		return CodexRunResult{}, err
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
			onEvent(CodexJSONLEvent{Raw: line, Value: parsed})
		}
	}()

	go func() {
		defer wg.Done()
		_, _ = io.Copy(&stderrBuf, stderrPipe)
	}()

	waitErr := cmd.Wait()
	wg.Wait()

	result := CodexRunResult{
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
		return result, &CodexExecError{Command: strings.Join(append([]string{c.Path}, args...), " "), ExitCode: exitErr.ExitCode(), Stderr: result.Stderr}
	}
	result.ExitCode = -1
	return result, waitErr
}
