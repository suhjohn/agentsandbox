package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	outboxPollInterval   = time.Second
	outboxBatchSize      = 25
	outboxMaxRetryDelay  = 60 * time.Second
	outboxMaxErrorLength = 2000
)

type createEventInput struct {
	Method  string
	URL     string
	Query   map[string]string
	Headers map[string]string
	Body    any
}

type eventRecord struct {
	ID           string
	Method       string
	URL          string
	Query        map[string]string
	Headers      map[string]string
	Body         any
	Status       string
	AttemptCount int
	AvailableAt  string
	LastError    *string
	CreatedAt    string
	UpdatedAt    string
	ProcessedAt  *string
}

type eventOutbox struct {
	store  *store
	client *http.Client

	managerBaseURL     string
	managerAuthHeaders map[string]string

	stopCh chan struct{}
	wg     sync.WaitGroup
	mu     sync.Mutex
	run    bool
}

func newEventOutbox(store *store, client *http.Client, cfg serveConfig) *eventOutbox {
	return &eventOutbox{
		store:          store,
		client:         client,
		managerBaseURL: normalizeBaseURL(cfg.AgentManagerBaseURL),
		managerAuthHeaders: buildManagerAuthHeaders(cfg.AgentInternalAuthSecret, cfg.AgentID),
	}
}

func (o *eventOutbox) start() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.run {
		return
	}
	o.run = true
	o.stopCh = make(chan struct{})
	_, _ = o.store.requeueProcessingEvents()
	o.wg.Add(1)
	go o.loop()
}

func (o *eventOutbox) stop() {
	o.mu.Lock()
	if !o.run {
		o.mu.Unlock()
		return
	}
	close(o.stopCh)
	o.run = false
	o.mu.Unlock()
	o.wg.Wait()
}

func (o *eventOutbox) loop() {
	defer o.wg.Done()
	ticker := time.NewTicker(outboxPollInterval)
	defer ticker.Stop()

	_, _ = o.flushOnce()
	for {
		select {
		case <-o.stopCh:
			return
		case <-ticker.C:
			_, _ = o.flushOnce()
		}
	}
}

func (o *eventOutbox) flushOnce() (int, error) {
	events, err := o.store.listDispatchableEvents(outboxBatchSize, nowISO())
	if err != nil {
		return 0, err
	}
	processed := 0
	for _, evt := range events {
		locked, err := o.store.markEventProcessing(evt.ID)
		if err != nil || !locked {
			continue
		}
		if err := o.dispatchEvent(evt); err != nil {
			delay := retryDelay(evt.AttemptCount)
			nextAvailable := time.Now().UTC().Add(delay).Format(time.RFC3339Nano)
			_ = o.store.markEventPendingRetry(evt.ID, nextAvailable, err.Error())
		} else {
			_ = o.store.markEventCompleted(evt.ID)
		}
		processed++
	}
	return processed, nil
}

func (o *eventOutbox) dispatchEvent(evt eventRecord) error {
	parsedURL, err := url.Parse(evt.URL)
	if err != nil {
		return err
	}
	query := parsedURL.Query()
	for k, v := range evt.Query {
		query.Set(k, v)
	}
	parsedURL.RawQuery = query.Encode()

	var bodyReader *strings.Reader
	if evt.Body != nil {
		if s, ok := evt.Body.(string); ok {
			bodyReader = strings.NewReader(s)
		} else {
			encoded, _ := json.Marshal(evt.Body)
			bodyReader = strings.NewReader(string(encoded))
		}
	}
	if bodyReader == nil {
		bodyReader = strings.NewReader("")
	}

	req, err := http.NewRequest(evt.Method, parsedURL.String(), bodyReader)
	if err != nil {
		return err
	}
	for k, v := range evt.Headers {
		req.Header.Set(k, v)
	}
	if isManagerCallbackURL(o.managerBaseURL, parsedURL.String()) {
		for k, v := range o.managerAuthHeaders {
			req.Header.Set(k, v)
		}
	}
	if evt.Body != nil {
		if req.Header.Get("Content-Type") == "" {
			req.Header.Set("Content-Type", "application/json")
		}
	}

	res, err := o.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 200 && res.StatusCode <= 299 {
		return nil
	}
	return fmt.Errorf("event dispatch failed (%d %s)", res.StatusCode, res.Status)
}

func retryDelay(attemptCount int) time.Duration {
	exp := attemptCount
	if exp < 0 {
		exp = 0
	}
	if exp > 6 {
		exp = 6
	}
	delay := time.Second * time.Duration(1<<exp)
	if delay > outboxMaxRetryDelay {
		return outboxMaxRetryDelay
	}
	return delay
}

func (s *server) queueManagerSessionSync(sessionID string) {
	baseURL := normalizeBaseURL(s.cfg.AgentManagerBaseURL)
	if baseURL == "" {
		return
	}
	if !hasManagerAuthConfig(s.cfg.AgentInternalAuthSecret, s.cfg.AgentID) {
		return
	}
	session, err := s.store.getSessionByID(sessionID)
	if err != nil || session == nil {
		return
	}

	payload := map[string]any{
		"agentId":              session.AgentID,
		"createdBy":            session.CreatedBy,
		"status":               session.Status,
		"harness":              session.Harness,
		"externalSessionId":    nullString(session.ExternalSessionID),
		"title":                nullString(session.Title),
		"firstUserMessageBody": toJSONStringOrNil(session.FirstUserMessageBody),
		"lastMessageBody":      toJSONStringOrNil(session.LastMessageBody),
		"model":                nullString(session.Model),
		"modelReasoningEffort": nullString(session.ModelReasoningEffort),
	}

	_, _ = s.store.createEvent(createEventInput{
		Method:  http.MethodPut,
		URL:     fmt.Sprintf("%s/session/%s", baseURL, url.PathEscape(sessionID)),
		Headers: map[string]string{"content-type": "application/json"},
		Body:    payload,
	})
}

func (s *server) queueManagerSnapshot(sessionID string) {
	baseURL := normalizeBaseURL(s.cfg.AgentManagerBaseURL)
	if baseURL == "" {
		return
	}
	if !hasManagerAuthConfig(s.cfg.AgentInternalAuthSecret, s.cfg.AgentID) {
		return
	}
	session, err := s.store.getSessionByID(sessionID)
	if err != nil || session == nil {
		return
	}
	_, _ = s.store.createEvent(createEventInput{
		Method: http.MethodPost,
		URL:    fmt.Sprintf("%s/agents/%s/snapshot", baseURL, url.PathEscape(session.AgentID)),
	})
}

func normalizeBaseURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	path := strings.TrimRight(u.Path, "/")
	return fmt.Sprintf("%s://%s%s", u.Scheme, u.Host, path)
}

func buildManagerAuthHeaders(internalSecret, agentID string) map[string]string {
	if secret := strings.TrimSpace(internalSecret); secret != "" {
		headers := map[string]string{
			"X-Agent-Internal-Auth": secret,
		}
		if agent := strings.TrimSpace(agentID); agent != "" {
			headers["X-Agent-Id"] = agent
		}
		return headers
	}
	return map[string]string{}
}

func hasManagerAuthConfig(internalSecret, agentID string) bool {
	return len(buildManagerAuthHeaders(internalSecret, agentID)) > 0
}

func isManagerCallbackURL(managerBaseURL, targetURL string) bool {
	baseURL := normalizeBaseURL(managerBaseURL)
	if baseURL == "" {
		return false
	}
	eventURL := normalizeBaseURL(targetURL)
	if eventURL == "" {
		return false
	}
	if eventURL == baseURL {
		return true
	}
	return strings.HasPrefix(eventURL, baseURL+"/")
}

func toJSONStringOrNil(value any) any {
	if value == nil {
		return nil
	}
	switch v := value.(type) {
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return nil
		}
		return trimmed
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return fmt.Sprintf("%v", value)
		}
		return string(encoded)
	}
}

func (s *store) createEvent(input createEventInput) (string, error) {
	return s.createEventCtx(context.Background(), input)
}

func (s *store) createEventCtx(ctx context.Context, input createEventInput) (string, error) {
	now := nowISO()
	id := randomHex(16)
	queryJSON := nullableJSON(input.Query)
	headersJSON := nullableJSON(input.Headers)
	bodyJSON := nullableJSON(input.Body)
	method := strings.ToUpper(strings.TrimSpace(input.Method))
	if method == "" {
		method = http.MethodPost
	}
	_, err := s.db.ExecContext(ctx, `
    INSERT INTO events (
      id, method, url, query_json, headers_json, body_json,
      status, attempt_count, available_at, last_error, created_at, updated_at, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, ?, ?, NULL)
  `,
		id,
		method,
		strings.TrimSpace(input.URL),
		queryJSON,
		headersJSON,
		bodyJSON,
		now,
		now,
		now,
	)
	if err != nil {
		return "", err
	}
	return id, nil
}

func (s *store) listDispatchableEvents(limit int, now string) ([]eventRecord, error) {
	return s.listDispatchableEventsCtx(context.Background(), limit, now)
}

func (s *store) listDispatchableEventsCtx(ctx context.Context, limit int, now string) ([]eventRecord, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx, `
    SELECT
      id, method, url, query_json, headers_json, body_json,
      status, attempt_count, available_at, last_error, created_at, updated_at, processed_at
    FROM events
    WHERE status = 'pending' AND available_at <= ?
    ORDER BY available_at ASC, created_at ASC
    LIMIT ?
  `, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []eventRecord{}
	for rows.Next() {
		var evt eventRecord
		var queryJSON sql.NullString
		var headersJSON sql.NullString
		var bodyJSON sql.NullString
		var lastError sql.NullString
		var processedAt sql.NullString
		if err := rows.Scan(
			&evt.ID,
			&evt.Method,
			&evt.URL,
			&queryJSON,
			&headersJSON,
			&bodyJSON,
			&evt.Status,
			&evt.AttemptCount,
			&evt.AvailableAt,
			&lastError,
			&evt.CreatedAt,
			&evt.UpdatedAt,
			&processedAt,
		); err != nil {
			return nil, err
		}
		evt.Query = parseJSONMap(queryJSON)
		evt.Headers = parseJSONMap(headersJSON)
		evt.Body = parseJSONMaybe(bodyJSON)
		evt.LastError = nullStringPtr(lastError)
		evt.ProcessedAt = nullStringPtr(processedAt)
		out = append(out, evt)
	}
	return out, rows.Err()
}

func (s *store) markEventProcessing(id string) (bool, error) {
	return s.markEventProcessingCtx(context.Background(), id)
}

func (s *store) markEventProcessingCtx(ctx context.Context, id string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `
    UPDATE events
    SET status = 'processing', updated_at = ?
    WHERE id = ? AND status = 'pending'
  `, nowISO(), id)
	if err != nil {
		return false, err
	}
	changed, _ := res.RowsAffected()
	return changed > 0, nil
}

func (s *store) markEventCompleted(id string) error {
	return s.markEventCompletedCtx(context.Background(), id)
}

func (s *store) markEventCompletedCtx(ctx context.Context, id string) error {
	now := nowISO()
	_, err := s.db.ExecContext(ctx, `
    UPDATE events
    SET status = 'completed', updated_at = ?, processed_at = ?, last_error = NULL
    WHERE id = ?
  `, now, now, id)
	return err
}

func (s *store) markEventPendingRetry(id, availableAt, errText string) error {
	return s.markEventPendingRetryCtx(context.Background(), id, availableAt, errText)
}

func (s *store) markEventPendingRetryCtx(ctx context.Context, id, availableAt, errText string) error {
	errText = strings.TrimSpace(errText)
	if len(errText) > outboxMaxErrorLength {
		errText = errText[:outboxMaxErrorLength]
	}
	_, err := s.db.ExecContext(ctx, `
    UPDATE events
    SET status = 'pending',
        attempt_count = attempt_count + 1,
        available_at = ?,
        last_error = ?,
        updated_at = ?
    WHERE id = ?
  `, availableAt, errText, nowISO(), id)
	return err
}

func (s *store) requeueProcessingEvents() (int, error) {
	return s.requeueProcessingEventsCtx(context.Background())
}

func (s *store) requeueProcessingEventsCtx(ctx context.Context) (int, error) {
	now := nowISO()
	res, err := s.db.ExecContext(ctx, `
    UPDATE events
    SET status = 'pending', available_at = ?, updated_at = ?
    WHERE status = 'processing'
  `, now, now)
	if err != nil {
		return 0, err
	}
	changed, _ := res.RowsAffected()
	return int(changed), nil
}

func nullableJSON(value any) any {
	if value == nil {
		return nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return string(encoded)
}

func parseJSONMap(in sql.NullString) map[string]string {
	if !in.Valid || strings.TrimSpace(in.String) == "" {
		return map[string]string{}
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(in.String), &raw); err != nil {
		return map[string]string{}
	}
	out := map[string]string{}
	for k, v := range raw {
		if s, ok := v.(string); ok {
			out[k] = s
		}
	}
	return out
}

func nullString(v *string) any {
	if v == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*v)
	if trimmed == "" {
		return nil
	}
	return trimmed
}
