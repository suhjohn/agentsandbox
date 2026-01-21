package agentgo

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type sessionRow struct {
	ID                   string
	AgentID              string
	CreatedBy            string
	Status               string
	Harness              string
	Model                *string
	ModelReasoningEffort *string
	FirstUserMessageBody *string
	LastMessageBody      *string
}

type messageRow struct {
	CreatedBy *string
	Body      string
}

func TestSessionAPIBlackbox_CreateSessionPersists(t *testing.T) {
	srv := startAgentGoServer(t)
	defer stopAgentGoServer(t, srv)

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", srv.secretSeed, srv.agentID)

	res := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{
		"id":                   sessionID,
		"harness":              "codex",
		"model":                "gpt-5.2",
		"modelReasoningEffort": "medium",
	})
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", res.StatusCode)
	}
	created := decodeJSON[map[string]any](t, res.Body)
	if fmt.Sprintf("%v", created["id"]) != sessionID {
		t.Fatalf("unexpected id: %#v", created)
	}
	if fmt.Sprintf("%v", created["harness"]) != "codex" {
		t.Fatalf("unexpected harness: %#v", created)
	}
	if fmt.Sprintf("%v", created["createdBy"]) != "integration-user" {
		t.Fatalf("unexpected createdBy: %#v", created)
	}

	db := sqliteOpenReadOnly(t, srv.dbPath)
	defer db.Close()
	row := db.QueryRow(`
    SELECT lower(hex(id)), agent_id, created_by, status, harness, model, model_reasoning_effort, first_user_message_body, last_message_body
    FROM sessions WHERE lower(hex(id)) = lower(?)
  `, sessionID)
	var rec sessionRow
	if err := row.Scan(&rec.ID, &rec.AgentID, &rec.CreatedBy, &rec.Status, &rec.Harness, &rec.Model, &rec.ModelReasoningEffort, &rec.FirstUserMessageBody, &rec.LastMessageBody); err != nil {
		t.Fatalf("scan session row: %v", err)
	}
	if rec.CreatedBy != "integration-user" || rec.Harness != "codex" {
		t.Fatalf("unexpected db session row: %+v", rec)
	}
	if rec.Model == nil || *rec.Model != "gpt-5.2" {
		t.Fatalf("expected model gpt-5.2, got %+v", rec.Model)
	}
	if rec.ModelReasoningEffort == nil || *rec.ModelReasoningEffort != "medium" {
		t.Fatalf("expected effort medium, got %+v", rec.ModelReasoningEffort)
	}
	if rec.FirstUserMessageBody != nil || rec.LastMessageBody != nil {
		t.Fatalf("expected null first/last message bodies, got first=%v last=%v", rec.FirstUserMessageBody, rec.LastMessageBody)
	}
}

func TestSessionAPIBlackbox_RejectHarnessChange(t *testing.T) {
	srv := startAgentGoServer(t)
	defer stopAgentGoServer(t, srv)

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", srv.secretSeed, srv.agentID)

	createRes := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{"id": sessionID, "harness": "codex"})
	createRes.Body.Close()
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("expected create 201, got %d", createRes.StatusCode)
	}

	conflictRes := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{"id": sessionID, "harness": "pi"})
	defer conflictRes.Body.Close()
	if conflictRes.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409, got %d", conflictRes.StatusCode)
	}
	payload := decodeJSON[map[string]any](t, conflictRes.Body)
	if !strings.Contains(fmt.Sprintf("%v", payload["error"]), "harness cannot be modified") {
		t.Fatalf("unexpected error payload: %#v", payload)
	}
}

func TestSessionAPIBlackbox_ImageInputPersistsAndWritesFile(t *testing.T) {
	srv := startAgentGoServer(t)
	defer stopAgentGoServer(t, srv)

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", srv.secretSeed, srv.agentID)

	createRes := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{"id": sessionID, "harness": "codex"})
	createRes.Body.Close()
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("expected create 201, got %d", createRes.StatusCode)
	}

	root := repoRoot(t)
	imagePath := filepath.Join(root, "agent-go", "static", "test_image.png")
	raw, err := os.ReadFile(imagePath)
	if err != nil {
		t.Fatalf("read test_image.png: %v", err)
	}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(raw)

	runRes := httpJSON(t, http.MethodPost, srv.baseURL+"/session/"+sessionID+"/message", auth, map[string]any{
		"input": []map[string]any{
			{"type": "image", "data": dataURL},
			{"type": "text", "text": "Describe this image."},
		},
	})
	defer runRes.Body.Close()
	if runRes.StatusCode != http.StatusOK {
		t.Fatalf("expected run 200, got %d", runRes.StatusCode)
	}

	var persistedPath string
	waitFor(t, 5*time.Second, func() error {
		db := sqliteOpenReadOnly(t, srv.dbPath)
		defer db.Close()
		rows, err := db.Query(`SELECT body FROM messages WHERE session_id = ? ORDER BY created_at ASC`, sessionID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var body string
			if err := rows.Scan(&body); err != nil {
				return err
			}
			if !strings.Contains(body, `"type":"user_input"`) {
				continue
			}
			var decoded map[string]any
			if err := json.Unmarshal([]byte(body), &decoded); err != nil {
				return fmt.Errorf("decode user_input body: %w", err)
			}
			input, _ := decoded["input"].([]any)
			for _, item := range input {
				m, _ := item.(map[string]any)
				if m == nil {
					continue
				}
				if typ, _ := m["type"].(string); typ != "local_image" {
					continue
				}
				if p, _ := m["path"].(string); strings.TrimSpace(p) != "" {
					persistedPath = strings.TrimSpace(p)
					return nil
				}
			}
			return fmt.Errorf("user_input missing local_image.path: %s", body)
		}
		return fmt.Errorf("missing persisted user_input message")
	})

	wantPrefix := filepath.Join(srv.tempDir, "runtime", "api-images", sessionID) + string(os.PathSeparator)
	if !strings.HasPrefix(persistedPath, wantPrefix) {
		t.Fatalf("unexpected persisted image path: got=%q want prefix=%q", persistedPath, wantPrefix)
	}
	info, err := os.Stat(persistedPath)
	if err != nil {
		t.Fatalf("stat persisted image: %v", err)
	}
	if info.Size() == 0 {
		t.Fatalf("persisted image is empty: %q", persistedPath)
	}
	data, err := os.ReadFile(persistedPath)
	if err != nil {
		t.Fatalf("read persisted image: %v", err)
	}
	if len(data) < 8 || string(data[:8]) != "\x89PNG\r\n\x1a\n" {
		t.Fatalf("persisted image does not look like a PNG: %q", persistedPath)
	}
}

func TestSessionAPIBlackbox_MessageRunPersistsFields(t *testing.T) {
	srv := startAgentGoServer(t)
	defer stopAgentGoServer(t, srv)

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", srv.secretSeed, srv.agentID)

	createRes := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{"id": sessionID, "harness": "codex"})
	createRes.Body.Close()
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("expected create 201, got %d", createRes.StatusCode)
	}

	runRes := httpJSON(t, http.MethodPost, srv.baseURL+"/session/"+sessionID+"/message", auth, map[string]any{
		"input":                []map[string]any{{"type": "text", "text": "Reply with exactly: ok"}},
		"model":                "gpt-5.2",
		"modelReasoningEffort": "high",
	})
	defer runRes.Body.Close()
	if runRes.StatusCode != http.StatusOK {
		t.Fatalf("expected run 200, got %d", runRes.StatusCode)
	}
	runBody := decodeJSON[map[string]any](t, runRes.Body)
	if fmt.Sprintf("%v", runBody["success"]) != "true" {
		t.Fatalf("expected success=true, got %#v", runBody)
	}
	runID := fmt.Sprintf("%v", runBody["runId"])
	if len(runID) != 32 {
		t.Fatalf("expected 32-char runId, got %q", runID)
	}

	waitFor(t, 5*time.Second, func() error {
		db := sqliteOpenReadOnly(t, srv.dbPath)
		defer db.Close()
		rows, err := db.Query(`SELECT body FROM messages WHERE session_id = ? ORDER BY created_at ASC`, sessionID)
		if err != nil {
			return err
		}
		defer rows.Close()
		foundProviderEvent := false
		for rows.Next() {
			var body string
			if err := rows.Scan(&body); err != nil {
				return err
			}
			if strings.Contains(body, `"type":"item.completed"`) {
				foundProviderEvent = true
			}
		}
		if !foundProviderEvent {
			return fmt.Errorf("missing item.completed event")
		}
		return nil
	})

	db := sqliteOpenReadOnly(t, srv.dbPath)
	defer db.Close()

	rows, err := db.Query(`SELECT created_by, body FROM messages WHERE session_id = ? ORDER BY created_at ASC`, sessionID)
	if err != nil {
		t.Fatalf("query messages: %v", err)
	}
	defer rows.Close()
	messages := []messageRow{}
	for rows.Next() {
		var row messageRow
		if err := rows.Scan(&row.CreatedBy, &row.Body); err != nil {
			t.Fatalf("scan message row: %v", err)
		}
		messages = append(messages, row)
	}
	if len(messages) == 0 {
		t.Fatalf("expected at least one message row")
	}
	foundUserInput := false
	foundProviderEvent := false
	for _, m := range messages {
		if strings.Contains(m.Body, `"type":"user_input"`) {
			foundUserInput = true
			if m.CreatedBy == nil || *m.CreatedBy != "integration-user" {
				t.Fatalf("expected created_by integration-user on user_input row, got %v", m.CreatedBy)
			}
		}
		if strings.Contains(m.Body, `"type":"item.completed"`) {
			foundProviderEvent = true
		}
	}
	if !foundUserInput {
		t.Fatalf("expected persisted user_input message: %#v", messages)
	}
	if !foundProviderEvent {
		t.Fatalf("expected persisted provider event item.completed: %#v", messages)
	}

	var rec sessionRow
	row := db.QueryRow(`
    SELECT lower(hex(id)), agent_id, created_by, status, harness, model, model_reasoning_effort, first_user_message_body, last_message_body
    FROM sessions WHERE lower(hex(id)) = lower(?)
  `, sessionID)
	if err := row.Scan(&rec.ID, &rec.AgentID, &rec.CreatedBy, &rec.Status, &rec.Harness, &rec.Model, &rec.ModelReasoningEffort, &rec.FirstUserMessageBody, &rec.LastMessageBody); err != nil {
		t.Fatalf("scan session row: %v", err)
	}
	if rec.Model == nil || *rec.Model != "gpt-5.2" {
		t.Fatalf("expected session model gpt-5.2, got %+v", rec.Model)
	}
	if rec.ModelReasoningEffort == nil || *rec.ModelReasoningEffort != "high" {
		t.Fatalf("expected modelReasoningEffort high, got %+v", rec.ModelReasoningEffort)
	}
	if rec.FirstUserMessageBody == nil || !strings.Contains(*rec.FirstUserMessageBody, `"type":"user_input"`) {
		t.Fatalf("expected first_user_message_body user_input, got %v", rec.FirstUserMessageBody)
	}
	if rec.LastMessageBody == nil || !strings.Contains(*rec.LastMessageBody, `"type":"item.completed"`) {
		t.Fatalf("expected last_message_body item.completed, got %v", rec.LastMessageBody)
	}
	if rec.Status != "initial" && rec.Status != "processing" {
		t.Fatalf("expected status initial|processing, got %q", rec.Status)
	}

	streamRes := httpJSON(t, http.MethodGet, srv.baseURL+"/session/"+sessionID+"/message/"+runID+"/stream", auth, nil)
	defer streamRes.Body.Close()
	if streamRes.StatusCode != http.StatusOK {
		t.Fatalf("expected stream 200, got %d", streamRes.StatusCode)
	}
	if ct := streamRes.Header.Get("Content-Type"); !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("expected SSE content-type, got %q", ct)
	}
}

func TestSessionAPIBlackbox_PIProviderEventsPersisted(t *testing.T) {
	srv := startAgentGoServer(t)
	defer stopAgentGoServer(t, srv)

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", srv.secretSeed, srv.agentID)

	createRes := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{"id": sessionID, "harness": "pi"})
	createRes.Body.Close()
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("expected create 201, got %d", createRes.StatusCode)
	}

	runRes := httpJSON(t, http.MethodPost, srv.baseURL+"/session/"+sessionID+"/message", auth, map[string]any{
		"input": []map[string]any{{"type": "text", "text": "Reply with exactly: ok"}},
	})
	defer runRes.Body.Close()
	if runRes.StatusCode != http.StatusOK {
		t.Fatalf("expected run 200, got %d", runRes.StatusCode)
	}

	waitFor(t, 5*time.Second, func() error {
		db := sqliteOpenReadOnly(t, srv.dbPath)
		defer db.Close()
		rows, err := db.Query(`SELECT body FROM messages WHERE session_id = ? ORDER BY created_at ASC`, sessionID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var body string
			if err := rows.Scan(&body); err != nil {
				return err
			}
			if strings.Contains(body, `"type":"message_end"`) {
				return nil
			}
		}
		return fmt.Errorf("missing message_end event")
	})
}
