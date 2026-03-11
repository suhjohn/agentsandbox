//go:build dockerintegration

package agentgo

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestDockerNoVNCSmokeAndBasicAPIs(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("docker not available")
	}

	root := repoRoot(t)
	secretSeed := strings.Repeat("x", 32)
	imageTag := "agent-go:it-novnc"
	containerName := fmt.Sprintf("agent_go_it_%d", time.Now().UnixNano())

	runCmd(t, []string{"docker", "build", "-f", "agent-go/Dockerfile", "-t", imageTag, "."}, root, nil, false)
	defer runCmd(t, []string{"docker", "rm", "-f", containerName}, root, nil, true)

	runCmd(t, []string{
		"docker", "run", "-d", "--name", containerName, "--shm-size=1g", "-P",
		"-e", "OPENAI_API_KEY=sk-test",
		"-e", "SECRET_SEED=" + secretSeed,
		imageTag,
	}, root, nil, false)

	apiPort := parseHostPort(t, runCmd(t, []string{"docker", "port", containerName, "3131/tcp"}, root, nil, false).Stdout)
	novncPort := parseHostPort(t, runCmd(t, []string{"docker", "port", containerName, "6080/tcp"}, root, nil, false).Stdout)
	apiBaseURL := fmt.Sprintf("http://127.0.0.1:%d", apiPort)
	noVNCBaseURL := fmt.Sprintf("http://127.0.0.1:%d", novncPort)

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

	healthRes, err := http.Get(apiBaseURL + "/health")
	if err != nil {
		t.Fatalf("health request: %v", err)
	}
	defer healthRes.Body.Close()
	if healthRes.StatusCode != http.StatusOK {
		t.Fatalf("expected health 200, got %d", healthRes.StatusCode)
	}

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

	novncHTMLRes, err := http.Get(noVNCBaseURL + "/")
	if err != nil {
		t.Fatalf("novnc request: %v", err)
	}
	defer novncHTMLRes.Body.Close()
	novncBody := decodeJSONOrText(t, novncHTMLRes)
	if !strings.Contains(novncBody, "new RFB") || !strings.Contains(novncBody, "rfb.resizeSession") {
		t.Fatalf("unexpected noVNC html")
	}

	toolsSymlinkCmd := `EXPECTED_TOOLS_DIR="${AGENT_TOOLS_DIR:-${AGENT_GO_REPO_DIR:-/opt/agentsandbox/agent-go}/tools}"; test -d "${WORKSPACES_DIR:-/home/agent/workspaces}/tools" && test -L "${WORKSPACES_DIR:-/home/agent/workspaces}/tools/default/browser-tools" && readlink -f "${WORKSPACES_DIR:-/home/agent/workspaces}/tools/default/browser-tools" | rg -n "${EXPECTED_TOOLS_DIR}/browser-tools\$" >/dev/null`
	runCmd(t, []string{"docker", "exec", containerName, "bash", "-lc", toolsSymlinkCmd}, root, nil, false)

	browserToolsCmd := `test -f "${WORKSPACES_DIR:-/home/agent/workspaces}/tools/default/browser-tools/README.md" && test -f "${WORKSPACES_DIR:-/home/agent/workspaces}/tools/default/browser-tools/start.py"`
	runCmd(t, []string{"docker", "exec", containerName, "bash", "-lc", browserToolsCmd}, root, nil, false)

	agentsCmd := `CODEX_HOME_PATH="${CODEX_HOME:-${AGENT_HOME:-/home/agent}/.codex}"; test -f "${CODEX_HOME_PATH}/AGENTS.md" && rg -n "agent-go:managed kind=agents-md harness=codex version=1|Tool READMEs|/home/agent/workspaces/tools/default/browser-tools/README.md" "${CODEX_HOME_PATH}/AGENTS.md" >/dev/null`
	runCmd(t, []string{"docker", "exec", containerName, "bash", "-lc", agentsCmd}, root, nil, false)

	piAgentsCmd := `PI_HOME_PATH="${PI_CODING_AGENT_DIR:-${AGENT_HOME:-/home/agent}/.pi}"; test -f "${PI_HOME_PATH}/AGENTS.md" && rg -n "agent-go:managed kind=agents-md harness=pi version=1|Tool READMEs|/home/agent/workspaces/tools/default/browser-tools/README.md" "${PI_HOME_PATH}/AGENTS.md" >/dev/null`
	runCmd(t, []string{"docker", "exec", containerName, "bash", "-lc", piAgentsCmd}, root, nil, false)

	pgContainer := fmt.Sprintf("agent_go_it_pg_%d", time.Now().UnixNano())
	defer runCmd(t, []string{"docker", "rm", "-f", pgContainer}, root, nil, true)
	runCmd(t, []string{"docker", "run", "-d", "--name", pgContainer, "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_DB=postgres", "postgres:17-alpine"}, root, nil, false)
	waitFor(t, 90*time.Second, func() error {
		out := runCmd(t, []string{"docker", "exec", pgContainer, "pg_isready", "-h", "127.0.0.1", "-p", "5432", "-U", "postgres"}, root, nil, true)
		if out.ExitCode != 0 {
			return fmt.Errorf("not ready")
		}
		return nil
	})

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

	badIDRes, err := http.Get(apiBaseURL + "/session/not-a-valid-id")
	if err != nil {
		t.Fatalf("bad id request failed: %v", err)
	}
	defer badIDRes.Body.Close()
	if badIDRes.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected bad id 400, got %d", badIDRes.StatusCode)
	}

	getRes := httpJSON(t, http.MethodGet, apiBaseURL+"/session/"+sessionID, auth, nil)
	defer getRes.Body.Close()
	if getRes.StatusCode != http.StatusOK {
		t.Fatalf("expected get 200, got %d", getRes.StatusCode)
	}
	getPayload := decodeJSON[map[string]any](t, getRes.Body)
	if fmt.Sprintf("%v", getPayload["id"]) != sessionID {
		t.Fatalf("unexpected session get payload: %#v", getPayload)
	}
	if fmt.Sprintf("%v", getPayload["isRunning"]) != "false" {
		t.Fatalf("expected isRunning false, got %#v", getPayload)
	}

	stopRes := httpJSON(t, http.MethodPost, apiBaseURL+"/session/"+sessionID+"/stop", auth, nil)
	defer stopRes.Body.Close()
	if stopRes.StatusCode != http.StatusOK {
		t.Fatalf("expected stop 200, got %d", stopRes.StatusCode)
	}
	stopPayload := decodeJSON[map[string]any](t, stopRes.Body)
	if fmt.Sprintf("%v", stopPayload["success"]) != "false" {
		t.Fatalf("expected stop success=false, got %#v", stopPayload)
	}

	streamRes := httpJSON(t, http.MethodGet, apiBaseURL+"/session/"+sessionID+"/stream", auth, nil)
	defer streamRes.Body.Close()
	if streamRes.StatusCode != http.StatusOK {
		t.Fatalf("expected stream 200, got %d", streamRes.StatusCode)
	}
	reader := bufio.NewReader(streamRes.Body)
	_ = readSSEUntil(t, reader, 10*time.Second, func(evt testSSEEvent) bool { return evt.Event == "connected" })
	_ = readSSEUntil(t, reader, 10*time.Second, func(evt testSSEEvent) bool { return evt.Event == "status" })

	waitFor(t, 20*time.Second, func() error {
		ps := runCmd(t, []string{"docker", "exec", containerName, "ps", "aux"}, root, nil, false)
		if !strings.Contains(ps.Stdout, "chromium") {
			return fmt.Errorf("chromium not running")
		}
		return nil
	})
	ps := runCmd(t, []string{"docker", "exec", containerName, "ps", "aux"}, root, nil, false)
	mustContainAll(t, ps.Stdout, []string{"Xvfb :99", "openbox", "x11vnc", "websockify", "chromium"})
}

func decodeJSONOrText(t *testing.T, res *http.Response) string {
	t.Helper()
	buf := new(strings.Builder)
	_, err := io.Copy(buf, res.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	return buf.String()
}

func mustContainAll(t *testing.T, haystack string, needles []string) {
	t.Helper()
	for _, n := range needles {
		if !strings.Contains(haystack, n) {
			t.Fatalf("expected output to contain %q", n)
		}
	}
}
