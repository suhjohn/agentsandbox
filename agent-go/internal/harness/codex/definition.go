package codex

import (
	"context"
	"fmt"
	"path/filepath"
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
	args := h.CLI.ExecArgs(CodexExecOptions{
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
		args = h.CLI.ExecResumeArgs(CodexResumeOptions{
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

	_, err := h.CLI.RunJSONL(ctx, args, nil, func(evt CodexJSONLEvent) {
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
