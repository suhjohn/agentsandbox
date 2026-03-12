package server

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	harnessregistry "agent-go/internal/harness/registry"
)

const defaultSharedAgentsPath = "/shared/AGENTS.md"

func (s *server) setupHarnessRuntime() error {
	if err := s.ensureHarnesses(); err != nil {
		return err
	}

	ctx := harnessregistry.SetupContext{
		RuntimeContext: buildHarnessRuntimeContext(s.cfg),
		OpenAIAPIKey:   strings.TrimSpace(s.cfg.OpenAIAPIKey),
	}
	for _, id := range s.harnesses.IDs() {
		def, ok := s.harnesses.Get(id)
		if !ok || def == nil {
			continue
		}
		if err := def.SetupRuntime(ctx); err != nil {
			return fmt.Errorf("setup harness runtime for %s: %w", def.ID(), err)
		}
	}
	return nil
}

func buildHarnessRuntimeContext(cfg serveConfig) harnessregistry.RuntimeContext {
	rootDir := envString("ROOT_DIR", filepath.Dir(strings.TrimSpace(cfg.RuntimeDir)))
	codexHome := envString("CODEX_HOME", filepath.Join(strings.TrimSpace(cfg.AgentHome), ".codex"))
	piDir := strings.TrimSpace(cfg.PIDir)
	if piDir == "" {
		piDir = envString("PI_CODING_AGENT_DIR", filepath.Join(strings.TrimSpace(cfg.AgentHome), ".pi"))
	}
	toolsDir := effectiveWorkspaceToolsDir(cfg)
	bundledToolsDir := bundledWorkspaceToolsDir(toolsDir)
	sharedAgentsPath, sharedAgentsContent := loadSharedAgentsContent(defaultSharedAgentsPath)

	return harnessregistry.RuntimeContext{
		RootDir:                    rootDir,
		RuntimeDir:                 strings.TrimSpace(cfg.RuntimeDir),
		AgentHome:                  strings.TrimSpace(cfg.AgentHome),
		AgentID:                    strings.TrimSpace(cfg.AgentID),
		WorkspacesDir:              strings.TrimSpace(cfg.WorkspacesDir),
		DefaultWorkingDir:          strings.TrimSpace(cfg.DefaultWorkingDir),
		CodexHome:                  codexHome,
		PIDir:                      piDir,
		ToolsDir:                   toolsDir,
		BundledToolsDir:            bundledToolsDir,
		ToolReadmes:                listToolReadmes(toolsDir),
		SharedAgentsPath:           sharedAgentsPath,
		SharedAgentsContent:        sharedAgentsContent,
		Display:                    strings.TrimSpace(os.Getenv("DISPLAY")),
		ScreenWidth:                envString("SCREEN_WIDTH", ""),
		ScreenHeight:               envString("SCREEN_HEIGHT", ""),
		ScreenDepth:                envString("SCREEN_DEPTH", ""),
		ChromiumRemoteDebugAddress: envString("CHROMIUM_REMOTE_DEBUG_ADDRESS", ""),
		ChromiumRemoteDebugPort:    envString("CHROMIUM_REMOTE_DEBUG_PORT", ""),
		VNCPort:                    envString("VNC_PORT", ""),
		NoVNCPort:                  envString("NOVNC_PORT", ""),
		ChromiumUserDataDir:        envString("CHROMIUM_USER_DATA_DIR", filepath.Join(rootDir, "browser", "chromium")),
	}
}

func loadSharedAgentsContent(path string) (string, string) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", ""
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", ""
	}
	content := strings.TrimSpace(string(raw))
	if content == "" {
		return "", ""
	}
	return path, content
}

func effectiveWorkspaceToolsDir(cfg serveConfig) string {
	candidates := []string{
		strings.TrimSpace(os.Getenv("WORKSPACE_TOOLS_DIR")),
		filepath.Join(strings.TrimSpace(cfg.WorkspacesDir), "tools"),
		strings.TrimSpace(os.Getenv("AGENT_TOOLS_DIR")),
		filepath.Join(strings.TrimSpace(os.Getenv("AGENT_GO_REPO_DIR")), "tools"),
	}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) == "" {
			continue
		}
		info, err := os.Stat(candidate)
		if err == nil && info.IsDir() {
			return candidate
		}
	}
	return ""
}

func bundledWorkspaceToolsDir(root string) string {
	root = strings.TrimSpace(root)
	if root == "" {
		return ""
	}
	candidate := filepath.Join(root, "default")
	info, err := os.Stat(candidate)
	if err != nil || !info.IsDir() {
		return ""
	}
	return candidate
}

func listToolReadmes(root string) []harnessregistry.ToolReadme {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return nil
	}

	readmes := make([]harnessregistry.ToolReadme, 0, 16)
	visited := make(map[string]struct{}, 16)
	var walk func(string, string)
	walk = func(displayDir, realDir string) {
		resolvedDir := realDir
		if resolved, err := filepath.EvalSymlinks(realDir); err == nil && strings.TrimSpace(resolved) != "" {
			resolvedDir = resolved
		}
		if _, ok := visited[resolvedDir]; ok {
			return
		}
		visited[resolvedDir] = struct{}{}

		entries, err := os.ReadDir(realDir)
		if err != nil {
			return
		}
		for _, entry := range entries {
			name := entry.Name()
			displayPath := filepath.Join(displayDir, name)
			realPath := filepath.Join(realDir, name)

			if entry.IsDir() {
				switch name {
				case "node_modules", ".git", "dist", "build", "coverage":
					continue
				}
				walk(displayPath, realPath)
				continue
			}

			info, err := entry.Info()
			if err == nil && info.Mode()&os.ModeSymlink != 0 {
				targetInfo, statErr := os.Stat(realPath)
				if statErr == nil && targetInfo.IsDir() {
					switch name {
					case "node_modules", ".git", "dist", "build", "coverage":
						continue
					}
					walk(displayPath, realPath)
					continue
				}
			}

			if name != "README.md" {
				continue
			}
			raw, readErr := os.ReadFile(realPath)
			if readErr != nil {
				continue
			}
			readmes = append(readmes, harnessregistry.ToolReadme{
				Path:    displayPath,
				Content: strings.TrimSpace(string(raw)),
			})
		}
	}

	walk(root, root)
	sort.Slice(readmes, func(i, j int) bool {
		return readmes[i].Path < readmes[j].Path
	})
	return readmes
}
