//go:build dockerintegration

package agentgo

import (
	"bufio"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestRunningDockerDevServesAPIsAndNoVNC(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("docker not available")
	}
	root := repoRoot(t)
	loadDotEnv(root)
	secretSeed := strings.TrimSpace(os.Getenv("SECRET_SEED"))
	if secretSeed == "" {
		secretSeed = strings.Repeat("x", 32)
	}
	container := startRunningAgentContainer(t, root, secretSeed, envBool("RUN_LIVE_AI_IT"))
	defer container.cleanup()

	apiBaseURL := fmt.Sprintf("http://127.0.0.1:%d", container.apiPort)
	noVNCBaseURL := fmt.Sprintf("http://127.0.0.1:%d", container.novncPort)

	waitFor(t, 20*time.Second, func() error {
		res, err := http.Get(apiBaseURL + "/health")
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return fmt.Errorf("health=%d", res.StatusCode)
		}
		return nil
	})

	waitFor(t, 20*time.Second, func() error {
		res, err := http.Get(noVNCBaseURL + "/")
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return fmt.Errorf("novnc=%d", res.StatusCode)
		}
		return nil
	})

	novncRes, err := http.Get(noVNCBaseURL + "/")
	if err != nil {
		t.Fatalf("noVNC request failed: %v", err)
	}
	defer novncRes.Body.Close()
	novncText := decodeJSONOrText(t, novncRes)
	mustContainAll(t, novncText, []string{"new RFB", "rfb.resizeSession"})

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", secretSeed, "default")

	badCreate := httpJSON(t, http.MethodPost, apiBaseURL+"/session", nil, map[string]any{})
	badCreate.Body.Close()
	if badCreate.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized create, got %d", badCreate.StatusCode)
	}

	createRes := httpJSON(t, http.MethodPost, apiBaseURL+"/session", auth, map[string]any{"id": sessionID, "harness": "codex"})
	defer createRes.Body.Close()
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("expected create 201, got %d", createRes.StatusCode)
	}

	getRes := httpJSON(t, http.MethodGet, apiBaseURL+"/session/"+sessionID, auth, nil)
	defer getRes.Body.Close()
	if getRes.StatusCode != http.StatusOK {
		t.Fatalf("expected get 200, got %d", getRes.StatusCode)
	}
	payload := decodeJSON[map[string]any](t, getRes.Body)
	if fmt.Sprintf("%v", payload["isRunning"]) != "false" {
		t.Fatalf("expected isRunning false, got %#v", payload)
	}

	stopRes := httpJSON(t, http.MethodPost, apiBaseURL+"/session/"+sessionID+"/stop", auth, nil)
	defer stopRes.Body.Close()
	if stopRes.StatusCode != http.StatusOK {
		t.Fatalf("expected stop 200, got %d", stopRes.StatusCode)
	}

	streamRes := httpJSON(t, http.MethodGet, apiBaseURL+"/session/"+sessionID+"/stream", auth, nil)
	defer streamRes.Body.Close()
	reader := bufio.NewReader(streamRes.Body)
	_ = readSSEUntil(t, reader, 10*time.Second, func(evt testSSEEvent) bool { return evt.Event == "connected" })
	_ = readSSEUntil(t, reader, 10*time.Second, func(evt testSSEEvent) bool { return evt.Event == "status" })
}

func TestRunningAgentSessionStreamOutputsAssistantTextForRun(t *testing.T) {
	if !envBool("RUN_LIVE_AI_IT") {
		t.Skip("set RUN_LIVE_AI_IT=1 to enable live AI integration")
	}
	if !dockerAvailable() {
		t.Skip("docker not available")
	}
	root := repoRoot(t)
	loadDotEnv(root)
	secretSeed := strings.TrimSpace(os.Getenv("SECRET_SEED"))
	if secretSeed == "" {
		secretSeed = strings.Repeat("x", 32)
	}
	container := startRunningAgentContainer(t, root, secretSeed, true)
	defer container.cleanup()

	apiBaseURL := fmt.Sprintf("http://127.0.0.1:%d", container.apiPort)
	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", secretSeed, "default")

	createRes := httpJSON(t, http.MethodPost, apiBaseURL+"/session", auth, map[string]any{"id": sessionID, "harness": "codex"})
	createRes.Body.Close()
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("expected create 201, got %d", createRes.StatusCode)
	}

	streamRes := httpJSON(t, http.MethodGet, apiBaseURL+"/session/"+sessionID+"/stream", auth, nil)
	defer streamRes.Body.Close()
	reader := bufio.NewReader(streamRes.Body)
	_ = readSSEUntil(t, reader, 10*time.Second, func(evt testSSEEvent) bool { return evt.Event == "connected" })

	runRes := httpJSON(t, http.MethodPost, apiBaseURL+"/session/"+sessionID+"/message", auth, map[string]any{
		"input": []map[string]any{{"type": "text", "text": "Hi, how are you"}},
	})
	defer runRes.Body.Close()
	if runRes.StatusCode != http.StatusOK {
		t.Fatalf("expected run 200, got %d", runRes.StatusCode)
	}

	assistantEvt := readSSEUntil(t, reader, 120*time.Second, func(evt testSSEEvent) bool {
		if evt.Event != "item.updated" && evt.Event != "item.completed" {
			return false
		}
		return strings.Contains(evt.Data, "agent_message") && strings.Contains(evt.Data, "text")
	})
	if !strings.Contains(assistantEvt.Data, "agent_message") {
		t.Fatalf("expected assistant agent_message event, got %s", assistantEvt.Data)
	}
}

func TestRunningAgentSessionTitleGeneratedFromFirstUserInput(t *testing.T) {
	if !envBool("RUN_LIVE_AI_IT") {
		t.Skip("set RUN_LIVE_AI_IT=1 to enable live AI integration")
	}
	if !dockerAvailable() {
		t.Skip("docker not available")
	}
	root := repoRoot(t)
	loadDotEnv(root)
	secretSeed := strings.TrimSpace(os.Getenv("SECRET_SEED"))
	if secretSeed == "" {
		secretSeed = strings.Repeat("x", 32)
	}
	container := startRunningAgentContainer(t, root, secretSeed, true)
	defer container.cleanup()

	apiBaseURL := fmt.Sprintf("http://127.0.0.1:%d", container.apiPort)
	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", secretSeed, "default")

	createRes := httpJSON(t, http.MethodPost, apiBaseURL+"/session", auth, map[string]any{"id": sessionID, "harness": "codex"})
	createRes.Body.Close()
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("expected create 201, got %d", createRes.StatusCode)
	}

	msgRes := httpJSON(t, http.MethodPost, apiBaseURL+"/session/"+sessionID+"/message", auth, map[string]any{
		"input": []map[string]any{{"type": "text", "text": "Generate a short title for this request."}},
	})
	msgRes.Body.Close()
	if msgRes.StatusCode != http.StatusOK {
		t.Fatalf("expected message 200, got %d", msgRes.StatusCode)
	}

	var title string
	for i := 0; i < 60; i++ {
		time.Sleep(500 * time.Millisecond)
		getRes := httpJSON(t, http.MethodGet, apiBaseURL+"/session/"+sessionID, auth, nil)
		if getRes.StatusCode != http.StatusOK {
			getRes.Body.Close()
			continue
		}
		payload := decodeJSON[map[string]any](t, getRes.Body)
		getRes.Body.Close()
		title = strings.TrimSpace(fmt.Sprintf("%v", payload["title"]))
		if title != "" && title != "<nil>" {
			break
		}
	}
	if title == "" || title == "<nil>" {
		t.Fatalf("expected generated session title")
	}
}

type runningContainer struct {
	name      string
	apiPort   int
	novncPort int
	root      string
}

func (c runningContainer) cleanup() {
	_ = runCmdNoFail([]string{"docker", "rm", "-f", c.name}, c.root)
}

func runCmdNoFail(cmd []string, dir string) error {
	execCmd := exec.Command(cmd[0], cmd[1:]...)
	execCmd.Dir = dir
	return execCmd.Run()
}

func startRunningAgentContainer(t *testing.T, root, secretSeed string, liveAI bool) runningContainer {
	t.Helper()
	imageTag := fmt.Sprintf("agent-go:it-dev-%d", time.Now().UnixNano())
	containerName := fmt.Sprintf("agent_go_it_dev_%d", time.Now().UnixNano())
	agentBinary := ensureDockerAgentServerBinary(t, root)
	runCmd(t, []string{"docker", "build", "-f", "agent-go/Dockerfile", "--build-arg", "AGENT_SERVER_BINARY=" + agentBinary, "-t", imageTag, "."}, root, nil, false)
	defer runCmd(t, []string{"docker", "image", "rm", "-f", imageTag}, root, nil, true)

	envArgs := []string{"-e", "PORT=3131", "-e", "NOVNC_PORT=6080", "-e", "OPENVSCODE_SERVER_PORT=39393", "-e", "SECRET_SEED=" + secretSeed}
	if liveAI {
		if openai := strings.TrimSpace(os.Getenv("OPENAI_API_KEY")); openai != "" {
			envArgs = append(envArgs, "-e", "OPENAI_API_KEY="+openai)
		}
		if codex := strings.TrimSpace(os.Getenv("CODEX_API_KEY")); codex != "" {
			envArgs = append(envArgs, "-e", "CODEX_API_KEY="+codex)
		}
	}
	runArgs := []string{"docker", "run", "-d", "--name", containerName, "--shm-size=1g", "-P"}
	runArgs = append(runArgs, envArgs...)
	runArgs = append(runArgs, imageTag)
	runCmd(t, runArgs, root, nil, false)

	apiPort := parseHostPort(t, runCmd(t, []string{"docker", "port", containerName, "3131/tcp"}, root, nil, false).Stdout)
	novncPort := parseHostPort(t, runCmd(t, []string{"docker", "port", containerName, "6080/tcp"}, root, nil, false).Stdout)
	waitFor(t, 30*time.Second, func() error {
		res, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/health", apiPort))
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return fmt.Errorf("health=%d", res.StatusCode)
		}
		return nil
	})
	return runningContainer{name: containerName, apiPort: apiPort, novncPort: novncPort, root: root}
}

func loadDotEnv(root string) {
	path := filepath.Join(root, ".env")
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		parts := strings.SplitN(trimmed, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		if key == "" || os.Getenv(key) != "" {
			continue
		}
		_ = os.Setenv(key, val)
	}
}

func parseIntEnvDefault(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
