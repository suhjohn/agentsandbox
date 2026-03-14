package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	harnessregistry "agent-go/internal/harness/registry"
)

var supportedClientToolNames = map[string]struct{}{
	"ui_get_state":              {},
	"ui_list_available_actions": {},
	"ui_run_action":             {},
	"add_secret":                {},
}

type clientToolErrorEnvelope struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type clientToolCallResult struct {
	OK     bool                     `json:"ok"`
	Result any                      `json:"result,omitempty"`
	Error  *clientToolErrorEnvelope `json:"error,omitempty"`
}

type clientToolRegistrationPayload struct {
	UserID   string         `json:"userId"`
	DeviceID string         `json:"deviceId"`
	Tools    []string       `json:"tools"`
	Device   map[string]any `json:"device,omitempty"`
}

type clientToolUnregisterPayload struct {
	UserID   string `json:"userId"`
	DeviceID string `json:"deviceId"`
}

type clientToolRespondPayload struct {
	RequestID string                   `json:"requestId"`
	UserID    string                   `json:"userId"`
	DeviceID  string                   `json:"deviceId"`
	OK        bool                     `json:"ok"`
	Result    any                      `json:"result,omitempty"`
	Error     *clientToolErrorEnvelope `json:"error,omitempty"`
}

type clientToolCancelPayload struct {
	RequestID string `json:"requestId"`
	UserID    string `json:"userId"`
	DeviceID  string `json:"deviceId"`
	Reason    string `json:"reason,omitempty"`
}

type internalClientToolRequestPayload struct {
	RunID    string `json:"runId"`
	ToolName string `json:"toolName"`
	Args     any    `json:"args"`
	UserID   string `json:"userId"`
	DeviceID string `json:"deviceId"`
}

type clientToolRegistration struct {
	UserID     string
	DeviceID   string
	Tools      map[string]struct{}
	Device     map[string]any
	LastSeenAt time.Time
}

type clientToolPendingRequest struct {
	RequestID   string
	RunID       string
	ToolName    string
	Args        any
	UserID      string
	DeviceID    string
	Status      string
	CreatedAt   time.Time
	CancelledAt *time.Time
	ResultCh    chan clientToolCallResult
}

type clientToolManager struct {
	mu            sync.Mutex
	registrations map[string]map[string]*clientToolRegistration
	pending       map[string]*clientToolPendingRequest
	runPending    map[string]map[string]struct{}
	emitRunEvent  func(runID, event string, data any)
}

func newClientToolManager(emitRunEvent func(runID, event string, data any)) *clientToolManager {
	return &clientToolManager{
		registrations: map[string]map[string]*clientToolRegistration{},
		pending:       map[string]*clientToolPendingRequest{},
		runPending:    map[string]map[string]struct{}{},
		emitRunEvent:  emitRunEvent,
	}
}

func normalizeClientToolName(value string) string {
	return strings.TrimSpace(value)
}

func normalizeDeviceID(value string) string {
	return strings.TrimSpace(value)
}

func normalizeUserID(value string) string {
	return strings.TrimSpace(value)
}

func deriveClientToolInternalToken(secretSeed, agentID string) string {
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(secretSeed)))
	mac.Write([]byte("client-tool-mcp:" + strings.TrimSpace(agentID)))
	return hex.EncodeToString(mac.Sum(nil))
}

func (m *clientToolManager) Register(auth authContext, payload clientToolRegistrationPayload) error {
	userID := normalizeUserID(payload.UserID)
	deviceID := normalizeDeviceID(payload.DeviceID)
	if userID == "" || deviceID == "" {
		return fail(400, "userId and deviceId are required")
	}
	if userID != normalizeUserID(auth.UserID) {
		return fail(403, "Authenticated user does not match registration userId")
	}
	toolSet := make(map[string]struct{}, len(payload.Tools))
	for _, raw := range payload.Tools {
		toolName := normalizeClientToolName(raw)
		if toolName == "" {
			continue
		}
		if _, ok := supportedClientToolNames[toolName]; !ok {
			return fail(400, fmt.Sprintf("Unsupported client tool: %s", toolName))
		}
		toolSet[toolName] = struct{}{}
	}
	if len(toolSet) == 0 {
		return fail(400, "At least one supported tool is required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	userRegistrations := m.registrations[userID]
	if userRegistrations == nil {
		userRegistrations = map[string]*clientToolRegistration{}
		m.registrations[userID] = userRegistrations
	}
	userRegistrations[deviceID] = &clientToolRegistration{
		UserID:     userID,
		DeviceID:   deviceID,
		Tools:      toolSet,
		Device:     payload.Device,
		LastSeenAt: time.Now().UTC(),
	}
	return nil
}

func (m *clientToolManager) Unregister(auth authContext, payload clientToolUnregisterPayload) error {
	userID := normalizeUserID(payload.UserID)
	deviceID := normalizeDeviceID(payload.DeviceID)
	if userID == "" || deviceID == "" {
		return fail(400, "userId and deviceId are required")
	}
	if userID != normalizeUserID(auth.UserID) {
		return fail(403, "Authenticated user does not match unregister userId")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	userRegistrations := m.registrations[userID]
	if userRegistrations == nil {
		return nil
	}
	delete(userRegistrations, deviceID)
	if len(userRegistrations) == 0 {
		delete(m.registrations, userID)
	}
	return nil
}

func (m *clientToolManager) Request(ctx context.Context, runID, userID, deviceID, toolName string, args any) (clientToolCallResult, error) {
	userID = normalizeUserID(userID)
	deviceID = normalizeDeviceID(deviceID)
	toolName = normalizeClientToolName(toolName)
	if strings.TrimSpace(runID) == "" {
		return clientToolCallResult{}, fail(400, "runId is required")
	}
	if userID == "" || deviceID == "" {
		return clientToolCallResult{}, fail(400, "userId and deviceId are required")
	}
	if _, ok := supportedClientToolNames[toolName]; !ok {
		return clientToolCallResult{}, fail(400, fmt.Sprintf("Unsupported client tool: %s", toolName))
	}

	requestID := "ctr_" + randomHex(8)
	pending := &clientToolPendingRequest{
		RequestID: requestID,
		RunID:     strings.TrimSpace(runID),
		ToolName:  toolName,
		Args:      args,
		UserID:    userID,
		DeviceID:  deviceID,
		Status:    "pending",
		CreatedAt: time.Now().UTC(),
		ResultCh:  make(chan clientToolCallResult, 1),
	}

	m.mu.Lock()
	userRegistrations := m.registrations[userID]
	registration := userRegistrations[deviceID]
	if registration == nil {
		m.mu.Unlock()
		return clientToolCallResult{}, fail(404, "Target device is not registered")
	}
	if _, ok := registration.Tools[toolName]; !ok {
		m.mu.Unlock()
		return clientToolCallResult{}, fail(409, "Target device does not support requested tool")
	}
	m.pending[requestID] = pending
	runPending := m.runPending[pending.RunID]
	if runPending == nil {
		runPending = map[string]struct{}{}
		m.runPending[pending.RunID] = runPending
	}
	runPending[requestID] = struct{}{}
	m.mu.Unlock()

	if m.emitRunEvent != nil {
		m.emitRunEvent(pending.RunID, "client_tool_request", map[string]any{
			"type":  "client_tool_request",
			"runId": pending.RunID,
			"request": map[string]any{
				"requestId":      pending.RequestID,
				"toolName":       pending.ToolName,
				"args":           pending.Args,
				"targetDeviceId": pending.DeviceID,
				"cancellable":    true,
			},
		})
	}

	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case result := <-pending.ResultCh:
		return result, nil
	case <-ctx.Done():
		m.Cancel(pending.RunID, pending.RequestID, "request_context_cancelled")
		result := <-pending.ResultCh
		return result, nil
	}
}

func (m *clientToolManager) Respond(auth authContext, payload clientToolRespondPayload) error {
	userID := normalizeUserID(payload.UserID)
	deviceID := normalizeDeviceID(payload.DeviceID)
	requestID := strings.TrimSpace(payload.RequestID)
	if requestID == "" || userID == "" || deviceID == "" {
		return fail(400, "requestId, userId, and deviceId are required")
	}
	if userID != normalizeUserID(auth.UserID) {
		return fail(403, "Authenticated user does not match response userId")
	}
	m.mu.Lock()
	pending := m.pending[requestID]
	if pending == nil {
		m.mu.Unlock()
		return fail(404, "Pending request not found")
	}
	if pending.UserID != userID || pending.DeviceID != deviceID {
		m.mu.Unlock()
		return fail(403, "Response does not match targeted request device")
	}
	if pending.Status == "resolved" {
		m.mu.Unlock()
		return fail(409, "Pending request already resolved")
	}
	if pending.Status == "cancelled" {
		m.mu.Unlock()
		return fail(409, "Pending request already cancelled")
	}
	pending.Status = "resolved"
	delete(m.pending, requestID)
	if runPending := m.runPending[pending.RunID]; runPending != nil {
		delete(runPending, requestID)
		if len(runPending) == 0 {
			delete(m.runPending, pending.RunID)
		}
	}
	resultCh := pending.ResultCh
	result := clientToolCallResult{
		OK:     payload.OK,
		Result: payload.Result,
		Error:  payload.Error,
	}
	m.mu.Unlock()

	resultCh <- result
	return nil
}

func (m *clientToolManager) Cancel(runID, requestID, reason string) {
	m.cancel(runID, requestID, reason, true)
}

func (m *clientToolManager) cancel(runID, requestID, reason string, emitEvent bool) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return
	}
	m.mu.Lock()
	pending := m.pending[requestID]
	if pending == nil || pending.Status != "pending" {
		m.mu.Unlock()
		return
	}
	now := time.Now().UTC()
	pending.Status = "cancelled"
	pending.CancelledAt = &now
	delete(m.pending, requestID)
	if runPending := m.runPending[pending.RunID]; runPending != nil {
		delete(runPending, requestID)
		if len(runPending) == 0 {
			delete(m.runPending, pending.RunID)
		}
	}
	resultCh := pending.ResultCh
	targetRunID := pending.RunID
	targetDeviceID := pending.DeviceID
	targetRequestID := pending.RequestID
	m.mu.Unlock()

	if emitEvent && m.emitRunEvent != nil {
		m.emitRunEvent(targetRunID, "client_tool_cancel", map[string]any{
			"type":           "client_tool_cancel",
			"runId":          targetRunID,
			"requestId":      targetRequestID,
			"targetDeviceId": targetDeviceID,
			"reason":         strings.TrimSpace(reason),
		})
	}
	resultCh <- clientToolCallResult{
		OK: false,
		Error: &clientToolErrorEnvelope{
			Code:      "REQUEST_CANCELLED",
			Message:   "Client tool request cancelled",
			Retryable: false,
		},
	}
}

func (m *clientToolManager) CancelRun(runID, reason string) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return
	}
	m.mu.Lock()
	runPending := m.runPending[runID]
	requestIDs := make([]string, 0, len(runPending))
	for requestID := range runPending {
		requestIDs = append(requestIDs, requestID)
	}
	m.mu.Unlock()
	for _, requestID := range requestIDs {
		m.cancel(runID, requestID, reason, true)
	}
}

func (m *clientToolManager) CancelAll(reason string) {
	m.mu.Lock()
	requestIDs := make([]string, 0, len(m.pending))
	runIDs := make(map[string]string, len(m.pending))
	for requestID, pending := range m.pending {
		requestIDs = append(requestIDs, requestID)
		runIDs[requestID] = pending.RunID
	}
	m.mu.Unlock()
	for _, requestID := range requestIDs {
		m.cancel(runIDs[requestID], requestID, reason, false)
	}
}

func toHarnessClientToolError(value *clientToolErrorEnvelope) *harnessregistry.ClientToolError {
	if value == nil {
		return nil
	}
	return &harnessregistry.ClientToolError{
		Code:      value.Code,
		Message:   value.Message,
		Retryable: value.Retryable,
	}
}

func toClientToolCallErrorResult(err error) clientToolCallResult {
	if err == nil {
		return clientToolCallResult{
			OK: false,
			Error: &clientToolErrorEnvelope{
				Code:      "REQUEST_FAILED",
				Message:   "Client tool request failed",
				Retryable: false,
			},
		}
	}
	code := "REQUEST_FAILED"
	message := strings.TrimSpace(err.Error())
	if message == "" {
		message = "Client tool request failed"
	}
	return clientToolCallResult{
		OK: false,
		Error: &clientToolErrorEnvelope{
			Code:      code,
			Message:   message,
			Retryable: false,
		},
	}
}
