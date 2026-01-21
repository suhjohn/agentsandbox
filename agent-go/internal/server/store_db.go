package server

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type store struct {
	db            *sql.DB
	agentID       string
	turnMu        sync.Mutex
	sessionTurnID map[string]string
}

func newStore(path string, agentID string) (*store, error) {
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return nil, errors.New("agentID is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil && filepath.Dir(path) != "." {
		return nil, fmt.Errorf("create db dir: %w", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	queries := []string{
		`PRAGMA journal_mode = WAL;`,
		// We persist `agent_id` on both sessions and messages so multiple agent SQLite DBs can be merged
		// by simple concatenation/UNION while still allowing trivial per-agent filtering.
		`CREATE TABLE IF NOT EXISTS sessions (
	      id BLOB PRIMARY KEY,
	      agent_id TEXT NOT NULL,
	      created_by TEXT NOT NULL DEFAULT 'unknown',
	      status TEXT NOT NULL DEFAULT 'initial',
      harness TEXT NOT NULL DEFAULT 'codex',
      external_session_id TEXT,
      title TEXT,
      first_user_message_body TEXT,
      last_message_body TEXT,
      model TEXT,
      model_reasoning_effort TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_harness ON sessions(harness);`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_external_session_id ON sessions(external_session_id);`,
		`CREATE TABLE IF NOT EXISTS messages (
	      id BLOB PRIMARY KEY,
	      agent_id TEXT NOT NULL,
	      session_id TEXT NOT NULL,
      turn_id TEXT,
      created_by TEXT,
      body TEXT NOT NULL,
      embeddings BLOB,
      created_at TEXT NOT NULL
    );`,
		`CREATE INDEX IF NOT EXISTS idx_messages_agent_id ON messages(agent_id);`,
		`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);`,
		`CREATE INDEX IF NOT EXISTS idx_messages_turn_id ON messages(turn_id);`,
		`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      query_json TEXT,
      headers_json TEXT,
      body_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      processed_at TEXT
    );`,
		`CREATE INDEX IF NOT EXISTS idx_events_status_available ON events(status, available_at, created_at);`,
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			db.Close()
			return nil, err
		}
	}
	if err := ensureSessionColumns(db); err != nil {
		db.Close()
		return nil, err
	}
	if err := ensureMessageColumns(db); err != nil {
		db.Close()
		return nil, err
	}
	if err := ensureEventColumns(db); err != nil {
		db.Close()
		return nil, err
	}
	return &store{
		db:            db,
		agentID:       agentID,
		sessionTurnID: map[string]string{},
	}, nil
}

func (s *store) Close() error { return s.db.Close() }

func (s *store) withTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func ensureSessionColumns(db *sql.DB) error {
	columns, err := readTableColumns(db, "sessions")
	if err != nil {
		return err
	}
	changes := []string{}
	if !columns["harness"] {
		changes = append(changes, "ALTER TABLE sessions ADD COLUMN harness TEXT NOT NULL DEFAULT 'codex'")
	}
	if !columns["created_by"] {
		changes = append(changes, "ALTER TABLE sessions ADD COLUMN created_by TEXT NOT NULL DEFAULT 'unknown'")
	}
	if !columns["status"] {
		changes = append(changes, "ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'initial'")
	}
	if !columns["title"] {
		changes = append(changes, "ALTER TABLE sessions ADD COLUMN title TEXT")
	}
	if !columns["first_user_message_body"] {
		changes = append(changes, "ALTER TABLE sessions ADD COLUMN first_user_message_body TEXT")
	}
	if !columns["last_message_body"] {
		changes = append(changes, "ALTER TABLE sessions ADD COLUMN last_message_body TEXT")
	}
	if !columns["model"] {
		changes = append(changes, "ALTER TABLE sessions ADD COLUMN model TEXT")
	}
	if !columns["model_reasoning_effort"] {
		changes = append(changes, "ALTER TABLE sessions ADD COLUMN model_reasoning_effort TEXT")
	}
	for _, sqlText := range changes {
		if _, err := db.Exec(sqlText); err != nil {
			return err
		}
	}

	columns, err = readTableColumns(db, "sessions")
	if err != nil {
		return err
	}
	if columns["type"] {
		return migrateDropSessionsTypeColumn(db, columns)
	}
	return nil
}

func migrateDropSessionsTypeColumn(db *sql.DB, columns map[string]bool) error {
	required := []string{
		"id", "agent_id", "created_by", "harness", "status", "type",
		"external_session_id", "title", "first_user_message_body", "last_message_body",
		"model", "model_reasoning_effort", "created_at", "updated_at",
	}
	for _, name := range required {
		if !columns[name] {
			return nil
		}
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmts := []string{
		`DROP TABLE IF EXISTS sessions_new;`,
		`CREATE TABLE IF NOT EXISTS sessions_new (
      id BLOB PRIMARY KEY,
      agent_id TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'unknown',
      status TEXT NOT NULL DEFAULT 'initial',
      harness TEXT NOT NULL DEFAULT 'codex',
      external_session_id TEXT,
      title TEXT,
      first_user_message_body TEXT,
      last_message_body TEXT,
      model TEXT,
      model_reasoning_effort TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
		`INSERT INTO sessions_new (
      id, agent_id, created_by, status, harness, external_session_id,
      title, first_user_message_body, last_message_body, model,
      model_reasoning_effort, created_at, updated_at
    )
    SELECT
      id, agent_id, created_by, status, harness, external_session_id,
      title, first_user_message_body, last_message_body, model,
      model_reasoning_effort, created_at, updated_at
    FROM sessions;`,
		`DROP TABLE sessions;`,
		`ALTER TABLE sessions_new RENAME TO sessions;`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_harness ON sessions(harness);`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_external_session_id ON sessions(external_session_id);`,
	}
	for _, sqlText := range stmts {
		if _, err := tx.Exec(sqlText); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func ensureMessageColumns(db *sql.DB) error {
	columns, err := readTableColumns(db, "messages")
	if err != nil {
		return err
	}
	if !columns["turn_id"] {
		if _, err := db.Exec("ALTER TABLE messages ADD COLUMN turn_id TEXT"); err != nil {
			return err
		}
	}
	if !columns["created_by"] {
		if _, err := db.Exec("ALTER TABLE messages ADD COLUMN created_by TEXT"); err != nil {
			return err
		}
	}
	_, err = db.Exec("CREATE INDEX IF NOT EXISTS idx_messages_turn_id ON messages(turn_id)")
	return err
}

func ensureEventColumns(db *sql.DB) error {
	columns, err := readTableColumns(db, "events")
	if err != nil {
		return err
	}
	if !columns["id"] {
		_, err := db.Exec(`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      query_json TEXT,
      headers_json TEXT,
      body_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    );`)
		if err != nil {
			return err
		}
	}
	_, err = db.Exec("CREATE INDEX IF NOT EXISTS idx_events_status_available ON events(status, available_at, created_at)")
	return err
}

func readTableColumns(db *sql.DB, table string) (map[string]bool, error) {
	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info('%s')", table))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var cid int
		var name string
		var colType string
		var notNull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dflt, &pk); err != nil {
			return nil, err
		}
		out[name] = true
	}
	return out, rows.Err()
}

type createSessionInput struct {
	ID                   string  `json:"id"`
	Harness              string  `json:"harness"`
	Title                *string `json:"title"`
	Model                *string `json:"model"`
	ModelReasoningEffort string  `json:"modelReasoningEffort"`
}

type sessionRecord struct {
	ID                   string  `json:"id"`
	AgentID              string  `json:"agentId"`
	CreatedBy            string  `json:"createdBy"`
	Status               string  `json:"status"`
	Harness              string  `json:"harness"`
	ExternalSessionID    *string `json:"externalSessionId"`
	Title                *string `json:"title"`
	FirstUserMessageBody any     `json:"firstUserMessageBody"`
	LastMessageBody      any     `json:"lastMessageBody"`
	Model                *string `json:"model,omitempty"`
	ModelReasoningEffort *string `json:"modelReasoningEffort,omitempty"`
	CreatedAt            string  `json:"createdAt"`
	UpdatedAt            string  `json:"updatedAt"`
}

func (s *store) createSession(input createSessionInput, createdBy string) (*sessionRecord, error) {
	return s.createSessionCtx(context.Background(), input, createdBy)
}

func (s *store) createSessionCtx(ctx context.Context, input createSessionInput, createdBy string) (*sessionRecord, error) {
	if input.ID != "" {
		existing, err := s.getSessionByIDCtx(ctx, strings.ToLower(input.ID))
		if err != nil {
			return nil, err
		}
		if existing != nil {
			return existing, nil
		}
	}

	idHex := strings.ToLower(input.ID)
	if idHex == "" {
		idHex = randomHex(16)
	}
	idBytes, err := hex.DecodeString(idHex)
	if err != nil {
		return nil, fail(http.StatusBadRequest, "Invalid session ID format")
	}

	createdAt := nowISO()
	updatedAt := createdAt
	title := nullableString(input.Title)
	model := nullableString(input.Model)
	effort := nullableString(trimMaybe(input.ModelReasoningEffort))

	_, err = s.db.ExecContext(ctx, `
	    INSERT INTO sessions (
	      id, agent_id, created_by, status, harness, external_session_id,
	      title, first_user_message_body, last_message_body,
	      model, model_reasoning_effort, created_at, updated_at
	    ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?)
	  `,
		idBytes,
		s.agentID,
		fallback(createdBy, "unknown"),
		"initial",
		fallback(input.Harness, "codex"),
		title,
		model,
		effort,
		createdAt,
		updatedAt,
	)
	if err != nil {
		return nil, err
	}
	return s.getSessionByIDCtx(ctx, idHex)
}

func (s *store) getSessionByID(id string) (*sessionRecord, error) {
	return s.getSessionByIDCtx(context.Background(), id)
}

func (s *store) getSessionByIDCtx(ctx context.Context, id string) (*sessionRecord, error) {
	row := s.db.QueryRowContext(ctx, `
	    SELECT
	      lower(hex(id)) as id,
	      agent_id,
	      created_by,
	      status,
	      harness,
	      external_session_id,
	      title,
	      first_user_message_body,
	      last_message_body,
	      model,
	      model_reasoning_effort,
	      created_at,
	      updated_at
	    FROM sessions
	    WHERE lower(hex(id)) = lower(?)
	      AND agent_id = ?
	  `, id, s.agentID)

	var rec sessionRecord
	var external sql.NullString
	var title sql.NullString
	var first sql.NullString
	var last sql.NullString
	var model sql.NullString
	var effort sql.NullString
	if err := row.Scan(
		&rec.ID,
		&rec.AgentID,
		&rec.CreatedBy,
		&rec.Status,
		&rec.Harness,
		&external,
		&title,
		&first,
		&last,
		&model,
		&effort,
		&rec.CreatedAt,
		&rec.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	rec.ExternalSessionID = nullStringPtr(external)
	rec.Title = nullStringPtr(title)
	rec.FirstUserMessageBody = parseJSONMaybe(first)
	rec.LastMessageBody = parseJSONMaybe(last)
	rec.Model = nullStringPtr(model)
	rec.ModelReasoningEffort = nullStringPtr(effort)
	return &rec, nil
}

type sessionCursor struct {
	UpdatedAt string `json:"updatedAt"`
	ID        string `json:"id"`
}

func encodeCursor(c sessionCursor) string {
	data, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(data)
}

func decodeCursor(raw string) (sessionCursor, error) {
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return sessionCursor{}, err
	}
	var c sessionCursor
	if err := json.Unmarshal(data, &c); err != nil {
		return sessionCursor{}, err
	}
	if strings.TrimSpace(c.UpdatedAt) == "" || !sessionIDRegex.MatchString(c.ID) {
		return sessionCursor{}, errors.New("invalid cursor")
	}
	c.ID = strings.ToLower(c.ID)
	return c, nil
}

func (s *store) listSessionsPage(limit int, cursor *sessionCursor, query string) ([]*sessionRecord, error) {
	return s.listSessionsPageCtx(context.Background(), limit, cursor, query)
}

func (s *store) listSessionsPageCtx(ctx context.Context, limit int, cursor *sessionCursor, query string) ([]*sessionRecord, error) {
	conditions := []string{"agent_id = ?"}
	params := []any{s.agentID}

	if query = strings.TrimSpace(query); query != "" {
		conditions = append(conditions, "(hex(id) LIKE ? OR external_session_id LIKE ?)")
		params = append(params, strings.ToUpper(query)+"%", "%"+query+"%")
	}
	if cursor != nil {
		idBytes, _ := hex.DecodeString(cursor.ID)
		conditions = append(conditions, "((updated_at < ?) OR (updated_at = ? AND id < ?))")
		params = append(params, cursor.UpdatedAt, cursor.UpdatedAt, idBytes)
	}

	sqlText := `
    SELECT
      lower(hex(id)) as id,
      agent_id,
      created_by,
      status,
      harness,
      external_session_id,
      title,
      first_user_message_body,
      last_message_body,
      model,
      model_reasoning_effort,
      created_at,
      updated_at
    FROM sessions`
	if len(conditions) > 0 {
		sqlText += " WHERE " + strings.Join(conditions, " AND ")
	}
	sqlText += " ORDER BY updated_at DESC, id DESC LIMIT ?"
	params = append(params, limit)

	rows, err := s.db.QueryContext(ctx, sqlText, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []*sessionRecord{}
	for rows.Next() {
		var rec sessionRecord
		var external sql.NullString
		var title sql.NullString
		var first sql.NullString
		var last sql.NullString
		var model sql.NullString
		var effort sql.NullString
		if err := rows.Scan(
			&rec.ID,
			&rec.AgentID,
			&rec.CreatedBy,
			&rec.Status,
			&rec.Harness,
			&external,
			&title,
			&first,
			&last,
			&model,
			&effort,
			&rec.CreatedAt,
			&rec.UpdatedAt,
		); err != nil {
			return nil, err
		}
		rec.ExternalSessionID = nullStringPtr(external)
		rec.Title = nullStringPtr(title)
		rec.FirstUserMessageBody = parseJSONMaybe(first)
		rec.LastMessageBody = parseJSONMaybe(last)
		rec.Model = nullStringPtr(model)
		rec.ModelReasoningEffort = nullStringPtr(effort)
		out = append(out, &rec)
	}
	return out, rows.Err()
}

func (s *store) updateSessionExternalID(sessionID, external string) error {
	return s.updateSessionExternalIDCtx(context.Background(), sessionID, external)
}

func (s *store) updateSessionExternalIDCtx(ctx context.Context, sessionID, external string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET external_session_id = ?, updated_at = ? WHERE id = ? AND agent_id = ?`, external, nowISO(), mustHex(sessionID), s.agentID)
	return err
}

func (s *store) updateSessionDefaults(sessionID string, model, effort *string) error {
	return s.updateSessionDefaultsCtx(context.Background(), sessionID, model, effort)
}

func (s *store) updateSessionDefaultsCtx(ctx context.Context, sessionID string, model, effort *string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET model = ?, model_reasoning_effort = ?, updated_at = ? WHERE id = ? AND agent_id = ?`, nullableString(model), nullableString(effort), nowISO(), mustHex(sessionID), s.agentID)
	return err
}

func (s *store) setSessionStatus(sessionID, status string) error {
	return s.setSessionStatusCtx(context.Background(), sessionID, status)
}

func (s *store) setSessionStatusCtx(ctx context.Context, sessionID, status string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET status = ?, updated_at = ? WHERE id = ? AND agent_id = ?`, status, nowISO(), mustHex(sessionID), s.agentID)
	return err
}

func (s *store) updateSessionTitleIfEmpty(sessionID, title string) error {
	return s.updateSessionTitleIfEmptyCtx(context.Background(), sessionID, title)
}

func (s *store) updateSessionTitleIfEmptyCtx(ctx context.Context, sessionID, title string) error {
	title = strings.TrimSpace(title)
	if title == "" {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND agent_id = ? AND (title IS NULL OR title = '')`, title, nowISO(), mustHex(sessionID), s.agentID)
	return err
}

type createMessageInput struct {
	TurnID    *string
	CreatedBy *string
	Body      any
}

type messageRecord struct {
	ID         string  `json:"id"`
	AgentID    string  `json:"agentId"`
	SessionID  string  `json:"sessionId"`
	TurnID     *string `json:"turnId"`
	CreatedBy  *string `json:"createdBy"`
	Body       any     `json:"body"`
	Embeddings any     `json:"embeddings"`
	CreatedAt  string  `json:"createdAt"`
}

func (s *store) createMessage(sessionID string, input createMessageInput) (*messageRecord, error) {
	return s.createMessageCtx(context.Background(), sessionID, input)
}

func (s *store) createMessageCtx(ctx context.Context, sessionID string, input createMessageInput) (*messageRecord, error) {
	idHex := randomHex(16)
	idBytes, _ := hex.DecodeString(idHex)
	now := nowISO()
	bodyJSON, _ := json.Marshal(input.Body)
	isUser := isUserInputBody(input.Body)
	isLast := isLastMessageBodyCandidate(input.Body)
	turnID := s.resolveTurnID(sessionID, input.TurnID, isUser)

	if err := s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `
	    INSERT INTO messages (id, agent_id, session_id, turn_id, created_by, body, embeddings, created_at)
	    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
	  `,
			idBytes,
			s.agentID,
			sessionID,
			nullableString(turnID),
			nullableString(input.CreatedBy),
			string(bodyJSON),
			now,
		); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `
	    UPDATE sessions
	    SET updated_at = ?,
	        last_message_body = CASE WHEN ? = 1 THEN ? ELSE last_message_body END,
	        first_user_message_body = CASE WHEN (first_user_message_body IS NULL OR first_user_message_body = '') AND ? = 1 THEN ? ELSE first_user_message_body END
	    WHERE id = ?
	      AND agent_id = ?
	  `,
			now,
			boolInt(isLast),
			nullableStringPtr(string(bodyJSON)),
			boolInt(isUser),
			nullableStringPtr(string(bodyJSON)),
			mustHex(sessionID),
			s.agentID,
		)
		return err
	}); err != nil {
		return nil, err
	}

	var createdBy *string
	if input.CreatedBy != nil && strings.TrimSpace(*input.CreatedBy) != "" {
		c := strings.TrimSpace(*input.CreatedBy)
		createdBy = &c
	}

	return &messageRecord{
		ID:         idHex,
		AgentID:    s.agentID,
		SessionID:  sessionID,
		TurnID:     turnID,
		CreatedBy:  createdBy,
		Body:       input.Body,
		Embeddings: nil,
		CreatedAt:  now,
	}, nil
}

func (s *store) resolveTurnID(sessionID string, inputTurnID *string, isUser bool) *string {
	if inputTurnID != nil && strings.TrimSpace(*inputTurnID) != "" {
		trimmed := strings.TrimSpace(*inputTurnID)
		s.turnMu.Lock()
		s.sessionTurnID[sessionID] = trimmed
		s.turnMu.Unlock()
		return &trimmed
	}

	s.turnMu.Lock()
	defer s.turnMu.Unlock()
	if isUser {
		id := randomUUID()
		s.sessionTurnID[sessionID] = id
		return &id
	}
	if existing, ok := s.sessionTurnID[sessionID]; ok && strings.TrimSpace(existing) != "" {
		value := existing
		return &value
	}
	return nil
}

func (s *store) getMessagesBySessionID(sessionID string) ([]*messageRecord, error) {
	return s.getMessagesBySessionIDCtx(context.Background(), sessionID)
}

func (s *store) getMessagesBySessionIDCtx(ctx context.Context, sessionID string) ([]*messageRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
	    SELECT lower(hex(id)) as id, agent_id, session_id, turn_id, created_by, body, created_at
	    FROM messages
	    WHERE session_id = ?
	      AND agent_id = ?
	    ORDER BY created_at ASC
	  `, sessionID, s.agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []*messageRecord{}
	for rows.Next() {
		var msg messageRecord
		var turnID sql.NullString
		var createdBy sql.NullString
		var bodyRaw string
		if err := rows.Scan(&msg.ID, &msg.AgentID, &msg.SessionID, &turnID, &createdBy, &bodyRaw, &msg.CreatedAt); err != nil {
			return nil, err
		}
		msg.TurnID = nullStringPtr(turnID)
		msg.CreatedBy = nullStringPtr(createdBy)
		msg.Body = parseJSONRaw(bodyRaw)
		msg.Embeddings = nil
		out = append(out, &msg)
	}
	return out, rows.Err()
}

func (s *store) deleteSession(id string) (bool, error) {
	return s.deleteSessionCtx(context.Background(), id)
}

func (s *store) deleteSessionCtx(ctx context.Context, id string) (bool, error) {
	var affected int64
	if err := s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM messages WHERE session_id = ? AND agent_id = ?`, id, s.agentID); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE id = ? AND agent_id = ?`, mustHex(id), s.agentID)
		if err != nil {
			return err
		}
		affected, _ = res.RowsAffected()
		return nil
	}); err != nil {
		return false, err
	}
	s.turnMu.Lock()
	delete(s.sessionTurnID, id)
	s.turnMu.Unlock()
	return affected > 0, nil
}

func parseJSONRaw(raw string) any {
	var out any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return raw
	}
	return out
}

func parseJSONMaybe(in sql.NullString) any {
	if !in.Valid {
		return nil
	}
	return parseJSONRaw(in.String)
}

func nullStringPtr(in sql.NullString) *string {
	if !in.Valid {
		return nil
	}
	v := in.String
	return &v
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func nullableStringPtr(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func trimMaybe(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func fallback(value, fallbackValue string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallbackValue
	}
	return trimmed
}

func mustHex(value string) []byte {
	buf, _ := hex.DecodeString(strings.ToLower(value))
	return buf
}

func randomHex(bytes int) string {
	buf := make([]byte, bytes)
	_, _ = io.ReadFull(strings.NewReader(strconv.FormatInt(time.Now().UnixNano(), 16)+strconv.FormatInt(int64(os.Getpid()), 10)+strconv.FormatInt(time.Now().UnixMicro(), 10)), buf)
	if _, err := io.ReadFull(randReader{}, buf); err != nil {
		for i := range buf {
			buf[i] = byte(time.Now().UnixNano() >> (i % 8))
		}
	}
	return hex.EncodeToString(buf)
}

func randomUUID() string {
	hexValue := randomHex(16)
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hexValue[0:8],
		hexValue[8:12],
		hexValue[12:16],
		hexValue[16:20],
		hexValue[20:32],
	)
}

type randReader struct{}

func (randReader) Read(p []byte) (int, error) {
	f, err := os.Open("/dev/urandom")
	if err != nil {
		return 0, err
	}
	defer f.Close()
	return io.ReadFull(f, p)
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func isUserInputBody(body any) bool {
	m, ok := body.(map[string]any)
	if !ok {
		return false
	}
	typeValue, _ := m["type"].(string)
	return typeValue == "user_input"
}

func isLastMessageBodyCandidate(body any) bool {
	m, ok := body.(map[string]any)
	if !ok {
		return false
	}
	typeValue, _ := m["type"].(string)
	switch typeValue {
	case "user_input", "assistant_action", "assistant_response", "assistant_output":
		return true
	case "item.completed":
		item, _ := m["item"].(map[string]any)
		itemType, _ := item["type"].(string)
		return itemType == "agent_message"
	case "message_end":
		message, _ := m["message"].(map[string]any)
		role, _ := message["role"].(string)
		return role == "user" || role == "assistant"
	default:
		return false
	}
}

func eventNameForMessage(message *messageRecord) string {
	body, ok := message.Body.(map[string]any)
	if !ok {
		return "message"
	}
	name, _ := body["type"].(string)
	name = strings.TrimSpace(name)
	if name == "" {
		return "message"
	}
	return name
}
