package agentgo

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
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

func loadSessionRow(t *testing.T, dbPath, sessionID string) sessionRow {
	t.Helper()
	db := sqliteOpenReadOnly(t, dbPath)
	defer db.Close()
	row := db.QueryRow(`
    SELECT lower(hex(id)), agent_id, created_by, status, harness, model, model_reasoning_effort, first_user_message_body, last_message_body
    FROM sessions WHERE lower(hex(id)) = lower(?)
  `, sessionID)
	var rec sessionRow
	if err := row.Scan(&rec.ID, &rec.AgentID, &rec.CreatedBy, &rec.Status, &rec.Harness, &rec.Model, &rec.ModelReasoningEffort, &rec.FirstUserMessageBody, &rec.LastMessageBody); err != nil {
		t.Fatalf("scan session row: %v", err)
	}
	return rec
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

	rec := loadSessionRow(t, srv.dbPath, sessionID)
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

func TestSessionAPIBlackbox_CreateSessionAllowsEmptyModelDefault(t *testing.T) {
	srv := startAgentGoServer(t)
	defer stopAgentGoServer(t, srv)

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", srv.secretSeed, srv.agentID)

	res := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{
		"id":                   sessionID,
		"harness":              "codex",
		"model":                "   ",
		"modelReasoningEffort": "medium",
	})
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", res.StatusCode)
	}

	rec := loadSessionRow(t, srv.dbPath, sessionID)
	if rec.Model == nil || *rec.Model != "gpt-5.2" {
		t.Fatalf("expected empty model override to persist as default gpt-5.2, got %+v", rec.Model)
	}
	if rec.ModelReasoningEffort == nil || *rec.ModelReasoningEffort != "medium" {
		t.Fatalf("expected effort medium, got %+v", rec.ModelReasoningEffort)
	}
}

func TestSessionAPIBlackbox_CreateSessionMaterializesConfiguredDefaults(t *testing.T) {
	srv := startAgentGoServer(t)
	defer stopAgentGoServer(t, srv)

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", srv.secretSeed, srv.agentID)

	res := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{
		"id":      sessionID,
		"harness": "codex",
	})
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", res.StatusCode)
	}

	rec := loadSessionRow(t, srv.dbPath, sessionID)
	if rec.Model == nil || *rec.Model != "gpt-5.2" {
		t.Fatalf("expected default model gpt-5.2, got %+v", rec.Model)
	}
	if rec.ModelReasoningEffort == nil || *rec.ModelReasoningEffort != "high" {
		t.Fatalf("expected default effort high, got %+v", rec.ModelReasoningEffort)
	}
}

func TestSessionAPIBlackbox_CreateSessionRejectsNonOpenAIModelForCodex(t *testing.T) {
	srv := startAgentGoServer(t)
	defer stopAgentGoServer(t, srv)

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", srv.secretSeed, srv.agentID)

	res := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{
		"id":      sessionID,
		"harness": "codex",
		"model":   "anthropic/claude-opus-4-6",
	})
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", res.StatusCode)
	}
}

func TestSessionAPIBlackbox_CreateSessionRejectsUnknownHarness(t *testing.T) {
	srv := startAgentGoServer(t)
	defer stopAgentGoServer(t, srv)

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", srv.secretSeed, srv.agentID)

	res := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{
		"id":      sessionID,
		"harness": "opencode",
	})
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", res.StatusCode)
	}

	payload := decodeJSON[map[string]any](t, res.Body)
	if !strings.Contains(fmt.Sprintf("%v", payload["error"]), "Invalid harness") {
		t.Fatalf("unexpected error payload: %#v", payload)
	}
}

func TestSessionAPIBlackbox_CreateSessionNormalizesPIModel(t *testing.T) {
	srv := startAgentGoServer(t)
	defer stopAgentGoServer(t, srv)

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", srv.secretSeed, srv.agentID)

	res := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{
		"id":      sessionID,
		"harness": "pi",
		"model":   "openai/gpt-5.2:high",
	})
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", res.StatusCode)
	}

	rec := loadSessionRow(t, srv.dbPath, sessionID)
	if rec.Model == nil || *rec.Model != "openai/gpt-5.2" {
		t.Fatalf("expected normalized pi model openai/gpt-5.2, got %+v", rec.Model)
	}
	if rec.ModelReasoningEffort == nil || *rec.ModelReasoningEffort != "high" {
		t.Fatalf("expected high effort, got %+v", rec.ModelReasoningEffort)
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

func TestSessionAPIBlackbox_UploadedImagePathReferencePersistsAsTextInput(t *testing.T) {
	srv := startAgentGoServer(t)
	defer stopAgentGoServer(t, srv)

	root := repoRoot(t)
	imagePath := filepath.Join(root, "agent-go", "static", "test_image.png")

	cases := []struct {
		name   string
		prompt string
	}{
		{
			name:   "bare path reference",
			prompt: "@~/uploaded/test_image.png",
		},
		{
			name:   "path reference with trailing text",
			prompt: "@~/uploaded/test_image.png what is in this image",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sessionID := newSessionID()
			auth := sandboxAuthHeader(t, sessionID, "integration-user", srv.secretSeed, srv.agentID)

			createRes := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{
				"id":      sessionID,
				"harness": "pi",
			})
			createRes.Body.Close()
			if createRes.StatusCode != http.StatusCreated {
				t.Fatalf("expected create 201, got %d", createRes.StatusCode)
			}

			displayPath := uploadFileForBlackboxTest(t, srv.baseURL, auth, imagePath)
			wantPrompt := strings.Replace(tc.prompt, "~/uploaded/test_image.png", displayPath, 1)

			runRes := httpJSON(t, http.MethodPost, srv.baseURL+"/session/"+sessionID+"/message", auth, map[string]any{
				"input": []map[string]any{
					{"type": "text", "text": wantPrompt},
				},
			})
			defer runRes.Body.Close()
			if runRes.StatusCode != http.StatusOK {
				t.Fatalf("expected run 200, got %d", runRes.StatusCode)
			}

			items := latestPersistedUserInputItems(t, srv.dbPath, sessionID)
			if len(items) != 1 {
				t.Fatalf("expected exactly 1 persisted input item, got %#v", items)
			}
			if typ, _ := items[0]["type"].(string); typ != "text" {
				t.Fatalf("expected persisted input type text, got %#v", items[0])
			}
			if text, _ := items[0]["text"].(string); text != wantPrompt {
				t.Fatalf("expected persisted text %q, got %#v", wantPrompt, items[0]["text"])
			}
			if _, ok := items[0]["path"]; ok {
				t.Fatalf("text input should not persist a path field: %#v", items[0])
			}
		})
	}
}

func uploadFileForBlackboxTest(t *testing.T, baseURL string, auth map[string]string, srcPath string) string {
	t.Helper()

	content, err := os.ReadFile(srcPath)
	if err != nil {
		t.Fatalf("read upload source %q: %v", srcPath, err)
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filepath.Base(srcPath))
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write upload content: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, baseURL+"/files/upload", &body)
	if err != nil {
		t.Fatalf("create upload request: %v", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	for key, value := range auth {
		req.Header.Set(key, value)
	}

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("upload file: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		payload, _ := io.ReadAll(res.Body)
		t.Fatalf("expected upload 201, got %d: %s", res.StatusCode, strings.TrimSpace(string(payload)))
	}

	payload := decodeJSON[map[string]any](t, res.Body)
	displayPath := strings.TrimSpace(fmt.Sprintf("%v", payload["displayPath"]))
	if displayPath == "" {
		t.Fatalf("expected upload displayPath, got %#v", payload)
	}
	return displayPath
}

func latestPersistedUserInputItems(t *testing.T, dbPath, sessionID string) []map[string]any {
	t.Helper()

	var items []map[string]any
	waitFor(t, 5*time.Second, func() error {
		db := sqliteOpenReadOnly(t, dbPath)
		defer db.Close()

		rows, err := db.Query(`SELECT body FROM messages WHERE session_id = ? ORDER BY created_at ASC`, sessionID)
		if err != nil {
			return err
		}
		defer rows.Close()

		var lastBody string
		for rows.Next() {
			var body string
			if err := rows.Scan(&body); err != nil {
				return err
			}
			if strings.Contains(body, `"type":"user_input"`) {
				lastBody = body
			}
		}
		if strings.TrimSpace(lastBody) == "" {
			return fmt.Errorf("missing persisted user_input message")
		}

		var decoded map[string]any
		if err := json.Unmarshal([]byte(lastBody), &decoded); err != nil {
			return fmt.Errorf("decode user_input body: %w", err)
		}
		rawInput, _ := decoded["input"].([]any)
		if len(rawInput) == 0 {
			return fmt.Errorf("persisted user_input missing input payload: %s", lastBody)
		}

		next := make([]map[string]any, 0, len(rawInput))
		for _, item := range rawInput {
			m, _ := item.(map[string]any)
			if m == nil {
				return fmt.Errorf("persisted user_input contains non-object input item: %s", lastBody)
			}
			next = append(next, m)
		}
		items = next
		return nil
	})

	return items
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

	rec := loadSessionRow(t, srv.dbPath, sessionID)
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

func TestSessionAPIBlackbox_MessageRunAllowsClearingModelOverride(t *testing.T) {
	srv := startAgentGoServer(t)
	defer stopAgentGoServer(t, srv)

	sessionID := newSessionID()
	auth := sandboxAuthHeader(t, sessionID, "integration-user", srv.secretSeed, srv.agentID)

	createRes := httpJSON(t, http.MethodPost, srv.baseURL+"/session", auth, map[string]any{
		"id":                   sessionID,
		"harness":              "codex",
		"model":                "gpt-5.2",
		"modelReasoningEffort": "high",
	})
	createRes.Body.Close()
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("expected create 201, got %d", createRes.StatusCode)
	}

	runRes := httpJSON(t, http.MethodPost, srv.baseURL+"/session/"+sessionID+"/message", auth, map[string]any{
		"input": []map[string]any{{"type": "text", "text": "Reply with exactly: ok"}},
		"model": "",
	})
	defer runRes.Body.Close()
	if runRes.StatusCode != http.StatusOK {
		t.Fatalf("expected run 200, got %d", runRes.StatusCode)
	}

	rec := loadSessionRow(t, srv.dbPath, sessionID)
	if rec.Model == nil || *rec.Model != "gpt-5.2" {
		t.Fatalf("expected cleared model override to materialize default gpt-5.2, got %+v", rec.Model)
	}
	if rec.ModelReasoningEffort == nil || *rec.ModelReasoningEffort != "high" {
		t.Fatalf("expected effort high to remain, got %+v", rec.ModelReasoningEffort)
	}
}

func TestSessionAPIBlackbox_MessageRunRejectsConflictingThinkingLevels(t *testing.T) {
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
		"input":                []map[string]any{{"type": "text", "text": "Reply with exactly: ok"}},
		"model":                "openai/gpt-5.2:high",
		"modelReasoningEffort": "medium",
	})
	defer runRes.Body.Close()
	if runRes.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected run 400, got %d", runRes.StatusCode)
	}

	rec := loadSessionRow(t, srv.dbPath, sessionID)
	if rec.Model == nil || *rec.Model != "openai/gpt-5.2" {
		t.Fatalf("expected conflicting request to preserve default pi model, got %+v", rec.Model)
	}
	if rec.ModelReasoningEffort == nil || *rec.ModelReasoningEffort != "high" {
		t.Fatalf("expected conflicting request to leave defaults unchanged, got %+v", rec)
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
