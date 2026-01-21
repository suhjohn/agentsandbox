package agentgo

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	_ "modernc.org/sqlite"
)

type cmdResult struct {
	ExitCode int
	Stdout   string
	Stderr   string
}

type runningServer struct {
	proc       *exec.Cmd
	baseURL    string
	dbPath     string
	secretSeed string
	tempDir    string
	agentID    string
}

type testSSEEvent struct {
	Event string
	Data  string
}

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("runtime.Caller failed")
	}
	current := filepath.Dir(file)
	for {
		if _, err := os.Stat(filepath.Join(current, "agent-go", "go.mod")); err == nil {
			return current
		}
		parent := filepath.Dir(current)
		if parent == current {
			t.Fatalf("failed to resolve repo root from %s", file)
		}
		current = parent
	}
}

func runCmd(t *testing.T, cmd []string, dir string, env []string, allowFail bool) cmdResult {
	t.Helper()
	if len(cmd) == 0 {
		t.Fatalf("empty command")
	}
	execCmd := exec.Command(cmd[0], cmd[1:]...)
	if dir != "" {
		execCmd.Dir = dir
	}
	if len(env) > 0 {
		execCmd.Env = append(os.Environ(), env...)
	}
	var stdout, stderr bytes.Buffer
	execCmd.Stdout = &stdout
	execCmd.Stderr = &stderr
	err := execCmd.Run()
	result := cmdResult{Stdout: stdout.String(), Stderr: stderr.String()}
	if err != nil {
		var exitErr *exec.ExitError
		if ok := errors.As(err, &exitErr); ok {
			result.ExitCode = exitErr.ExitCode()
		} else {
			result.ExitCode = -1
		}
		if !allowFail {
			t.Fatalf("command failed (%d): %s\nstdout:\n%s\nstderr:\n%s", result.ExitCode, strings.Join(cmd, " "), result.Stdout, result.Stderr)
		}
		return result
	}
	result.ExitCode = 0
	return result
}

func ensureDockerAgentServerBinary(t *testing.T, root string) string {
	t.Helper()
	relPath := filepath.Join("agent-go", "build-artifacts", "agent-server")
	absPath := filepath.Join(root, relPath)
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		t.Fatalf("mkdir build-artifacts: %v", err)
	}
	moduleDir := filepath.Join(root, "agent-go")
	runCmd(t, []string{"go", "build", "-trimpath", "-ldflags=-s -w", "-o", absPath, "./cmd/agent-go"}, moduleDir, []string{
		"CGO_ENABLED=0",
		"GOOS=linux",
		"GOARCH=" + runtime.GOARCH,
	}, false)
	return filepath.ToSlash(relPath)
}

func waitFor(t *testing.T, timeout time.Duration, fn func() error) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	var last error
	for time.Now().Before(deadline) {
		if err := fn(); err == nil {
			return
		} else {
			last = err
		}
		time.Sleep(100 * time.Millisecond)
	}
	if last != nil {
		t.Fatalf("waitFor timeout after %s: %v", timeout, last)
	}
	t.Fatalf("waitFor timeout after %s", timeout)
}

func getFreePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for free port: %v", err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func startAgentGoServer(t *testing.T) runningServer {
	t.Helper()
	root := repoRoot(t)
	moduleDir := filepath.Join(root, "agent-go")
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "agent.db")
	binaryPath := filepath.Join(tmpDir, "agent-server")
	fakeCodexPath := filepath.Join(tmpDir, "fake-codex")
	fakePiPath := filepath.Join(tmpDir, "fake-pi")
	port := getFreePort(t)
	secretSeed := strings.Repeat("s", 32)
	agentID := "test-agent-id"

	fakeCodex := "#!/usr/bin/env bash\n" +
		"set -euo pipefail\n" +
		"echo '{\"type\":\"item.completed\",\"thread_id\":\"thread-it-123\",\"item\":{\"type\":\"agent_message\",\"text\":\"ok\"}}'\n"
	if err := os.WriteFile(fakeCodexPath, []byte(fakeCodex), 0o755); err != nil {
		t.Fatalf("write fake codex: %v", err)
	}
	fakePi := "#!/usr/bin/env bash\n" +
		"set -euo pipefail\n" +
		"echo '{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"delta\":\"ok\"}}'\n" +
		"echo '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]}}'\n"
	if err := os.WriteFile(fakePiPath, []byte(fakePi), 0o755); err != nil {
		t.Fatalf("write fake pi: %v", err)
	}

	runCmd(t, []string{"go", "build", "-o", binaryPath, "./cmd/agent-go"}, moduleDir, nil, false)

	cmd := exec.Command(binaryPath, "serve")
	cmd.Dir = root
	cmd.Env = append(os.Environ(),
		"PORT="+strconv.Itoa(port),
		"DATABASE_PATH="+dbPath,
		"SECRET_SEED="+secretSeed,
		"AGENT_ID="+agentID,
		"DEFAULT_CODEX_MODEL=gpt-5.2",
		"CODEX_EXECUTABLE_PATH="+fakeCodexPath,
		"PI_EXECUTABLE_PATH="+fakePiPath,
		"WORKSPACES_DIR="+tmpDir,
		"ROOT_DIR="+tmpDir,
		"DEFAULT_WORKING_DIR="+tmpDir,
	)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		t.Fatalf("start agent-go server: %v", err)
	}

	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	waitFor(t, 20*time.Second, func() error {
		res, err := http.Get(baseURL + "/health")
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return fmt.Errorf("health status=%d", res.StatusCode)
		}
		return nil
	})

	return runningServer{
		proc:       cmd,
		baseURL:    baseURL,
		dbPath:     dbPath,
		secretSeed: secretSeed,
		tempDir:    tmpDir,
		agentID:    agentID,
	}
}

func stopAgentGoServer(t *testing.T, srv runningServer) {
	t.Helper()
	if srv.proc == nil || srv.proc.Process == nil {
		return
	}
	_ = srv.proc.Process.Kill()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.proc.Process.Signal(os.Interrupt)
	done := make(chan struct{})
	go func() {
		_, _ = srv.proc.Process.Wait()
		close(done)
	}()
	select {
	case <-ctx.Done():
		_ = srv.proc.Process.Kill()
	case <-done:
	}
}

func sandboxAuthHeader(t *testing.T, sid, sub, secretSeed, agentID string) map[string]string {
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
		t.Fatalf("sign token: %v", err)
	}
	return map[string]string{"X-Agent-Auth": "Bearer " + signed}
}

func newSessionID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return hex.EncodeToString(buf)
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal json: %v", err)
	}
	return data
}

func httpJSON(t *testing.T, method, url string, headers map[string]string, payload any) *http.Response {
	t.Helper()
	var body io.Reader
	if payload != nil {
		body = bytes.NewReader(mustJSON(t, payload))
	}
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("http request failed: %v", err)
	}
	return res
}

func decodeJSON[T any](t *testing.T, r io.Reader) T {
	t.Helper()
	var out T
	if err := json.NewDecoder(r).Decode(&out); err != nil {
		t.Fatalf("decode json: %v", err)
	}
	return out
}

func sqliteOpenReadOnly(t *testing.T, dbPath string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	return db
}

func parseHostPort(t *testing.T, dockerPortOutput string) int {
	t.Helper()
	trimmed := strings.TrimSpace(dockerPortOutput)
	idx := strings.LastIndex(trimmed, ":")
	if idx < 0 || idx+1 >= len(trimmed) {
		t.Fatalf("failed to parse docker port: %q", dockerPortOutput)
	}
	port, err := strconv.Atoi(strings.TrimSpace(trimmed[idx+1:]))
	if err != nil {
		t.Fatalf("invalid docker port output %q: %v", dockerPortOutput, err)
	}
	return port
}

func dockerAvailable() bool {
	cmd := exec.Command("docker", "version")
	return cmd.Run() == nil
}

func readSSEUntil(t *testing.T, reader *bufio.Reader, timeout time.Duration, predicate func(testSSEEvent) bool) testSSEEvent {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		frame, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				time.Sleep(50 * time.Millisecond)
				continue
			}
			t.Fatalf("read sse: %v", err)
		}
		if !strings.HasPrefix(frame, "event:") {
			continue
		}
		eventName := strings.TrimSpace(strings.TrimPrefix(frame, "event:"))
		dataLine, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("read sse data: %v", err)
		}
		data := ""
		if strings.HasPrefix(dataLine, "data:") {
			data = strings.TrimSpace(strings.TrimPrefix(dataLine, "data:"))
		}
		_, _ = reader.ReadString('\n')
		evt := testSSEEvent{Event: eventName, Data: data}
		if predicate(evt) {
			return evt
		}
	}
	t.Fatalf("timed out waiting for sse event after %s", timeout)
	return testSSEEvent{}
}

func envBool(name string) bool {
	v := strings.TrimSpace(os.Getenv(name))
	return v == "1" || strings.EqualFold(v, "true")
}
