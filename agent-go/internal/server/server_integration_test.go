package server

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	sessionstate "agent-go/internal/session"
)

type testServer struct {
	server  *httptest.Server
	store   *store
	root    string
	seed    string
	agentID string
}

func newTestServer(t *testing.T) testServer {
	t.Helper()
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "agent.db")
	fakeCodexPath := filepath.Join(tmpDir, "fake-codex")
	script := "#!/bin/sh\n" +
		"echo '{\"type\":\"item.completed\",\"thread_id\":\"thread-123\",\"item\":{\"type\":\"agent_message\",\"text\":\"hello from fake codex\"}}'\n"
	if err := os.WriteFile(fakeCodexPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake codex: %v", err)
	}

	agentID := "test-agent-id"
	cfg := serveConfig{
		SecretSeed:              strings.Repeat("s", 32),
		AgentInternalAuthSecret: strings.Repeat("i", 32),
		AgentID:                 agentID,
		DefaultCodexModel:       "gpt-5.2",
		DatabasePath:            dbPath,
		WorkspacesDir:           tmpDir,
		RuntimeDir:              tmpDir,
		DefaultWorkingDir:       tmpDir,
	}

	st, err := newStore(dbPath, agentID)
	if err != nil {
		t.Fatalf("newStore: %v", err)
	}

	app := &server{
		cfg:   cfg,
		store: st,
		state: sessionstate.New(),
		http:  &http.Client{Timeout: 10 * time.Second},
		codex: &CodexCLI{Path: fakeCodexPath, Dir: tmpDir},
		pi:    &PiCLI{Path: fakeCodexPath, Dir: tmpDir},
	}
	return testServer{
		server:  httptest.NewServer(newServerRouter(app)),
		store:   st,
		root:    tmpDir,
		seed:    cfg.SecretSeed,
		agentID: cfg.AgentID,
	}
}

func (ts testServer) close() {
	ts.server.Close()
	_ = ts.store.Close()
}

func buildAuthToken(t *testing.T, secretSeed, sid, sub, agentID string) string {
	t.Helper()
	h := hmac.New(sha256.New, []byte(secretSeed))
	_, _ = h.Write([]byte("sandbox-agent:" + sid))
	secret := hex.EncodeToString(h.Sum(nil))
	claims := jwt.MapClaims{
		"sid":     sid,
		"sub":     sub,
		"typ":     "sandbox-agent",
		"agentId": agentID,
		"iat":     time.Now().Add(-5 * time.Second).Unix(),
		"exp":     time.Now().Add(5 * time.Minute).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}
	return signed
}

func TestAuthMissingToken(t *testing.T) {
	ts := newTestServer(t)
	defer ts.close()

	res, err := http.Post(ts.server.URL+"/session", "application/json", bytes.NewBufferString(`{"id":"1234567890abcdef1234567890abcdef"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.StatusCode)
	}
	var payload map[string]any
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode error payload: %v", err)
	}
	if int(payload["status"].(float64)) != http.StatusUnauthorized {
		t.Fatalf("expected status payload 401, got %#v", payload)
	}
}

func TestAuthInvalidToken(t *testing.T) {
	ts := newTestServer(t)
	defer ts.close()

	req, _ := http.NewRequest(http.MethodPost, ts.server.URL+"/session", bytes.NewBufferString(`{"id":"1234567890abcdef1234567890abcdef"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-Auth", "Bearer invalid.token.value")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.StatusCode)
	}
}

func TestSessionAndMessageLifecycle(t *testing.T) {
	ts := newTestServer(t)
	defer ts.close()

	sid := "sandbox-session"
	token := buildAuthToken(t, ts.seed, sid, "integration-user", ts.agentID)
	sessionID := "1234567890abcdef1234567890abcdef"

	createPayload := map[string]any{
		"id":      sessionID,
		"harness": "codex",
	}
	createBody, _ := json.Marshal(createPayload)
	req, _ := http.NewRequest(http.MethodPost, ts.server.URL+"/session", bytes.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-Auth", "Bearer "+token)
	createRes, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	defer createRes.Body.Close()
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", createRes.StatusCode)
	}

	messagePayload := map[string]any{
		"input": []map[string]any{{"type": "text", "text": "hello world"}},
	}
	messageBody, _ := json.Marshal(messagePayload)
	msgReq, _ := http.NewRequest(http.MethodPost, ts.server.URL+"/session/"+sessionID+"/message", bytes.NewReader(messageBody))
	msgReq.Header.Set("Content-Type", "application/json")
	msgReq.Header.Set("X-Agent-Auth", "Bearer "+token)
	msgRes, err := http.DefaultClient.Do(msgReq)
	if err != nil {
		t.Fatalf("start run: %v", err)
	}
	defer msgRes.Body.Close()
	if msgRes.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", msgRes.StatusCode)
	}
	var runResp map[string]any
	if err := json.NewDecoder(msgRes.Body).Decode(&runResp); err != nil {
		t.Fatalf("decode run response: %v", err)
	}
	if runResp["runId"] == nil || strings.TrimSpace(fmt.Sprintf("%v", runResp["runId"])) == "" {
		t.Fatalf("expected runId in response: %#v", runResp)
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		msgs, err := ts.store.getMessagesBySessionID(sessionID)
		if err != nil {
			t.Fatalf("get messages: %v", err)
		}
		if len(msgs) >= 2 {
			if msgs[0].TurnID == nil || strings.TrimSpace(*msgs[0].TurnID) == "" {
				t.Fatalf("expected first message turn id")
			}
			if msgs[1].TurnID == nil || *msgs[1].TurnID != *msgs[0].TurnID {
				t.Fatalf("expected assistant message to reuse turn id, got %#v then %#v", msgs[0].TurnID, msgs[1].TurnID)
			}
			body0, _ := msgs[0].Body.(map[string]any)
			if body0["type"] != "user_input" {
				t.Fatalf("expected first message user_input, got %#v", msgs[0].Body)
			}
			if msgs[0].CreatedBy == nil || *msgs[0].CreatedBy != "integration-user" {
				t.Fatalf("expected createdBy on user message, got %#v", msgs[0].CreatedBy)
			}
			session, err := ts.store.getSessionByID(sessionID)
			if err != nil {
				t.Fatalf("get session: %v", err)
			}
			if session == nil {
				t.Fatalf("session missing")
			}
			if session.FirstUserMessageBody == nil {
				t.Fatalf("firstUserMessageBody should be set")
			}
			if session.LastMessageBody == nil {
				t.Fatalf("lastMessageBody should be set")
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for assistant message; currently %d messages", len(msgs))
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestInternalAuthSessionAndMessageLifecycle(t *testing.T) {
	ts := newTestServer(t)
	defer ts.close()

	sessionID := "11111111111111111111111111111111"

	createPayload := map[string]any{
		"id":      sessionID,
		"harness": "codex",
	}
	createBody, _ := json.Marshal(createPayload)
	req, _ := http.NewRequest(http.MethodPost, ts.server.URL+"/session", bytes.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-Internal-Auth", strings.Repeat("i", 32))
	req.Header.Set("X-Actor-User-Id", "manager-user")
	createRes, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	defer createRes.Body.Close()
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", createRes.StatusCode)
	}

	messagePayload := map[string]any{
		"input": []map[string]any{{"type": "text", "text": "hello world"}},
	}
	messageBody, _ := json.Marshal(messagePayload)
	msgReq, _ := http.NewRequest(http.MethodPost, ts.server.URL+"/session/"+sessionID+"/message", bytes.NewReader(messageBody))
	msgReq.Header.Set("Content-Type", "application/json")
	msgReq.Header.Set("X-Agent-Internal-Auth", strings.Repeat("i", 32))
	msgReq.Header.Set("X-Actor-User-Id", "manager-user")
	msgRes, err := http.DefaultClient.Do(msgReq)
	if err != nil {
		t.Fatalf("start run: %v", err)
	}
	defer msgRes.Body.Close()
	if msgRes.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", msgRes.StatusCode)
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		msgs, err := ts.store.getMessagesBySessionID(sessionID)
		if err != nil {
			t.Fatalf("get messages: %v", err)
		}
		if len(msgs) >= 1 {
			if msgs[0].CreatedBy == nil || *msgs[0].CreatedBy != "manager-user" {
				t.Fatalf("expected createdBy on user message, got %#v", msgs[0].CreatedBy)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for user message; currently %d messages", len(msgs))
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestWorkspaceDiffAndFileContents(t *testing.T) {
	ts := newTestServer(t)
	defer ts.close()

	workspaceName := "repo1"
	workspaceRoot := filepath.Join(ts.root, workspaceName)
	if err := os.MkdirAll(workspaceRoot, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}
	cmd := exec.Command("git", "init")
	cmd.Dir = workspaceRoot
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init failed: %v (%s)", err, out)
	}
	filePath := filepath.Join(workspaceRoot, "hello.txt")
	if err := os.WriteFile(filePath, []byte("hello\\n"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	token := buildAuthToken(t, ts.seed, "sandbox-session", "integration-user", ts.agentID)
	authHeader := "Bearer " + token

	reqWorkspaces, _ := http.NewRequest(http.MethodGet, ts.server.URL+"/workspaces?includeStatus=true", nil)
	reqWorkspaces.Header.Set("X-Agent-Auth", authHeader)
	resWorkspaces, err := http.DefaultClient.Do(reqWorkspaces)
	if err != nil {
		t.Fatalf("get workspaces: %v", err)
	}
	defer resWorkspaces.Body.Close()
	if resWorkspaces.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resWorkspaces.StatusCode)
	}

	reqDiff, _ := http.NewRequest(http.MethodGet, ts.server.URL+"/workspaces/"+workspaceName+"/diff?basis=repo_head", nil)
	reqDiff.Header.Set("X-Agent-Auth", authHeader)
	resDiff, err := http.DefaultClient.Do(reqDiff)
	if err != nil {
		t.Fatalf("get diff: %v", err)
	}
	defer resDiff.Body.Close()
	if resDiff.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from diff, got %d", resDiff.StatusCode)
	}
	var diffBody map[string]any
	if err := json.NewDecoder(resDiff.Body).Decode(&diffBody); err != nil {
		t.Fatalf("decode diff: %v", err)
	}
	patch := fmt.Sprintf("%v", diffBody["patch"])
	if !strings.Contains(patch, "hello.txt") {
		t.Fatalf("expected patch to mention hello.txt, got: %s", patch)
	}

	reqFile, _ := http.NewRequest(http.MethodGet, ts.server.URL+"/workspaces/"+workspaceName+"/diff/file-contents?basis=repo_head&kind=untracked&path=hello.txt", nil)
	reqFile.Header.Set("X-Agent-Auth", authHeader)
	resFile, err := http.DefaultClient.Do(reqFile)
	if err != nil {
		t.Fatalf("get file contents: %v", err)
	}
	defer resFile.Body.Close()
	if resFile.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from file-contents, got %d", resFile.StatusCode)
	}
	var fileBody map[string]map[string]any
	if err := json.NewDecoder(resFile.Body).Decode(&fileBody); err != nil {
		t.Fatalf("decode file-contents: %v", err)
	}
	oldContents := fmt.Sprintf("%v", fileBody["oldFile"]["contents"])
	newContents := fmt.Sprintf("%v", fileBody["newFile"]["contents"])
	if oldContents != "" {
		t.Fatalf("expected empty old contents, got %q", oldContents)
	}
	if newContents != "hello\\n" {
		t.Fatalf("unexpected new contents: %q", newContents)
	}
}

func TestRunStreamBufferedReconnect(t *testing.T) {
	ts := newTestServer(t)
	defer ts.close()

	token := buildAuthToken(t, ts.seed, "sandbox-session", "integration-user", ts.agentID)
	sessionID := "abcdefabcdefabcdefabcdefabcdefab"

	createBody := bytes.NewBufferString(`{"id":"` + sessionID + `","harness":"codex"}`)
	createReq, _ := http.NewRequest(http.MethodPost, ts.server.URL+"/session", createBody)
	createReq.Header.Set("Content-Type", "application/json")
	createReq.Header.Set("X-Agent-Auth", "Bearer "+token)
	createRes, err := http.DefaultClient.Do(createReq)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	createRes.Body.Close()
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", createRes.StatusCode)
	}

	messageReqBody := bytes.NewBufferString(`{"input":[{"type":"text","text":"hello"}]}`)
	messageReq, _ := http.NewRequest(http.MethodPost, ts.server.URL+"/session/"+sessionID+"/message", messageReqBody)
	messageReq.Header.Set("Content-Type", "application/json")
	messageReq.Header.Set("X-Agent-Auth", "Bearer "+token)
	messageRes, err := http.DefaultClient.Do(messageReq)
	if err != nil {
		t.Fatalf("start run: %v", err)
	}
	if messageRes.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", messageRes.StatusCode)
	}
	var runPayload map[string]any
	if err := json.NewDecoder(messageRes.Body).Decode(&runPayload); err != nil {
		t.Fatalf("decode run payload: %v", err)
	}
	messageRes.Body.Close()

	runID := fmt.Sprintf("%v", runPayload["runId"])
	if strings.TrimSpace(runID) == "" {
		t.Fatalf("runId missing: %#v", runPayload)
	}

	time.Sleep(150 * time.Millisecond)

	runStreamReq, _ := http.NewRequest(http.MethodGet, ts.server.URL+"/session/"+sessionID+"/message/"+runID+"/stream", nil)
	runStreamReq.Header.Set("X-Agent-Auth", "Bearer "+token)
	runStreamRes, err := http.DefaultClient.Do(runStreamReq)
	if err != nil {
		t.Fatalf("open run stream: %v", err)
	}
	defer runStreamRes.Body.Close()
	if runStreamRes.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from run stream, got %d", runStreamRes.StatusCode)
	}
	payload, err := io.ReadAll(runStreamRes.Body)
	if err != nil {
		t.Fatalf("read run stream: %v", err)
	}
	text := string(payload)
	if !strings.Contains(text, "event: user_input") {
		t.Fatalf("expected buffered user_input event, got: %s", text)
	}
	if !strings.Contains(text, "event: status") {
		t.Fatalf("expected buffered status event, got: %s", text)
	}
}
