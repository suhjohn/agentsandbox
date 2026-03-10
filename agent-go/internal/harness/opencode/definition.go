package opencode

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"agent-go/internal/harness/registry"
	"agent-go/internal/modelcatalog"
)

var opencodeVariantPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*$`)

const opencodeRunConfigAllowAll = "{\n  \"permission\": \"allow\"\n}\n"

type Harness struct {
	CLI *OpencodeCLI
}

func NewHarness(cli *OpencodeCLI) *Harness {
	return &Harness{CLI: cli}
}

func (h *Harness) ID() string { return "opencode" }

func (h *Harness) NormalizeModelSelection(rawModel, rawEffort *string) (*string, *string, error) {
	return registry.NormalizeModelSelection(rawModel, rawEffort, h.resolveModelPattern, isValidVariant)
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
	out := registry.StartRunPreparation{
		ResponseFields: map[string]any{},
	}
	if req.Session.ExternalSessionID != nil {
		if sessionID := strings.TrimSpace(*req.Session.ExternalSessionID); sessionID != "" {
			out.ResponseFields["sessionId"] = sessionID
		}
	}
	return out, nil
}

func (h *Harness) Execute(ctx context.Context, req registry.ExecuteRequest) (registry.RunResult, error) {
	if h == nil || h.CLI == nil {
		return registry.RunResult{}, errors.New("opencode CLI is not configured")
	}

	prompt, files := splitInputs(req.Input)
	if prompt == "" && len(files) == 0 {
		return registry.RunResult{}, nil
	}

	cli := *h.CLI
	if err := ensureRuntimeConfigFile(req.RuntimeDir); err != nil {
		return registry.RunResult{}, err
	}
	cli.Env = opencodeRunEnv(h.CLI.Env, req.RuntimeDir, req.Session.ID)

	opts := OpencodeRunOptions{
		Format:   "json",
		Dir:      strings.TrimSpace(req.DefaultWorkingDir),
		Thinking: true,
		Messages: []string{prompt},
		Files:    files,
	}
	if req.Session.ExternalSessionID != nil {
		opts.Session = strings.TrimSpace(*req.Session.ExternalSessionID)
	}
	if req.Session.Model != nil {
		opts.Model = strings.TrimSpace(*req.Session.Model)
	}
	if req.Session.ModelReasoningEffort != nil {
		opts.Variant = strings.TrimSpace(*req.Session.ModelReasoningEffort)
	}

	var textBuilder strings.Builder
	seenSessionID := ""

	_, err := cli.RunJSONL(ctx, cli.Args(opts), nil, func(evt OpencodeJSONLEvent) {
		if sessionID := eventSessionID(evt.Value); sessionID != "" {
			seenSessionID = sessionID
			if req.PersistExternalSessionID != nil {
				req.PersistExternalSessionID(sessionID)
			}
		}
		if req.EmitEvent != nil {
			if compact, ok := compactEventForStream(evt.Value); ok {
				req.EmitEvent(compact)
			}
		}
		if text := textFromEvent(evt.Value); text != "" {
			if textBuilder.Len() > 0 {
				textBuilder.WriteString("\n\n")
			}
			textBuilder.WriteString(text)
		}
	})
	if err != nil {
		return registry.RunResult{}, err
	}

	return registry.RunResult{
		ExternalSessionID: strings.TrimSpace(seenSessionID),
		Text:              strings.TrimSpace(textBuilder.String()),
	}, nil
}

func (h *Harness) SetupRuntime(ctx registry.SetupContext) error {
	runtimeDir := strings.TrimSpace(ctx.RuntimeContext.RuntimeDir)
	if runtimeDir == "" {
		return nil
	}
	_, err := registry.EnsureManagedContextFile(registry.ManagedFileSpec{
		Harness: h.ID(),
		Path:    filepath.Join(resolveRuntimeConfigDir(ctx.RuntimeContext), "AGENTS.md"),
		Version: 1,
		Content: renderAgentsContent(ctx.RuntimeContext),
	})
	if err != nil {
		return err
	}
	return ensureRuntimeConfigFile(ctx.RuntimeContext.RuntimeDir)
}

func renderAgentsContent(ctx registry.RuntimeContext) string {
	var content strings.Builder
	content.WriteString("# Environment\n")
	content.WriteString("- You are OpenCode running inside a sandbox container.\n")
	content.WriteString("- Runtime state root: " + strings.TrimSpace(ctx.RootDir) + "\n")
	content.WriteString("- Home/workspace root: " + strings.TrimSpace(ctx.AgentHome) + "\n")
	content.WriteString("- Agent identity: AGENT_ID=" + strings.TrimSpace(ctx.AgentID) + "\n")
	content.WriteString("- OpenCode runtime config dir: " + resolveRuntimeConfigDir(ctx) + "\n")
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

func (h *Harness) resolveModelPattern(pattern string) (string, *string, error) {
	return registry.ResolveCatalogModelPattern(pattern, modelcatalog.All(), h.ID(), func(def modelcatalog.ModelDef) string {
		return def.Provider + "/" + def.ID
	}, isValidVariant)
}

func isValidVariant(value string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	return trimmed != "" && opencodeVariantPattern.MatchString(trimmed)
}

func splitInputs(input []registry.Input) (string, []string) {
	textParts := make([]string, 0, len(input))
	files := make([]string, 0, len(input))
	for _, item := range input {
		switch item.Type {
		case "text":
			if text := strings.TrimSpace(item.Text); text != "" {
				textParts = append(textParts, text)
			}
		case "local_image":
			if file := strings.TrimSpace(item.Path); file != "" {
				files = append(files, file)
			}
		}
	}
	return strings.TrimSpace(strings.Join(textParts, "\n")), files
}

func compactEventForStream(value map[string]any) (map[string]any, bool) {
	if len(value) == 0 {
		return nil, false
	}

	switch strings.TrimSpace(registry.FirstNonEmptyString(value["type"])) {
	case "text", "reasoning":
		part := compactTextPart(value["part"])
		if part == nil {
			return nil, false
		}
		return map[string]any{
			"type": strings.TrimSpace(registry.FirstNonEmptyString(value["type"])),
			"part": part,
		}, true
	case "tool_use":
		part := compactToolPart(value["part"])
		if part == nil {
			return nil, false
		}
		return map[string]any{
			"type": "tool_use",
			"part": part,
		}, true
	case "error":
		message := strings.TrimSpace(firstErrorMessage(value["error"]))
		if message == "" {
			message = "Unknown error"
		}
		return map[string]any{
			"type":    "error",
			"message": message,
		}, true
	default:
		return nil, false
	}
}

func compactTextPart(raw any) map[string]any {
	part, _ := raw.(map[string]any)
	text := strings.TrimSpace(registry.FirstNonEmptyString(part["text"]))
	if text == "" {
		return nil
	}
	out := map[string]any{"text": text}
	if id := strings.TrimSpace(registry.FirstNonEmptyString(part["id"])); id != "" {
		out["id"] = id
	}
	return out
}

func compactToolPart(raw any) map[string]any {
	part, _ := raw.(map[string]any)
	if len(part) == 0 {
		return nil
	}
	tool := strings.TrimSpace(registry.FirstNonEmptyString(part["tool"]))
	if tool == "" {
		return nil
	}

	state, _ := part["state"].(map[string]any)
	out := map[string]any{"tool": tool}
	if id := strings.TrimSpace(registry.FirstNonEmptyString(part["id"])); id != "" {
		out["id"] = id
	}
	if status := strings.TrimSpace(registry.FirstNonEmptyString(state["status"])); status != "" {
		out["status"] = status
	}
	if input, ok := state["input"]; ok {
		out["input"] = input
	}
	if output, ok := state["output"]; ok {
		out["output"] = output
	}
	if metadata, ok := state["metadata"]; ok {
		out["metadata"] = metadata
	}
	if errMsg := strings.TrimSpace(firstErrorMessage(state["error"])); errMsg != "" {
		out["error"] = errMsg
	}
	return out
}

func eventSessionID(value map[string]any) string {
	return strings.TrimSpace(registry.FirstNonEmptyString(value["sessionID"]))
}

func textFromEvent(value map[string]any) string {
	if strings.TrimSpace(registry.FirstNonEmptyString(value["type"])) != "text" {
		return ""
	}
	part, _ := value["part"].(map[string]any)
	return strings.TrimSpace(registry.FirstNonEmptyString(part["text"]))
}

func firstErrorMessage(value any) string {
	switch t := value.(type) {
	case string:
		return strings.TrimSpace(t)
	case map[string]any:
		if msg := strings.TrimSpace(registry.FirstNonEmptyString(t["message"])); msg != "" {
			return msg
		}
		if data, ok := t["data"].(map[string]any); ok {
			if msg := strings.TrimSpace(registry.FirstNonEmptyString(data["message"])); msg != "" {
				return msg
			}
		}
	}
	return ""
}

func runtimeConfigDir(runtimeDir string) string {
	return filepath.Join(strings.TrimSpace(runtimeDir), "opencode")
}

func resolveRuntimeConfigDir(ctx registry.RuntimeContext) string {
	if dir := strings.TrimSpace(ctx.OpencodeConfigDir); dir != "" {
		return dir
	}
	return runtimeConfigDir(ctx.RuntimeDir)
}

func resolveOpencodeConfigDir(env []string, runtimeDir string) string {
	for _, entry := range env {
		key, value, ok := strings.Cut(entry, "=")
		if ok && strings.EqualFold(strings.TrimSpace(key), "OPENCODE_CONFIG_DIR") {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				return trimmed
			}
		}
	}
	return runtimeConfigDir(runtimeDir)
}

func runtimeConfigFilePath(runtimeDir string) string {
	return filepath.Join(runtimeConfigDir(runtimeDir), "config.json")
}

func ensureRuntimeConfigFile(runtimeDir string) error {
	path := runtimeConfigFilePath(runtimeDir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(opencodeRunConfigAllowAll), 0o644)
}

func opencodeRunEnv(baseEnv []string, runtimeDir, sessionID string) []string {
	sessionRoot := sessionRuntimeDir(runtimeDir, sessionID)
	env := append([]string(nil), baseEnv...)
	env = setEnvValue(env, "OPENCODE_CONFIG", runtimeConfigFilePath(runtimeDir))
	env = setEnvValue(env, "OPENCODE_CONFIG_DIR", resolveOpencodeConfigDir(baseEnv, runtimeDir))
	env = setEnvValue(env, "OPENCODE_DISABLE_AUTOUPDATE", "true")
	env = setEnvValue(env, "XDG_CONFIG_HOME", filepath.Join(sessionRoot, "xdg", "config"))
	env = setEnvValue(env, "XDG_DATA_HOME", filepath.Join(sessionRoot, "xdg", "data"))
	env = setEnvValue(env, "XDG_STATE_HOME", filepath.Join(sessionRoot, "xdg", "state"))
	env = setEnvValue(env, "XDG_CACHE_HOME", filepath.Join(sessionRoot, "xdg", "cache"))
	return env
}

func setEnvValue(env []string, key, value string) []string {
	key = strings.TrimSpace(key)
	if key == "" {
		return append([]string(nil), env...)
	}
	entry := key + "=" + value
	out := append([]string(nil), env...)
	for i, current := range out {
		currentKey, _, ok := strings.Cut(current, "=")
		if ok && strings.EqualFold(strings.TrimSpace(currentKey), key) {
			out[i] = entry
			return out
		}
	}
	return append(out, entry)
}

func sessionRuntimeDir(runtimeDir, sessionID string) string {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		sessionID = "adhoc"
	}
	return filepath.Join(strings.TrimSpace(runtimeDir), "opencode", "sessions", sessionID)
}
