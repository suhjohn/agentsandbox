package codex

import (
	"strings"
	"testing"
)

func TestCodexExecArgs(t *testing.T) {
	cli := NewCodexCLI()
	args := cli.ExecArgs(CodexExecOptions{
		CodexRootOptions: CodexRootOptions{
			CodexGlobalOptions: CodexGlobalOptions{
				Config:  []string{"model_reasoning_effort=\"high\""},
				Enable:  []string{"unified_exec"},
				Disable: []string{"legacy_mode"},
			},
			Prompt:         "fix tests",
			Model:          "gpt-5.2",
			Sandbox:        "danger-full-access",
			ApprovalPolicy: "never",
			CD:             "/repo",
			AddDirs:        []string{"/repo2"},
			Search:         true,
		},
		SkipGitRepoCheck:  true,
		JSON:              true,
		Ephemeral:         true,
		OutputSchema:      "schema.json",
		OutputLastMessage: "last.txt",
	})

	joined := strings.Join(args, " ")
	checks := []string{
		"exec",
		"-c model_reasoning_effort=\"high\"",
		"--enable unified_exec",
		"--disable legacy_mode",
		"--model gpt-5.2",
		"--sandbox danger-full-access",
		"--ask-for-approval never",
		"--cd /repo",
		"--search",
		"--add-dir /repo2",
		"--skip-git-repo-check",
		"--ephemeral",
		"--output-schema schema.json",
		"--json",
		"--output-last-message last.txt",
		"fix tests",
	}
	for _, want := range checks {
		if !strings.Contains(joined, want) {
			t.Fatalf("expected %q in args: %v", want, args)
		}
	}
}

func TestCodexCoverageCommands(t *testing.T) {
	cli := NewCodexCLI()
	cases := []struct {
		name string
		args []string
	}{
		{"root", cli.RootArgs(CodexRootOptions{Prompt: "hi"})},
		{"exec-resume", cli.ExecResumeArgs(CodexResumeOptions{Last: true})},
		{"exec-review", cli.ExecReviewArgs(CodexReviewOptions{Prompt: "review"})},
		{"review", cli.ReviewArgs(CodexReviewOptions{Prompt: "review"})},
		{"resume", cli.ResumeArgs(CodexResumeOptions{SessionID: "abc"})},
		{"fork", cli.ResumeArgs(CodexResumeOptions{Fork: true, SessionID: "abc"})},
		{"mcp-list", cli.MCPListArgs(CodexGlobalOptions{})},
		{"mcp-get", cli.MCPGetArgs(CodexMCPGetOptions{Name: "srv"})},
		{"mcp-add", cli.MCPAddArgs(CodexMCPAddOptions{Name: "srv", URL: "http://localhost"})},
		{"mcp-remove", cli.MCPRemoveArgs(CodexMCPRemoveOptions{Name: "srv"})},
		{"mcp-login", cli.MCPLoginArgs(CodexMCPLoginOptions{Name: "srv"})},
		{"mcp-logout", cli.MCPLogoutArgs(CodexMCPLogoutOptions{Name: "srv"})},
		{"mcp-server", cli.MCPServerArgs(CodexGlobalOptions{})},
		{"completion", cli.CompletionArgs(CodexCompletionOptions{Shell: "zsh"})},
		{"sandbox", cli.SandboxArgs(CodexGlobalOptions{}, []string{"bash", "-lc", "true"})},
		{"login", cli.LoginArgs(CodexGlobalOptions{})},
		{"logout", cli.LogoutArgs(CodexGlobalOptions{})},
		{"apply", cli.ApplyArgs(CodexApplyOptions{TaskID: "task"})},
		{"features-list", cli.FeaturesListArgs(CodexGlobalOptions{})},
		{"features-enable", cli.FeaturesEnableArgs(CodexGlobalOptions{}, "unified_exec")},
		{"features-disable", cli.FeaturesDisableArgs(CodexGlobalOptions{}, "unified_exec")},
		{"cloud-exec", cli.CloudExecArgs(CodexCloudExecOptions{EnvID: "env", Query: "do thing"})},
		{"cloud-status", cli.CloudStatusArgs(CodexCloudTaskOptions{TaskID: "task"})},
		{"cloud-list", cli.CloudListArgs(CodexCloudListOptions{Limit: 5})},
		{"cloud-apply", cli.CloudApplyArgs(CodexCloudTaskOptions{TaskID: "task", Attempt: 1})},
		{"cloud-diff", cli.CloudDiffArgs(CodexCloudTaskOptions{TaskID: "task", Attempt: 1})},
		{"app-server", cli.AppServerArgs(CodexAppServerOptions{Listen: "stdio://"})},
		{"app-server-generate-ts", cli.AppServerGenerateTSArgs(CodexGlobalOptions{})},
		{"app-server-generate-json-schema", cli.AppServerGenerateJSONSchemaArgs(CodexGlobalOptions{})},
		{"debug-send-message-v2", cli.DebugAppServerSendMessageV2Args(CodexDebugAppServerSendMessageV2Options{UserMessage: "hi"})},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if len(tc.args) == 0 {
				t.Fatalf("expected non-empty args")
			}
		})
	}
}
