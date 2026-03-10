package opencode

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"agent-go/internal/apierr"
	"agent-go/internal/harness/registry"
)

type Harness struct {
	CLI *OpencodeCLI
}

func NewHarness(cli *OpencodeCLI) *Harness {
	return &Harness{CLI: cli}
}

func (h *Harness) ID() string { return "opencode" }

func (h *Harness) NormalizeModelSelection(rawModel, rawEffort *string) (*string, *string, error) {
	return normalizeModelSelection(rawModel, rawEffort, true)
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
	return normalizeModelSelection(rawModel, rawEffort, false)
}

func (h *Harness) PrepareStartRun(req registry.StartRunRequest) (registry.StartRunPreparation, error) {
	return registry.StartRunPreparation{
		ResponseFields: map[string]any{},
	}, nil
}

func (h *Harness) Execute(ctx context.Context, req registry.ExecuteRequest) (registry.RunResult, error) {
	if h == nil || h.CLI == nil {
		return registry.RunResult{}, errors.New("opencode CLI is not configured")
	}

	prompt := registry.PromptFromInputs(req.Input)
	sessionRoot := sessionRuntimeDir(req.RuntimeDir, req.Session.ID)
	configPath := filepath.Join(sessionRoot, "xdg", "opencode", ".opencode.json")
	dataDir := filepath.Join(sessionRoot, "data")
	if err := ensureSessionConfig(configPath, dataDir, runtimeContextPath(req.RuntimeDir), req.Session.Model, req.Session.ModelReasoningEffort); err != nil {
		return registry.RunResult{}, err
	}

	cli := *h.CLI
	cli.Env = append(append([]string(nil), h.CLI.Env...), "XDG_CONFIG_HOME="+filepath.Join(sessionRoot, "xdg"))

	res, err := cli.Run(ctx, cli.Args(OpencodeOptions{
		CWD:          strings.TrimSpace(req.DefaultWorkingDir),
		Prompt:       prompt,
		OutputFormat: "json",
		Quiet:        true,
	}), nil)
	if err != nil {
		return registry.RunResult{}, err
	}

	text := parseResponseText(res.Stdout)
	if req.EmitEvent != nil && text != "" {
		req.EmitEvent(map[string]any{
			"type": "message_end",
			"message": map[string]any{
				"role":    "assistant",
				"content": text,
			},
		})
	}

	return registry.RunResult{Text: text}, nil
}

func (h *Harness) SetupRuntime(ctx registry.SetupContext) error {
	runtimeDir := strings.TrimSpace(ctx.RuntimeContext.RuntimeDir)
	if runtimeDir == "" {
		return nil
	}
	_, err := registry.EnsureManagedContextFile(registry.ManagedFileSpec{
		Harness: h.ID(),
		Path:    runtimeContextPath(runtimeDir),
		Version: 1,
		Content: renderOpenCodeContext(ctx.RuntimeContext),
	})
	return err
}

type configFile struct {
	Data         configData             `json:"data"`
	ContextPaths []string               `json:"contextPaths,omitempty"`
	Agents       map[string]configAgent `json:"agents,omitempty"`
}

type configData struct {
	Directory string `json:"directory"`
}

type configAgent struct {
	Model           string `json:"model,omitempty"`
	ReasoningEffort string `json:"reasoningEffort,omitempty"`
}

func ensureSessionConfig(path, dataDir, contextPath string, model, effort *string) error {
	cfg := configFile{
		Data: configData{
			Directory: strings.TrimSpace(dataDir),
		},
		ContextPaths: appendContextPath(contextPath),
	}
	if modelValue, effortValue := strings.TrimSpace(ptrValue(model)), strings.TrimSpace(ptrValue(effort)); modelValue != "" || effortValue != "" {
		cfg.Agents = make(map[string]configAgent, len(opencodeAgentNames))
		for _, name := range opencodeAgentNames {
			cfg.Agents[name] = configAgent{
				Model:           modelValue,
				ReasoningEffort: effortValue,
			}
		}
	}

	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return writeFileAtomically(path, raw, 0o600)
}

func appendContextPath(path string) []string {
	out := make([]string, 0, len(defaultContextPaths)+1)
	if trimmed := strings.TrimSpace(path); trimmed != "" {
		out = append(out, trimmed)
	}
	out = append(out, defaultContextPaths...)
	return out
}

func renderOpenCodeContext(ctx registry.RuntimeContext) string {
	var content strings.Builder
	content.WriteString("# Environment\n")
	content.WriteString("- You are OpenCode running inside a sandbox container.\n")
	content.WriteString("- Runtime state root: " + strings.TrimSpace(ctx.RootDir) + "\n")
	content.WriteString("- Home/workspace root: " + strings.TrimSpace(ctx.AgentHome) + "\n")
	content.WriteString("- Agent identity: AGENT_ID=" + strings.TrimSpace(ctx.AgentID) + "\n")
	content.WriteString("- Runtime directory: " + strings.TrimSpace(ctx.RuntimeDir) + "\n")
	if workingDir := strings.TrimSpace(ctx.DefaultWorkingDir); workingDir != "" {
		content.WriteString("- Default working directory: " + workingDir + "\n")
	}
	if display := strings.TrimSpace(ctx.Display); display != "" {
		content.WriteString("- Chromium is already running under Xvfb on display " + display + " at " + strings.TrimSpace(ctx.ScreenWidth) + "x" + strings.TrimSpace(ctx.ScreenHeight) + "x" + strings.TrimSpace(ctx.ScreenDepth) + ".\n")
	}
	if addr, port := strings.TrimSpace(ctx.ChromiumRemoteDebugAddress), strings.TrimSpace(ctx.ChromiumRemoteDebugPort); addr != "" && port != "" {
		content.WriteString("- Remote debugging is enabled at " + addr + ":" + port + " unless CHROMIUM_FLAGS overrides it.\n")
	}
	if vncPort, noVNCPort := strings.TrimSpace(ctx.VNCPort), strings.TrimSpace(ctx.NoVNCPort); vncPort != "" && noVNCPort != "" {
		content.WriteString("- VNC server: 127.0.0.1:" + vncPort + "; noVNC: 0.0.0.0:" + noVNCPort + ".\n")
	}
	if profileDir := strings.TrimSpace(ctx.ChromiumUserDataDir); profileDir != "" {
		content.WriteString("- Browser profile directory: " + profileDir + ".\n")
	}
	content.WriteString("- Prefer reusing the existing browser rather than launching a new one.\n")
	content.WriteString("- Non-interactive runs do not support CLI-level session resume or event streaming; each prompt should be treated as a fresh run.\n")
	content.WriteString("\n# Tools (Workspace)\n")
	if toolsDir := strings.TrimSpace(ctx.ToolsDir); toolsDir != "" {
		content.WriteString("- Tools are synced from /app/tools into: " + toolsDir + "\n")
	}
	content.WriteString("- Each tool directory should contain a README.md describing usage. Read it before invoking the tool.\n")
	if len(ctx.ToolReadmes) > 0 {
		content.WriteString("\n## Tool READMEs\n")
		for _, path := range ctx.ToolReadmes {
			path = strings.TrimSpace(path)
			if path == "" {
				continue
			}
			content.WriteString("- " + path + "\n")
		}
	}
	return content.String()
}

func normalizeModelSelection(rawModel, rawEffort *string, strict bool) (*string, *string, error) {
	model, inlineEffort, modelProvided, err := normalizeModelInput(rawModel)
	if err != nil {
		if strict {
			return nil, nil, err
		}
		model = nil
		inlineEffort = nil
		modelProvided = false
	}

	explicitProvided, explicitEffort, err := normalizeEffortInput(rawEffort)
	if err != nil {
		return nil, nil, err
	}

	effort, err := mergeEfforts(inlineEffort, explicitProvided, explicitEffort)
	if err != nil {
		return nil, nil, err
	}
	if !modelProvided {
		return nil, effort, nil
	}
	return model, effort, nil
}

func normalizeModelInput(rawModel *string) (*string, *string, bool, error) {
	if rawModel == nil {
		return nil, nil, false, nil
	}
	trimmed := strings.TrimSpace(*rawModel)
	if trimmed == "" {
		return nil, nil, false, nil
	}

	modelPart := trimmed
	var inlineEffort *string
	if idx := strings.LastIndex(trimmed, ":"); idx > 0 {
		suffix := strings.ToLower(strings.TrimSpace(trimmed[idx+1:]))
		if isValidReasoningEffort(suffix) {
			modelPart = strings.TrimSpace(trimmed[:idx])
			inlineEffort = registry.StringPtr(suffix)
		}
	}

	canonical, ok := canonicalizeModel(modelPart)
	if !ok {
		return nil, nil, false, apierr.Fail(400, fmt.Sprintf("Unknown model %q for harness opencode", trimmed))
	}
	return registry.StringPtr(canonical), inlineEffort, true, nil
}

func normalizeEffortInput(rawEffort *string) (bool, *string, error) {
	if rawEffort == nil {
		return false, nil, nil
	}
	trimmed := strings.ToLower(strings.TrimSpace(*rawEffort))
	if trimmed == "" {
		return true, nil, nil
	}
	if !isValidReasoningEffort(trimmed) {
		return false, nil, apierr.Fail(400, "Invalid modelReasoningEffort")
	}
	return true, registry.StringPtr(trimmed), nil
}

func mergeEfforts(inline *string, explicitProvided bool, explicit *string) (*string, error) {
	if inline == nil && !explicitProvided {
		return nil, nil
	}
	if inline != nil && explicitProvided {
		if explicit == nil || !strings.EqualFold(strings.TrimSpace(*inline), strings.TrimSpace(*explicit)) {
			return nil, apierr.Fail(400, "Conflicting modelReasoningEffort")
		}
		return explicit, nil
	}
	if explicitProvided {
		return explicit, nil
	}
	return inline, nil
}

func canonicalizeModel(raw string) (string, bool) {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" {
		return "", false
	}
	if _, ok := supportedModels[trimmed]; ok {
		return trimmed, true
	}

	slash := strings.Index(trimmed, "/")
	if slash < 0 {
		return "", false
	}
	provider := strings.TrimSpace(trimmed[:slash])
	id := strings.TrimSpace(trimmed[slash+1:])
	if provider == "" || id == "" {
		return "", false
	}

	var candidate string
	switch provider {
	case "openai", "anthropic", "google", "groq", "xai":
		candidate = id
	case "github-copilot", "copilot":
		candidate = "copilot." + id
	case "openrouter":
		candidate = "openrouter." + id
	case "azure":
		candidate = "azure." + id
	case "vertexai", "vertex-ai":
		candidate = "vertexai." + id
	case "bedrock":
		candidate = "bedrock." + id
	default:
		return "", false
	}

	if _, ok := supportedModels[candidate]; !ok {
		return "", false
	}
	return candidate, true
}

func parseResponseText(stdout string) string {
	trimmed := strings.TrimSpace(stdout)
	if trimmed == "" {
		return ""
	}
	var payload struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal([]byte(trimmed), &payload); err == nil {
		return strings.TrimSpace(payload.Response)
	}
	return trimmed
}

func writeFileAtomically(path string, content []byte, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(content); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := os.Chmod(tmpPath, perm); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

func runtimeContextPath(runtimeDir string) string {
	return filepath.Join(strings.TrimSpace(runtimeDir), "opencode", "OpenCode.md")
}

func sessionRuntimeDir(runtimeDir, sessionID string) string {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		sessionID = "adhoc"
	}
	return filepath.Join(strings.TrimSpace(runtimeDir), "opencode", "sessions", sessionID)
}

func ptrValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func isValidReasoningEffort(value string) bool {
	switch value {
	case "low", "medium", "high":
		return true
	default:
		return false
	}
}

var opencodeAgentNames = []string{"coder", "summarizer", "task", "title"}

var defaultContextPaths = []string{
	".github/copilot-instructions.md",
	".cursorrules",
	".cursor/rules/",
	"CLAUDE.md",
	"CLAUDE.local.md",
	"opencode.md",
	"opencode.local.md",
	"OpenCode.md",
	"OpenCode.local.md",
	"OPENCODE.md",
	"OPENCODE.local.md",
}

var supportedModels = map[string]struct{}{
	"azure.gpt-4.1":                     {},
	"azure.gpt-4.1-mini":                {},
	"azure.gpt-4.1-nano":                {},
	"azure.gpt-4.5-preview":             {},
	"azure.gpt-4o":                      {},
	"azure.gpt-4o-mini":                 {},
	"azure.o1":                          {},
	"azure.o1-mini":                     {},
	"azure.o3":                          {},
	"azure.o3-mini":                     {},
	"azure.o4-mini":                     {},
	"bedrock.claude-3.7-sonnet":         {},
	"claude-3-haiku":                    {},
	"claude-3-opus":                     {},
	"claude-3.5-haiku":                  {},
	"claude-3.5-sonnet":                 {},
	"claude-3.7-sonnet":                 {},
	"claude-4-opus":                     {},
	"claude-4-sonnet":                   {},
	"copilot.claude-3.5-sonnet":         {},
	"copilot.claude-3.7-sonnet":         {},
	"copilot.claude-3.7-sonnet-thought": {},
	"copilot.claude-sonnet-4":           {},
	"copilot.gemini-2.0-flash":          {},
	"copilot.gemini-2.5-pro":            {},
	"copilot.gpt-3.5-turbo":             {},
	"copilot.gpt-4":                     {},
	"copilot.gpt-4.1":                   {},
	"copilot.gpt-4o":                    {},
	"copilot.gpt-4o-mini":               {},
	"copilot.o1":                        {},
	"copilot.o3-mini":                   {},
	"copilot.o4-mini":                   {},
	"deepseek-r1-distill-llama-70b":     {},
	"gemini-2.0-flash":                  {},
	"gemini-2.0-flash-lite":             {},
	"gemini-2.5":                        {},
	"gemini-2.5-flash":                  {},
	"gpt-4.1":                           {},
	"gpt-4.1-mini":                      {},
	"gpt-4.1-nano":                      {},
	"gpt-4.5-preview":                   {},
	"gpt-4o":                            {},
	"gpt-4o-mini":                       {},
	"grok-3-beta":                       {},
	"grok-3-fast-beta":                  {},
	"grok-3-mini-beta":                  {},
	"grok-3-mini-fast-beta":             {},
	"llama-3.3-70b-versatile":           {},
	"meta-llama/llama-4-maverick-17b-128e-instruct": {},
	"meta-llama/llama-4-scout-17b-16e-instruct":     {},
	"o1":                           {},
	"o1-mini":                      {},
	"o1-pro":                       {},
	"o3":                           {},
	"o3-mini":                      {},
	"o4-mini":                      {},
	"openrouter.claude-3-haiku":    {},
	"openrouter.claude-3-opus":     {},
	"openrouter.claude-3.5-haiku":  {},
	"openrouter.claude-3.5-sonnet": {},
	"openrouter.claude-3.7-sonnet": {},
	"openrouter.deepseek-r1-free":  {},
	"openrouter.gemini-2.5":        {},
	"openrouter.gemini-2.5-flash":  {},
	"openrouter.gpt-4.1":           {},
	"openrouter.gpt-4.1-mini":      {},
	"openrouter.gpt-4.1-nano":      {},
	"openrouter.gpt-4.5-preview":   {},
	"openrouter.gpt-4o":            {},
	"openrouter.gpt-4o-mini":       {},
	"openrouter.o1":                {},
	"openrouter.o1-mini":           {},
	"openrouter.o1-pro":            {},
	"openrouter.o3":                {},
	"openrouter.o3-mini":           {},
	"openrouter.o4-mini":           {},
	"qwen-qwq":                     {},
	"vertexai.gemini-2.5":          {},
	"vertexai.gemini-2.5-flash":    {},
}
