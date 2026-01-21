//go:build dockerintegration

package agentgo

import (
	"bufio"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func TestPIHarnessCreateSessionAndStream(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("docker not available")
	}
	root := repoRoot(t)
	secretSeed := strings.TrimSpace(os.Getenv("SECRET_SEED"))
	if secretSeed == "" {
		secretSeed = strings.Repeat("x", 32)
	}
	liveAI := envBool("RUN_LIVE_AI_IT")

	imageTag := "agent-go:it-pi"
	containerName := fmt.Sprintf("agent_go_it_pi_%d", time.Now().UnixNano())
	agentBinary := ensureDockerAgentServerBinary(t, root)
	runCmd(t, []string{"docker", "build", "-f", "agent-go/Dockerfile", "--build-arg", "PORT=3131", "--build-arg", "AGENT_SERVER_BINARY=" + agentBinary, "-t", imageTag, "."}, root, nil, false)
	defer runCmd(t, []string{"docker", "rm", "-f", containerName}, root, nil, true)

	openaiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if openaiKey == "" {
		openaiKey = "sk-test"
	}
	runCmd(t, []string{"docker", "run", "-d", "--name", containerName, "--shm-size=1g", "-P", "-e", "OPENAI_API_KEY=" + openaiKey, "-e", "PI_DIR=/tmp/pi", "-e", "SECRET_SEED=" + secretSeed, imageTag}, root, nil, false)

	apiPort := parseHostPort(t, runCmd(t, []string{"docker", "port", containerName, "3131/tcp"}, root, nil, false).Stdout)
	apiBaseURL := fmt.Sprintf("http://127.0.0.1:%d", apiPort)
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

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", secretSeed, "default")
	createRes := httpJSON(t, http.MethodPost, apiBaseURL+"/session", auth, map[string]any{"id": sessionID, "harness": "pi"})
	defer createRes.Body.Close()
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("expected create 201, got %d", createRes.StatusCode)
	}
	created := decodeJSON[map[string]any](t, createRes.Body)
	if fmt.Sprintf("%v", created["id"]) != sessionID || fmt.Sprintf("%v", created["harness"]) != "pi" {
		t.Fatalf("unexpected create payload: %#v", created)
	}

	getRes := httpJSON(t, http.MethodGet, apiBaseURL+"/session/"+sessionID, auth, nil)
	defer getRes.Body.Close()
	if getRes.StatusCode != http.StatusOK {
		t.Fatalf("expected get 200, got %d", getRes.StatusCode)
	}
	getPayload := decodeJSON[map[string]any](t, getRes.Body)
	if fmt.Sprintf("%v", getPayload["harness"]) != "pi" || fmt.Sprintf("%v", getPayload["isRunning"]) != "false" {
		t.Fatalf("unexpected get payload: %#v", getPayload)
	}

	streamRes := httpJSON(t, http.MethodGet, apiBaseURL+"/session/"+sessionID+"/stream", auth, nil)
	defer streamRes.Body.Close()
	if streamRes.StatusCode != http.StatusOK {
		t.Fatalf("expected stream 200, got %d", streamRes.StatusCode)
	}
	reader := bufio.NewReader(streamRes.Body)
	_ = readSSEUntil(t, reader, 10*time.Second, func(evt testSSEEvent) bool { return evt.Event == "connected" })
	_ = readSSEUntil(t, reader, 10*time.Second, func(evt testSSEEvent) bool { return evt.Event == "status" })

	if liveAI {
		msgRes := httpJSON(t, http.MethodPost, apiBaseURL+"/session/"+sessionID+"/message", auth, map[string]any{
			"input": []map[string]any{{"type": "text", "text": "Reply with exactly: ok"}},
		})
		defer msgRes.Body.Close()
		if msgRes.StatusCode != http.StatusOK {
			t.Fatalf("expected message 200, got %d", msgRes.StatusCode)
		}
		msgPayload := decodeJSON[map[string]any](t, msgRes.Body)
		if fmt.Sprintf("%v", msgPayload["success"]) != "true" {
			t.Fatalf("expected success true, got %#v", msgPayload)
		}
	}
}
