package server

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	harnessregistry "agent-go/internal/harness/registry"
)

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
		ToolReadmes:                listToolReadmes(toolsDir),
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

func effectiveWorkspaceToolsDir(cfg serveConfig) string {
	candidates := []string{
		strings.TrimSpace(os.Getenv("WORKSPACE_TOOLS_DIR_EFFECTIVE")),
		strings.TrimSpace(os.Getenv("WORKSPACE_TOOLS_DIR")),
		filepath.Join(strings.TrimSpace(cfg.WorkspacesDir), "tools"),
		"/app/tools",
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

func listToolReadmes(root string) []string {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil
	}
	walkRoot := root
	displayRoot := root
	if resolved, err := filepath.EvalSymlinks(root); err == nil && strings.TrimSpace(resolved) != "" {
		walkRoot = resolved
	}
	info, err := os.Stat(walkRoot)
	if err != nil || !info.IsDir() {
		return nil
	}

	readmes := make([]string, 0, 16)
	_ = filepath.WalkDir(walkRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			switch name {
			case "node_modules", ".git", "dist", "build", "coverage":
				return filepath.SkipDir
			}
			return nil
		}
		if name == "README.md" {
			displayPath := path
			if rel, relErr := filepath.Rel(walkRoot, path); relErr == nil {
				displayPath = filepath.Join(displayRoot, rel)
			}
			readmes = append(readmes, displayPath)
		}
		return nil
	})
	sort.Strings(readmes)
	return readmes
}
