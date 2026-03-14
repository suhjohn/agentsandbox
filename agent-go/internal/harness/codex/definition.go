package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"agent-go/internal/harness/registry"
	"agent-go/internal/modelcatalog"
)

type Harness struct {
	CLI *CodexCLI
}

func NewHarness(cli *CodexCLI) *Harness {
	return &Harness{CLI: cli}
}

func (h *Harness) ID() string { return "codex" }

func (h *Harness) NormalizeModelSelection(rawModel, rawEffort *string) (*string, *string, error) {
	return registry.NormalizeModelSelection(rawModel, rawEffort, h.resolveModelPattern, registry.IsValidStandardReasoningEffort)
}

func (h *Harness) ResolveDefaults(defaultModel, defaultEffort string) (*string, *string, error) {
	var rawModel *string
	if trimmed := strings.TrimSpace(defaultModel); trimmed != "" {
		rawModel = registry.StringPtr(trimmed)
	}
	var rawEffort *string
	if trimmed := strings.TrimSpace(defaultEffort); trimmed != "" {
		rawEffort = registry.StringPtr(trimmed)
	}
	return h.NormalizeModelSelection(rawModel, rawEffort)
}

func (h *Harness) PrepareStartRun(req registry.StartRunRequest) (registry.StartRunPreparation, error) {
	out := registry.StartRunPreparation{
		ResponseFields: map[string]any{},
	}
	if req.Session.ExternalSessionID != nil {
		if threadID := strings.TrimSpace(*req.Session.ExternalSessionID); threadID != "" {
			out.ResponseFields["threadId"] = threadID
		}
	}
	return out, nil
}

func (h *Harness) Execute(ctx context.Context, req registry.ExecuteRequest) (registry.RunResult, error) {
	cli := h.CLI
	if cli == nil {
		cli = NewCodexCLI()
	}
	runCLI := *cli
	runCLI.Env = append([]string(nil), cli.Env...)
	if strings.TrimSpace(req.RunID) != "" {
		runCLI.Env = append(runCLI.Env, "AGENT_GO_CLIENT_TOOL_RUN_ID="+strings.TrimSpace(req.RunID))
	}

	prompt := registry.PromptFromInputs(req.Input)
	model := ""
	if req.Session.Model != nil && strings.TrimSpace(*req.Session.Model) != "" {
		model = strings.TrimSpace(*req.Session.Model)
	}

	config := []string{}
	if req.Session.ModelReasoningEffort != nil && strings.TrimSpace(*req.Session.ModelReasoningEffort) != "" {
		config = append(config, fmt.Sprintf("model_reasoning_effort=%q", strings.TrimSpace(*req.Session.ModelReasoningEffort)))
	}

	resumeSessionID := ""
	if req.Session.ExternalSessionID != nil {
		resumeSessionID = strings.TrimSpace(*req.Session.ExternalSessionID)
	}
	seenExternalSessionID := ""

	resultText := strings.Builder{}
	args := runCLI.ExecArgs(CodexExecOptions{
		CodexRootOptions: CodexRootOptions{
			CodexGlobalOptions: CodexGlobalOptions{Config: config},
			Prompt:             prompt,
			Model:              model,
			Sandbox:            "danger-full-access",
			DangerouslyBypass:  true,
			CD:                 req.DefaultWorkingDir,
		},
		SkipGitRepoCheck: true,
		JSON:             true,
	})
	if resumeSessionID != "" {
		args = runCLI.ExecResumeArgs(CodexResumeOptions{
			CodexGlobalOptions: CodexGlobalOptions{Config: config},
		})
		if model != "" {
			args = append(args, "--model", model)
		}
		args = append(
			args,
			"--dangerously-bypass-approvals-and-sandbox",
			"--skip-git-repo-check",
			"--json",
			resumeSessionID,
		)
		if promptText := strings.TrimSpace(prompt); promptText != "" {
			args = append(args, promptText)
		}
	}

	_, err := runCLI.RunJSONL(ctx, args, nil, func(evt CodexJSONLEvent) {
		if id := externalSessionIDFromEvent(evt.Value); id != "" {
			seenExternalSessionID = id
			if req.PersistExternalSessionID != nil {
				req.PersistExternalSessionID(id)
			}
		}
		if req.EmitEvent != nil {
			req.EmitEvent(evt.Value)
		}

		typeValue, _ := evt.Value["type"].(string)
		if typeValue == "item.completed" {
			item, _ := evt.Value["item"].(map[string]any)
			itemType, _ := item["type"].(string)
			if itemType == "agent_message" {
				if text := firstNonEmptyString(item["text"], item["output_text"]); text != "" {
					if resultText.Len() > 0 {
						resultText.WriteByte('\n')
					}
					resultText.WriteString(text)
				}
			}
		}
		if typeValue == "message_end" {
			if message, ok := evt.Value["message"].(map[string]any); ok {
				if role, _ := message["role"].(string); role == "assistant" {
					if text := firstNonEmptyString(message["content"], message["text"]); text != "" {
						if resultText.Len() > 0 {
							resultText.WriteByte('\n')
						}
						resultText.WriteString(text)
					}
				}
			}
		}
	})
	if err != nil {
		return registry.RunResult{}, err
	}
	return registry.RunResult{
		ExternalSessionID: strings.TrimSpace(seenExternalSessionID),
		Text:              strings.TrimSpace(resultText.String()),
	}, nil
}

func (h *Harness) SetupRuntime(ctx registry.SetupContext) error {
	runtimeCtx := ctx.RuntimeContext
	if codexHome := strings.TrimSpace(runtimeCtx.CodexHome); codexHome != "" {
		if _, err := registry.EnsureManagedContextFile(registry.ManagedFileSpec{
			Harness: h.ID(),
			Path:    filepath.Join(codexHome, "AGENTS.md"),
			Version: 2,
			Content: registry.RenderAgentsMD(runtimeCtx, h.ID()),
		}); err != nil {
			return err
		}
	}
	if err := ensureClientToolMCPConfig(runtimeCtx); err != nil {
		return err
	}
	return ensureAuthJSON(runtimeCtx.CodexHome, ctx.OpenAIAPIKey)
}

const (
	managedMCPConfigStart = "# agent-go:managed:start client-tool-mcp"
	managedMCPConfigEnd   = "# agent-go:managed:end client-tool-mcp"
)

func ensureClientToolMCPConfig(runtimeCtx registry.RuntimeContext) error {
	codexHome := strings.TrimSpace(runtimeCtx.CodexHome)
	if codexHome == "" {
		return nil
	}
	binaryPath := strings.TrimSpace(runtimeCtx.AgentGoBinaryPath)
	baseURL := strings.TrimSpace(runtimeCtx.AgentGoBaseURL)
	token := strings.TrimSpace(runtimeCtx.AgentGoInternalToken)
	if binaryPath == "" || baseURL == "" || token == "" {
		return nil
	}

	configPath := filepath.Join(codexHome, "config.toml")
	managedBlock := strings.Join([]string{
		managedMCPConfigStart,
		"[mcp_servers.agent_go_client_tools]",
		"command = " + strconv.Quote(binaryPath),
		`args = ["client-tool-mcp"]`,
		"",
		"[mcp_servers.agent_go_client_tools.env]",
		"AGENT_GO_INTERNAL_BASE_URL = " + strconv.Quote(baseURL),
		"AGENT_GO_INTERNAL_TOKEN = " + strconv.Quote(token),
		managedMCPConfigEnd,
		"",
	}, "\n")

	existingRaw, err := os.ReadFile(configPath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	existing := strings.TrimRight(string(existingRaw), "\n")
	start := strings.Index(existing, managedMCPConfigStart)
	end := strings.Index(existing, managedMCPConfigEnd)
	switch {
	case start >= 0 && end > start:
		end += len(managedMCPConfigEnd)
		existing = strings.TrimSpace(existing[:start] + existing[end:])
	case start >= 0 || end >= 0:
		existing = strings.TrimSpace(existing)
	}

	next := managedBlock
	if existing != "" {
		next = existing + "\n\n" + managedBlock
	}

	if err := os.MkdirAll(codexHome, 0o755); err != nil {
		return err
	}
	return os.WriteFile(configPath, []byte(next), 0o644)
}

func ensureAuthJSON(codexHome, openaiAPIKey string) error {
	codexHome = strings.TrimSpace(codexHome)
	if codexHome == "" {
		return nil
	}
	openaiAPIKey = strings.TrimSpace(openaiAPIKey)
	if openaiAPIKey == "" {
		return nil
	}

	authPath := filepath.Join(codexHome, "auth.json")
	if _, err := os.Stat(authPath); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}

	if err := os.MkdirAll(codexHome, 0o755); err != nil {
		return err
	}
	raw, err := json.Marshal(map[string]string{
		"auth_mode":      "apikey",
		"OPENAI_API_KEY": openaiAPIKey,
	})
	if err != nil {
		return err
	}

	tmp, err := os.CreateTemp(codexHome, ".auth-*.json")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(append(raw, '\n')); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := os.Chmod(tmpPath, 0o600); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, authPath); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

func (h *Harness) resolveModelPattern(pattern string) (string, *string, error) {
	return registry.ResolveCatalogModelPattern(pattern, modelcatalog.OpenAI(), h.ID(), func(def modelcatalog.ModelDef) string {
		return def.ID
	}, registry.IsValidStandardReasoningEffort)
}

func firstNonEmptyString(values ...any) string {
	for _, v := range values {
		switch t := v.(type) {
		case string:
			if trimmed := strings.TrimSpace(t); trimmed != "" {
				return trimmed
			}
		case []any:
			buf := strings.Builder{}
			for _, item := range t {
				if s := firstNonEmptyString(item); s != "" {
					if buf.Len() > 0 {
						buf.WriteByte('\n')
					}
					buf.WriteString(s)
				}
			}
			if buf.Len() > 0 {
				return buf.String()
			}
		case map[string]any:
			if s := firstNonEmptyString(t["text"], t["content"], t["output_text"]); s != "" {
				return s
			}
		}
	}
	return ""
}

func externalSessionIDFromEvent(value map[string]any) string {
	return firstNonEmptyString(
		value["thread_id"],
		value["threadId"],
		value["session_id"],
		value["sessionId"],
		value["conversation_id"],
		value["conversationId"],
	)
}

func DefaultSessionFile(runtimeDir, sessionID string) string {
	base := filepath.Join(runtimeDir, "runtime", "codex-sessions")
	return filepath.Join(base, sessionID+".jsonl")
}
