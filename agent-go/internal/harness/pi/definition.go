package pi

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"agent-go/internal/harness/registry"
	"agent-go/internal/modelcatalog"
)

type Harness struct {
	CLI *PiCLI
}

const bundledClientToolsExtensionRelativeDir = ".pi/extensions/client_tools"

func NewHarness(cli *PiCLI) *Harness {
	return &Harness{CLI: cli}
}

func (h *Harness) ID() string { return "pi" }

func (h *Harness) NormalizeModelSelection(rawModel, rawEffort *string) (*string, *string, error) {
	return registry.NormalizeModelSelection(rawModel, rawEffort, h.resolveModelPattern, isValidReasoningEffort)
}

func (h *Harness) ResolveDefaults(defaultModel, defaultEffort string) (*string, *string, error) {
	var rawModel *string
	if trimmed := strings.TrimSpace(defaultModel); trimmed != "" {
		if !strings.Contains(trimmed, "/") {
			trimmed = "openai/" + trimmed
		}
		rawModel = registry.StringPtr(trimmed)
	}
	var rawEffort *string
	if trimmed := strings.TrimSpace(defaultEffort); trimmed != "" {
		rawEffort = registry.StringPtr(trimmed)
	}
	return h.NormalizeModelSelection(rawModel, rawEffort)
}

func (h *Harness) PrepareStartRun(req registry.StartRunRequest) (registry.StartRunPreparation, error) {
	sessionFile := ""
	if req.Session.ExternalSessionID != nil {
		sessionFile = strings.TrimSpace(*req.Session.ExternalSessionID)
	}
	if sessionFile == "" {
		sessionFile = DefaultSessionFile(req.RuntimeDir, req.Session.ID)
	}
	return registry.StartRunPreparation{
		ExternalSessionID: registry.StringPtr(sessionFile),
		ResponseFields: map[string]any{
			"sessionFile": sessionFile,
		},
	}, nil
}

func (h *Harness) Execute(ctx context.Context, req registry.ExecuteRequest) (registry.RunResult, error) {
	cli := h.CLI
	if cli == nil {
		cli = NewPiCLI()
	}
	runCLI := *cli
	runCLI.Env = append([]string(nil), cli.Env...)
	if runID := strings.TrimSpace(req.RunID); runID != "" {
		runCLI.Env = append(runCLI.Env, "AGENT_GO_CLIENT_TOOL_RUN_ID="+runID)
	}

	prompt := registry.PromptFromInputs(req.Input)
	sessionFile := ""
	if req.Session.ExternalSessionID != nil {
		sessionFile = strings.TrimSpace(*req.Session.ExternalSessionID)
	}
	if sessionFile == "" {
		sessionFile = DefaultSessionFile(req.RuntimeDir, req.Session.ID)
		if req.PersistExternalSessionID != nil {
			req.PersistExternalSessionID(sessionFile)
		}
	}

	if err := os.MkdirAll(filepath.Dir(sessionFile), 0o755); err != nil {
		return registry.RunResult{}, err
	}

	opts := PiOptions{
		Mode:       "rpc",
		Session:    sessionFile,
		SessionDir: filepath.Dir(sessionFile),
	}
	if req.Session.Model != nil {
		opts.Model = strings.TrimSpace(*req.Session.Model)
	}
	if req.Session.ModelReasoningEffort != nil {
		opts.Thinking = strings.TrimSpace(*req.Session.ModelReasoningEffort)
	}
	stdinPayload, err := EncodePiRPCCommand(PiRPCPrompt("", prompt, nil, ""))
	if err != nil {
		return registry.RunResult{}, err
	}

	var textBuilder strings.Builder
	_, err = runCLI.RunJSONL(ctx, runCLI.Args(opts), bytes.NewReader(stdinPayload), func(evt PiJSONLEvent) {
		if req.EmitEvent != nil {
			if compact, ok := compactEventForStream(evt.Value); ok {
				req.EmitEvent(compact)
			}
		}

		typeValue, _ := evt.Value["type"].(string)
		if typeValue != "message_update" {
			if typeValue == "message_end" && textBuilder.Len() == 0 {
				message, _ := evt.Value["message"].(map[string]any)
				if text := assistantTextFromMessage(message); text != "" {
					textBuilder.WriteString(text)
				}
			}
			return
		}
		assistant, _ := evt.Value["assistantMessageEvent"].(map[string]any)
		if assistant == nil {
			return
		}
		eventType, _ := assistant["type"].(string)
		if eventType != "text_delta" && eventType != "text" {
			return
		}
		if delta, ok := assistant["delta"].(string); ok {
			textBuilder.WriteString(delta)
			return
		}
		if text, ok := assistant["text"].(string); ok {
			textBuilder.WriteString(text)
		}
	})
	if err != nil {
		return registry.RunResult{}, err
	}
	return registry.RunResult{
		ExternalSessionID: sessionFile,
		Text:              strings.TrimSpace(textBuilder.String()),
	}, nil
}

func (h *Harness) SetupRuntime(ctx registry.SetupContext) error {
	runtimeCtx := ctx.RuntimeContext
	if strings.TrimSpace(runtimeCtx.PIDir) == "" {
		return nil
	}
	_, err := registry.EnsureManagedContextFile(registry.ManagedFileSpec{
		Harness: h.ID(),
		Path:    filepath.Join(runtimeCtx.PIDir, "AGENTS.md"),
		Version: 2,
		Content: registry.RenderAgentsMD(runtimeCtx, h.ID()),
	})
	if err != nil {
		return err
	}
	return installBundledClientToolsExtension(runtimeCtx.PIDir)
}

func (h *Harness) resolveModelPattern(pattern string) (string, *string, error) {
	return registry.ResolveCatalogModelPattern(pattern, modelcatalog.All(), h.ID(), func(def modelcatalog.ModelDef) string {
		return def.Provider + "/" + def.ID
	}, isValidReasoningEffort)
}

func isValidReasoningEffort(value string) bool {
	switch value {
	case "off", "minimal", "low", "medium", "high", "xhigh":
		return true
	default:
		return false
	}
}

func compactEventForStream(value map[string]any) (map[string]any, bool) {
	if len(value) == 0 {
		return nil, false
	}
	typeValue := strings.TrimSpace(firstNonEmptyString(value["type"]))
	switch typeValue {
	case "turn_start", "turn_end", "agent_start", "agent_end":
		return map[string]any{"type": typeValue}, true
	case "error":
		message := strings.TrimSpace(firstNonEmptyString(value["message"], value["error"]))
		if message == "" {
			message = "Unknown error"
		}
		return map[string]any{
			"type":    "error",
			"message": message,
		}, true
	case "tool_execution_end":
		out := map[string]any{"type": "tool_execution_end"}
		if toolCallId := strings.TrimSpace(firstNonEmptyString(value["toolCallId"])); toolCallId != "" {
			out["toolCallId"] = toolCallId
		}
		if toolName := strings.TrimSpace(firstNonEmptyString(value["toolName"])); toolName != "" {
			out["toolName"] = toolName
		}
		if result, ok := value["result"]; ok {
			out["result"] = result
		}
		return out, true
	case "message_end":
		message, _ := value["message"].(map[string]any)
		compact := compactMessage(message)
		if compact == nil {
			return nil, false
		}
		return map[string]any{
			"type":    "message_end",
			"message": compact,
		}, true
	default:
		return nil, false
	}
}

func compactMessage(message map[string]any) map[string]any {
	if len(message) == 0 {
		return nil
	}
	role := strings.TrimSpace(firstNonEmptyString(message["role"]))
	if role == "" {
		return nil
	}
	out := map[string]any{"role": role}
	if id := strings.TrimSpace(firstNonEmptyString(message["id"])); id != "" {
		out["id"] = id
	}

	switch role {
	case "bashExecution":
		if command := firstNonEmptyString(message["command"]); command != "" {
			out["command"] = command
		}
		if output := firstNonEmptyString(message["output"]); output != "" {
			out["output"] = output
		}
		if exitCode, ok := message["exitCode"]; ok {
			out["exitCode"] = exitCode
		}
		return out
	case "toolResult":
		if toolName := strings.TrimSpace(firstNonEmptyString(message["toolName"])); toolName != "" {
			out["toolName"] = toolName
		}
		if details, ok := message["details"]; ok {
			out["details"] = details
		}
	case "custom":
		if customType := strings.TrimSpace(firstNonEmptyString(message["customType"])); customType != "" {
			out["customType"] = customType
		}
	}
	if usage, ok := message["usage"].(map[string]any); ok && len(usage) > 0 {
		out["usage"] = usage
	}

	if content := compactMessageContent(message["content"]); len(content) > 0 {
		out["content"] = content
		return out
	}
	if text := strings.TrimSpace(firstNonEmptyString(message["text"])); text != "" {
		out["content"] = []map[string]any{{"type": "text", "text": text}}
		return out
	}
	return out
}

func compactMessageContent(content any) []map[string]any {
	switch typed := content.(type) {
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return nil
		}
		return []map[string]any{{"type": "text", "text": text}}
	case []any:
		out := make([]map[string]any, 0, len(typed))
		for _, rawItem := range typed {
			item, _ := rawItem.(map[string]any)
			if len(item) == 0 {
				continue
			}
			itemType, _ := item["type"].(string)
			switch itemType {
			case "text":
				text, _ := item["text"].(string)
				text = strings.TrimSpace(text)
				if text == "" {
					continue
				}
				out = append(out, map[string]any{
					"type": "text",
					"text": text,
				})
			case "toolCall":
				next := map[string]any{"type": "toolCall"}
				if id := strings.TrimSpace(firstNonEmptyString(item["id"])); id != "" {
					next["id"] = id
				}
				if name := strings.TrimSpace(firstNonEmptyString(item["name"])); name != "" {
					next["name"] = name
				}
				if args, ok := item["arguments"]; ok {
					next["arguments"] = args
				}
				out = append(out, next)
			case "image":
				next := map[string]any{"type": "image"}
				if mimeType := strings.TrimSpace(firstNonEmptyString(item["mimeType"])); mimeType != "" {
					next["mimeType"] = mimeType
				}
				out = append(out, next)
			}
		}
		if len(out) == 0 {
			return nil
		}
		return out
	default:
		return nil
	}
}

func assistantTextFromMessage(message map[string]any) string {
	if len(message) == 0 {
		return ""
	}
	role := strings.TrimSpace(firstNonEmptyString(message["role"]))
	if role != "assistant" {
		return ""
	}
	if text := strings.TrimSpace(firstNonEmptyString(message["text"])); text != "" {
		return text
	}
	contentString, _ := message["content"].(string)
	if trimmed := strings.TrimSpace(contentString); trimmed != "" {
		return trimmed
	}
	content, _ := message["content"].([]any)
	var textBuilder strings.Builder
	for _, rawItem := range content {
		item, _ := rawItem.(map[string]any)
		if len(item) == 0 {
			continue
		}
		itemType, _ := item["type"].(string)
		if itemType != "text" {
			continue
		}
		text, _ := item["text"].(string)
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		if textBuilder.Len() > 0 {
			textBuilder.WriteByte('\n')
		}
		textBuilder.WriteString(text)
	}
	return strings.TrimSpace(textBuilder.String())
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

func DefaultSessionFile(runtimeDir, sessionID string) string {
	base := filepath.Join(runtimeDir, "runtime", "pi-sessions")
	return filepath.Join(base, sessionID+".jsonl")
}

func installBundledClientToolsExtension(piDir string) error {
	sourceDir := bundledClientToolsSourceDir()
	if sourceDir == "" {
		return nil
	}
	destDir := filepath.Join(strings.TrimSpace(piDir), "agent", "extensions", "client_tools")
	for _, name := range []string{"index.ts", "package.json"} {
		sourcePath := filepath.Join(sourceDir, name)
		destPath := filepath.Join(destDir, name)
		if err := copyBundledExtensionFile(sourcePath, destPath); err != nil {
			return err
		}
	}
	return nil
}

func bundledClientToolsSourceDir() string {
	repoDir := strings.TrimSpace(os.Getenv("AGENT_GO_REPO_DIR"))
	if repoDir == "" {
		return ""
	}
	sourceDir := filepath.Join(repoDir, bundledClientToolsExtensionRelativeDir)
	info, err := os.Stat(sourceDir)
	if err != nil || !info.IsDir() {
		return ""
	}
	return sourceDir
}

func copyBundledExtensionFile(sourcePath, destPath string) error {
	content, err := os.ReadFile(sourcePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read bundled PI extension %s: %w", sourcePath, err)
	}
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return err
	}
	current, err := os.ReadFile(destPath)
	if err == nil && bytes.Equal(current, content) {
		return nil
	}
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.WriteFile(destPath, content, 0o644)
}
