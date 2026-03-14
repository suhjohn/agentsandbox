package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	harnessregistry "agent-go/internal/harness/registry"
)

type clientToolDefinition struct {
	Name                   string
	Title                  string
	Description            string
	ArgsDescription        string
	ArgsSchema             map[string]any
	ImplementationRelPaths []string
	Discovery              map[string]any
}

var clientToolDefinitions = []clientToolDefinition{
	{
		Name:            "ui_get_state",
		Title:           "UI State Snapshot",
		Description:     "Capture the current browser UI state for the attached workspace client.",
		ArgsDescription: "Optional JSON object reserved for future state query options.",
		ArgsSchema: map[string]any{
			"type":                 "object",
			"additionalProperties": false,
			"properties":           map[string]any{},
		},
		ImplementationRelPaths: []string{
			"agent-manager-web/src/client-tools/executor.ts",
			"agent-manager-web/src/ui-actions/context.ts",
			"shared/client-tools-contract.ts",
		},
		Discovery: map[string]any{
			"resultShape": map[string]any{
				"state": "UI state snapshot object for the authenticated attached client.",
			},
		},
	},
	{
		Name:            "ui_list_available_actions",
		Title:           "List Available UI Actions",
		Description:     "List UI actions currently available in the attached client context.",
		ArgsDescription: "Optional filter object. Use `surface` to limit results to keyboard, palette, or coordinator actions.",
		ArgsSchema: map[string]any{
			"type":                 "object",
			"additionalProperties": false,
			"properties": map[string]any{
				"surface": map[string]any{
					"type": "string",
					"enum": []string{"keyboard", "palette", "coordinator"},
				},
			},
		},
		ImplementationRelPaths: []string{
			"agent-manager-web/src/client-tools/executor.ts",
			"agent-manager-web/src/ui-actions/context.ts",
			"agent-manager-web/src/ui-actions/execute.ts",
			"shared/client-tools-contract.ts",
		},
		Discovery: map[string]any{
			"returns": "The currently available UI action IDs, titles, categories, surface availability, and params JSON schema.",
			"actionCatalogPaths": []string{
				"agent-manager-web/src/ui-actions/execute.ts",
				"agent-manager-web/src/ui-actions/registry.ts",
				"agent-manager-web/src/ui-actions/types.ts",
				"agent-manager-web/src/ui-actions/actions/",
				"shared/ui-actions-contract.ts",
			},
		},
	},
	{
		Name:            "ui_run_action",
		Title:           "Run UI Action",
		Description:     "Execute a named UI action in the attached client context.",
		ArgsDescription: "Provide `actionId` and optional action parameters, timeout, or version constraints.",
		ArgsSchema: map[string]any{
			"type":                 "object",
			"additionalProperties": false,
			"properties": map[string]any{
				"actionId":      map[string]any{"type": "string"},
				"actionVersion": map[string]any{"type": "number"},
				"params":        map[string]any{},
				"timeoutMs":     map[string]any{"type": "number"},
			},
			"required": []string{"actionId"},
		},
		ImplementationRelPaths: []string{
			"agent-manager-web/src/client-tools/executor.ts",
			"agent-manager-web/src/ui-actions/context.ts",
			"agent-manager-web/src/ui-actions/execute.ts",
			"shared/client-tools-contract.ts",
		},
		Discovery: map[string]any{
			"actionIdSource": "Call client_tool_request with toolName=ui_list_available_actions first. The returned actions[].id values are the valid actionId inputs for ui_run_action in the current client context.",
			"actionCatalogPaths": []string{
				"agent-manager-web/src/ui-actions/execute.ts",
				"agent-manager-web/src/ui-actions/registry.ts",
				"agent-manager-web/src/ui-actions/types.ts",
				"agent-manager-web/src/ui-actions/actions/",
				"shared/ui-actions-contract.ts",
			},
			"argsNotes": []string{
				"actionId is required.",
				"params must conform to the selected action's paramsJsonSchema returned by ui_list_available_actions.",
				"actionVersion should usually match the version returned by ui_list_available_actions.",
			},
		},
	},
	{
		Name:            "add_secret",
		Title:           "Add Client Secret",
		Description:     "Store a client-local secret on the attached device.",
		ArgsDescription: "Provide `name` and `value`. Set `overwrite` to true to replace an existing secret.",
		ArgsSchema: map[string]any{
			"type":                 "object",
			"additionalProperties": false,
			"properties": map[string]any{
				"name":      map[string]any{"type": "string"},
				"value":     map[string]any{"type": "string"},
				"overwrite": map[string]any{"type": "boolean"},
			},
			"required": []string{"name", "value"},
		},
		ImplementationRelPaths: []string{
			"agent-manager-web/src/client-tools/executor.ts",
			"agent-manager-web/src/client-tools/add-secret.ts",
			"shared/client-tools-contract.ts",
		},
		Discovery: map[string]any{
			"storage": "Browser localStorage keyed by authenticated userId and stable deviceId in v1.",
		},
	},
}

var clientToolDefinitionsByName = func() map[string]clientToolDefinition {
	out := make(map[string]clientToolDefinition, len(clientToolDefinitions))
	for _, definition := range clientToolDefinitions {
		out[definition.Name] = definition
	}
	return out
}()

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
	runUsers      map[string]string
	emitRunEvent  func(runID, event string, data any)
}

func newClientToolManager(emitRunEvent func(runID, event string, data any)) *clientToolManager {
	return &clientToolManager{
		registrations: map[string]map[string]*clientToolRegistration{},
		pending:       map[string]*clientToolPendingRequest{},
		runPending:    map[string]map[string]struct{}{},
		runUsers:      map[string]string{},
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

func sortedClientToolNames() []string {
	names := make([]string, 0, len(clientToolDefinitions))
	for _, definition := range clientToolDefinitions {
		names = append(names, definition.Name)
	}
	sort.Strings(names)
	return names
}

func clientToolDefinitionForName(name string) (clientToolDefinition, bool) {
	definition, ok := clientToolDefinitionsByName[normalizeClientToolName(name)]
	return definition, ok
}

func detectClientToolRepoRoot() string {
	if value := strings.TrimSpace(os.Getenv("AGENT_GO_REPO_DIR")); value != "" {
		return filepath.Clean(filepath.Join(value, ".."))
	}
	executablePath, err := os.Executable()
	if err == nil {
		candidate := filepath.Clean(filepath.Join(filepath.Dir(executablePath), "..", ".."))
		if _, statErr := os.Stat(filepath.Join(candidate, "agent-go", "Dockerfile")); statErr == nil {
			return candidate
		}
	}
	return "/opt/agentsandbox"
}

func clientToolImplementationPaths(definition clientToolDefinition) []string {
	root := detectClientToolRepoRoot()
	paths := make([]string, 0, len(definition.ImplementationRelPaths))
	for _, relPath := range definition.ImplementationRelPaths {
		paths = append(paths, filepath.Join(root, filepath.FromSlash(relPath)))
	}
	return paths
}

func clientToolRuntimePaths(relPaths []string) []string {
	root := detectClientToolRepoRoot()
	paths := make([]string, 0, len(relPaths))
	for _, relPath := range relPaths {
		paths = append(paths, filepath.Join(root, filepath.FromSlash(relPath)))
	}
	return paths
}

func clientToolCatalogDocument() map[string]any {
	tools := make([]map[string]any, 0, len(clientToolDefinitions))
	for _, definition := range clientToolDefinitions {
		tools = append(tools, map[string]any{
			"name":                definition.Name,
			"title":               definition.Title,
			"description":         definition.Description,
			"argsDescription":     definition.ArgsDescription,
			"argsSchema":          definition.ArgsSchema,
			"implementationPaths": clientToolImplementationPaths(definition),
			"discovery":           clientToolDiscovery(definition),
		})
	}
	sort.Slice(tools, func(i, j int) bool {
		left, _ := tools[i]["name"].(string)
		right, _ := tools[j]["name"].(string)
		return left < right
	})
	return map[string]any{
		"transport": "client_tool",
		"mcpServer": "agent_go_client_tools",
		"mcpTool": map[string]any{
			"name":        "client_tool_request",
			"description": "Request execution of a named client-side tool on an attached device and wait for the terminal result.",
			"inputSchema": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"properties": map[string]any{
					"toolName": map[string]any{
						"type": "string",
						"enum": sortedClientToolNames(),
					},
					"args": map[string]any{
						"description": "JSON-serializable arguments forwarded to the selected client tool.",
					},
				},
				"required": []string{"toolName"},
			},
			"routing": map[string]any{
				"userId":   "Injected from the current run context by agent-go.",
				"deviceId": "Selected by agent-go as the most recently seen compatible registered device for the run user.",
			},
		},
		"tools": tools,
	}
}

func clientToolResourceByURI(uri string) (map[string]any, bool) {
	switch strings.TrimSpace(uri) {
	case "agent-go://client-tools/catalog":
		return clientToolCatalogDocument(), true
	default:
		const prefix = "agent-go://client-tools/tools/"
		if !strings.HasPrefix(uri, prefix) {
			return nil, false
		}
		name := strings.TrimSpace(strings.TrimPrefix(uri, prefix))
		definition, ok := clientToolDefinitionForName(name)
		if !ok {
			return nil, false
		}
		return map[string]any{
			"name":                definition.Name,
			"title":               definition.Title,
			"description":         definition.Description,
			"argsDescription":     definition.ArgsDescription,
			"argsSchema":          definition.ArgsSchema,
			"implementationPaths": clientToolImplementationPaths(definition),
			"discovery":           clientToolDiscovery(definition),
		}, true
	}
}

func clientToolDiscovery(definition clientToolDefinition) map[string]any {
	if len(definition.Discovery) == 0 {
		return nil
	}
	out := make(map[string]any, len(definition.Discovery))
	for key, value := range definition.Discovery {
		if key == "actionCatalogPaths" {
			relPaths, ok := value.([]string)
			if !ok {
				out[key] = value
				continue
			}
			out[key] = clientToolRuntimePaths(relPaths)
			continue
		}
		out[key] = value
	}
	return out
}

func listClientToolResources() []map[string]any {
	resources := []map[string]any{
		{
			"uri":         "agent-go://client-tools/catalog",
			"name":        "Client Tool Catalog",
			"description": "Dynamic catalog of available client tools, routing behavior, and implementation paths.",
			"mimeType":    "application/json",
		},
	}
	for _, definition := range clientToolDefinitions {
		resources = append(resources, map[string]any{
			"uri":         "agent-go://client-tools/tools/" + definition.Name,
			"name":        definition.Title,
			"description": definition.Description,
			"mimeType":    "application/json",
		})
	}
	return resources
}

func deriveClientToolInternalToken(secretSeed, agentID string) string {
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(secretSeed)))
	mac.Write([]byte("client-tool-mcp:" + strings.TrimSpace(agentID)))
	return hex.EncodeToString(mac.Sum(nil))
}

func (m *clientToolManager) BeginRun(runID, userID string) {
	runID = strings.TrimSpace(runID)
	userID = normalizeUserID(userID)
	if runID == "" || userID == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runUsers[runID] = userID
}

func (m *clientToolManager) EndRun(runID string) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.runUsers, runID)
	delete(m.runPending, runID)
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
		if _, ok := clientToolDefinitionForName(toolName); !ok {
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

func (m *clientToolManager) Request(ctx context.Context, runID, toolName string, args any) (clientToolCallResult, error) {
	toolName = normalizeClientToolName(toolName)
	if strings.TrimSpace(runID) == "" {
		return clientToolCallResult{}, fail(400, "runId is required")
	}
	if _, ok := clientToolDefinitionForName(toolName); !ok {
		return clientToolCallResult{}, fail(400, fmt.Sprintf("Unsupported client tool: %s", toolName))
	}

	requestID := "ctr_" + randomHex(8)
	pending := &clientToolPendingRequest{
		RequestID: requestID,
		RunID:     strings.TrimSpace(runID),
		ToolName:  toolName,
		Args:      args,
		Status:    "pending",
		CreatedAt: time.Now().UTC(),
		ResultCh:  make(chan clientToolCallResult, 1),
	}

	m.mu.Lock()
	userID := m.runUsers[pending.RunID]
	if userID == "" {
		m.mu.Unlock()
		return clientToolCallResult{}, fail(404, "Run context not found for client tool request")
	}
	registration, err := m.selectRegistrationLocked(userID, toolName)
	if err != nil {
		m.mu.Unlock()
		return clientToolCallResult{}, err
	}
	pending.UserID = userID
	pending.DeviceID = registration.DeviceID
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

func (m *clientToolManager) selectRegistrationLocked(userID, toolName string) (*clientToolRegistration, error) {
	userRegistrations := m.registrations[normalizeUserID(userID)]
	if len(userRegistrations) == 0 {
		return nil, fail(404, "No registered client devices found for run user")
	}
	var selected *clientToolRegistration
	for _, registration := range userRegistrations {
		if _, ok := registration.Tools[toolName]; !ok {
			continue
		}
		if selected == nil ||
			registration.LastSeenAt.After(selected.LastSeenAt) ||
			(registration.LastSeenAt.Equal(selected.LastSeenAt) && registration.DeviceID < selected.DeviceID) {
			selected = registration
		}
	}
	if selected == nil {
		return nil, fail(409, "No registered client device supports requested tool")
	}
	return selected, nil
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
