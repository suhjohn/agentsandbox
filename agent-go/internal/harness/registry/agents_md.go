package registry

import (
	"path/filepath"
	"strings"
)

func RenderAgentsMD(ctx RuntimeContext, harnessID string) string {
	harnessID = strings.ToLower(strings.TrimSpace(harnessID))
	harnessName := "Agent"
	switch harnessID {
	case "codex":
		harnessName = "Codex"
	case "pi":
		harnessName = "PI"
	}

	var content strings.Builder
	content.WriteString(SharedAgentsSection(ctx))
	content.WriteString("# Environment\n")
	content.WriteString("- You are " + harnessName + " running inside a sandbox container.\n")
	content.WriteString("- Runtime state root: " + strings.TrimSpace(ctx.RootDir) + "\n")
	content.WriteString("- Home/workspace root: " + strings.TrimSpace(ctx.AgentHome) + "\n")
	content.WriteString("- Agent identity: AGENT_ID=" + strings.TrimSpace(ctx.AgentID) + "\n")

	switch harnessID {
	case "codex":
		content.WriteString("- Codex state dir: " + strings.TrimSpace(ctx.CodexHome) + "\n")
		if piDir := strings.TrimSpace(ctx.PIDir); piDir != "" {
			content.WriteString("- PI state dir: " + piDir + "\n")
		}
	case "pi":
		content.WriteString("- PI state dir: " + strings.TrimSpace(ctx.PIDir) + "\n")
		if codexHome := strings.TrimSpace(ctx.CodexHome); codexHome != "" {
			content.WriteString("- Codex state dir: " + codexHome + "\n")
		}
	default:
		if codexHome := strings.TrimSpace(ctx.CodexHome); codexHome != "" {
			content.WriteString("- Codex state dir: " + codexHome + "\n")
		}
		if piDir := strings.TrimSpace(ctx.PIDir); piDir != "" {
			content.WriteString("- PI state dir: " + piDir + "\n")
		}
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
	if workingDir := strings.TrimSpace(ctx.AgentHome); workingDir != "" {
		content.WriteString("- Working directory: " + workingDir + ".\n")
	}
	content.WriteString("- Prefer reusing the existing browser rather than launching a new one.\n")
	content.WriteString("\n# Tools (Workspace)\n")
	if toolsDir := strings.TrimSpace(ctx.ToolsDir); toolsDir != "" {
		content.WriteString("- Workspace tools root: " + toolsDir + "\n")
	}
	if bundledToolsDir := strings.TrimSpace(ctx.BundledToolsDir); bundledToolsDir != "" {
		content.WriteString("- Bundled agent-go tools are available under: " + bundledToolsDir + "\n")
	}
	content.WriteString("- Tool directories may be user-created or bundled. Read each README.md before invoking the tool.\n")
	if len(ctx.ToolReadmes) > 0 {
		content.WriteString("\n## Tool READMEs\n")
		for _, readme := range ctx.ToolReadmes {
			path := strings.TrimSpace(readme.Path)
			body := strings.TrimSpace(readme.Content)
			if path == "" || body == "" {
				continue
			}
			content.WriteString("\n### " + path + "\n")
			content.WriteString("```md\n")
			content.WriteString(body)
			content.WriteString("\n```\n")
		}
	}

	rootDir := strings.TrimSpace(ctx.RootDir)
	if rootDir != "" {
		content.WriteString("\n# Runtime Paths\n")
		content.WriteString("- Agent database file (default): " + filepath.Join(rootDir, "agent.db") + "\n")
		content.WriteString("- Logs directory: " + filepath.Join(rootDir, "logs") + " (chromium.log, openbox.log, xvfb.log, agent-server.log, dockerd.log, supervisord.log)\n")
		content.WriteString("- Supervisor socket: " + filepath.Join(rootDir, "supervisor", "supervisor.sock") + "\n")
		content.WriteString("- Supervisor pid file: " + filepath.Join(rootDir, "supervisor", "supervisord.pid") + "\n")
		content.WriteString("- Chromium PID file: " + filepath.Join(rootDir, "run", "chromium.pid") + "\n")
		content.WriteString("- VNC password file (default): " + filepath.Join(rootDir, "vnc", "passwd") + "\n")
		content.WriteString("- Upgrade markers directory: " + filepath.Join(rootDir, "upgrade-state") + "\n")
	}

	content.WriteString("\n# Image / Repo Paths\n")
	content.WriteString("- Agent entrypoint script: /opt/agentsandbox/agent-go/docker/start.sh\n")
	content.WriteString("- Agent setup helper: /opt/agentsandbox/agent-go/docker/setup.sh\n")
	content.WriteString("- Supervisor config: /opt/agentsandbox/agent-go/docker/supervisord.conf\n")
	content.WriteString("- Docker CLI wrapper: /usr/local/bin/docker (source: /opt/agentsandbox/agent-go/docker/docker-wrapper.sh)\n")
	content.WriteString("- OpenVSCode Server binary: /usr/local/bin/openvscode-server\n")
	content.WriteString("- noVNC HTML: /usr/share/novnc/index.html (also vnc.html, vnc_lite.html)\n")
	content.WriteString("- Image version file: /etc/agent-image-version\n")
	return content.String()
}
