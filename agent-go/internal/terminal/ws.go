package terminal

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

const (
	keepAliveInterval = 25 * time.Second
	keepAlivePayload  = "\x1b[0m"
	clearScreen       = "\x1b[2J\x1b[H"
	defaultCols       = 80
	defaultRows       = 24
)

type resizeMessage struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func HandleWS(
	w http.ResponseWriter,
	r *http.Request,
	workingDir string,
	isAllowedOrigin func(string) bool,
) error {
	requestedSubprotocols := websocket.Subprotocols(r)
	upgrader := websocket.Upgrader{
		CheckOrigin: func(req *http.Request) bool {
			origin := strings.TrimSpace(req.Header.Get("Origin"))
			if origin == "" || isAllowedOrigin == nil {
				return false
			}
			return isAllowedOrigin(origin)
		},
		Subprotocols: requestedSubprotocols,
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return nil
	}

	cmd := exec.Command("bash", "-lc", "export TERM=xterm-256color; exec bash -i")
	cmd.Dir = workingDir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{
		Cols: defaultCols,
		Rows: defaultRows,
	})
	if err != nil {
		_ = conn.Close()
		return nil
	}

	var closeOnce sync.Once
	closeAll := func() {
		closeOnce.Do(func() {
			_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "Terminal exited"), time.Now().Add(time.Second))
			_ = conn.Close()
			_, _ = ptmx.Write([]byte("exit\n"))
			_ = ptmx.Close()
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
		})
	}

	_ = conn.WriteMessage(websocket.TextMessage, []byte(clearScreen))

	ticker := time.NewTicker(keepAliveInterval)
	go func() {
		defer ticker.Stop()
		for range ticker.C {
			if err := conn.WriteMessage(websocket.TextMessage, []byte(keepAlivePayload)); err != nil {
				closeAll()
				return
			}
		}
	}()

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				closeAll()
				return
			}
			if n <= 0 {
				continue
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, append([]byte(nil), buf[:n]...)); err != nil {
				closeAll()
				return
			}
		}
	}()

	go func() {
		_ = cmd.Wait()
		closeAll()
	}()

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			closeAll()
			return nil
		}

		if messageType == websocket.TextMessage || messageType == websocket.BinaryMessage {
			if resize, ok := parseResizeMessage(payload); ok {
				_ = pty.Setsize(ptmx, &pty.Winsize{Cols: uint16(resize.Cols), Rows: uint16(resize.Rows)})
				continue
			}
			if len(payload) > 0 {
				if _, err := ptmx.Write(payload); err != nil {
					closeAll()
					return nil
				}
			}
		}
	}
}

func parseResizeMessage(payload []byte) (resizeMessage, bool) {
	text := strings.TrimSpace(string(payload))
	if !strings.HasPrefix(text, "{") {
		return resizeMessage{}, false
	}
	var msg resizeMessage
	if err := json.Unmarshal([]byte(text), &msg); err != nil {
		return resizeMessage{}, false
	}
	if msg.Type != "resize" || msg.Cols < 2 || msg.Rows < 2 {
		return resizeMessage{}, false
	}
	return msg, true
}

func WorkingDir(defaultWorkingDir, workspacesDir string) string {
	if v := strings.TrimSpace(defaultWorkingDir); v != "" {
		return v
	}
	if v := strings.TrimSpace(workspacesDir); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("AGENT_HOME")); v != "" {
		return fmt.Sprintf("%s/workspaces", strings.TrimRight(v, "/"))
	}
	return "/home/agent/workspaces"
}
