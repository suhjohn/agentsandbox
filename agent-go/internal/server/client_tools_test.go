package server

import (
	"context"
	"testing"
	"time"
)

func TestClientToolRequestRespond(t *testing.T) {
	events := make(chan map[string]any, 4)
	manager := newClientToolManager(func(_ string, event string, data any) {
		if event != "client_tool_request" {
			return
		}
		payload, _ := data.(map[string]any)
		events <- payload
	})
	auth := authContext{UserID: "user-1"}
	if err := manager.Register(auth, clientToolRegistrationPayload{
		UserID:   "user-1",
		DeviceID: "device-1",
		Tools:    []string{"ui_get_state"},
	}); err != nil {
		t.Fatalf("register: %v", err)
	}
	manager.BeginRun("run-1", "user-1")

	resultCh := make(chan clientToolCallResult, 1)
	go func() {
		result, err := manager.Request(context.Background(), "run-1", "ui_get_state", map[string]any{})
		if err != nil {
			t.Errorf("request: %v", err)
			return
		}
		resultCh <- result
	}()

	var requestID string
	select {
	case evt := <-events:
		request, _ := evt["request"].(map[string]any)
		requestID, _ = request["requestId"].(string)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for request event")
	}
	if requestID == "" {
		t.Fatal("expected requestId in event payload")
	}

	if err := manager.Respond(auth, clientToolRespondPayload{
		RequestID: requestID,
		UserID:    "user-1",
		DeviceID:  "device-1",
		OK:        true,
		Result:    map[string]any{"ok": true},
	}); err != nil {
		t.Fatalf("respond: %v", err)
	}

	select {
	case result := <-resultCh:
		if !result.OK {
			t.Fatalf("expected ok result, got %+v", result)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for terminal result")
	}
}

func TestClientToolRejectsDuplicateAndLateResponses(t *testing.T) {
	events := make(chan map[string]any, 4)
	manager := newClientToolManager(func(_ string, event string, data any) {
		if event != "client_tool_request" {
			return
		}
		payload, _ := data.(map[string]any)
		events <- payload
	})
	auth := authContext{UserID: "user-1"}
	if err := manager.Register(auth, clientToolRegistrationPayload{
		UserID:   "user-1",
		DeviceID: "device-1",
		Tools:    []string{"ui_get_state"},
	}); err != nil {
		t.Fatalf("register: %v", err)
	}
	manager.BeginRun("run-1", "user-1")

	go func() {
		_, _ = manager.Request(context.Background(), "run-1", "ui_get_state", map[string]any{})
	}()
	evt := <-events
	request, _ := evt["request"].(map[string]any)
	requestID, _ := request["requestId"].(string)
	if requestID == "" {
		t.Fatal("expected requestId")
	}

	if err := manager.Respond(auth, clientToolRespondPayload{
		RequestID: requestID,
		UserID:    "user-1",
		DeviceID:  "device-1",
		OK:        true,
		Result:    map[string]any{"ok": true},
	}); err != nil {
		t.Fatalf("first respond: %v", err)
	}
	if err := manager.Respond(auth, clientToolRespondPayload{
		RequestID: requestID,
		UserID:    "user-1",
		DeviceID:  "device-1",
		OK:        true,
		Result:    map[string]any{"ok": true},
	}); err == nil {
		t.Fatal("expected duplicate response to fail")
	}
}

func TestClientToolCancelRunRejectsLateResponse(t *testing.T) {
	events := make(chan map[string]any, 8)
	manager := newClientToolManager(func(_ string, event string, data any) {
		payload, _ := data.(map[string]any)
		payload["event"] = event
		events <- payload
	})
	auth := authContext{UserID: "user-1"}
	if err := manager.Register(auth, clientToolRegistrationPayload{
		UserID:   "user-1",
		DeviceID: "device-1",
		Tools:    []string{"ui_get_state"},
	}); err != nil {
		t.Fatalf("register: %v", err)
	}
	manager.BeginRun("run-1", "user-1")

	resultCh := make(chan clientToolCallResult, 1)
	go func() {
		result, err := manager.Request(context.Background(), "run-1", "ui_get_state", map[string]any{})
		if err != nil {
			t.Errorf("request: %v", err)
			return
		}
		resultCh <- result
	}()

	requestEvt := <-events
	request, _ := requestEvt["request"].(map[string]any)
	requestID, _ := request["requestId"].(string)
	if requestID == "" {
		t.Fatal("expected requestId")
	}

	manager.CancelRun("run-1", "run_finished")

	cancelEvt := <-events
	if got, _ := cancelEvt["event"].(string); got != "client_tool_cancel" {
		t.Fatalf("expected cancel event, got %+v", cancelEvt)
	}

	select {
	case result := <-resultCh:
		if result.OK || result.Error == nil || result.Error.Code != "REQUEST_CANCELLED" {
			t.Fatalf("expected cancelled result, got %+v", result)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for cancelled result")
	}

	if err := manager.Respond(auth, clientToolRespondPayload{
		RequestID: requestID,
		UserID:    "user-1",
		DeviceID:  "device-1",
		OK:        true,
		Result:    map[string]any{"ok": true},
	}); err == nil {
		t.Fatal("expected late response to fail")
	}
}

func TestClientToolRequestSelectsMostRecentCompatibleDevice(t *testing.T) {
	events := make(chan map[string]any, 2)
	manager := newClientToolManager(func(_ string, event string, data any) {
		if event != "client_tool_request" {
			return
		}
		payload, _ := data.(map[string]any)
		events <- payload
	})
	auth := authContext{UserID: "user-1"}
	if err := manager.Register(auth, clientToolRegistrationPayload{
		UserID:   "user-1",
		DeviceID: "device-a",
		Tools:    []string{"ui_get_state"},
	}); err != nil {
		t.Fatalf("register device-a: %v", err)
	}
	if err := manager.Register(auth, clientToolRegistrationPayload{
		UserID:   "user-1",
		DeviceID: "device-b",
		Tools:    []string{"ui_get_state"},
	}); err != nil {
		t.Fatalf("register device-b: %v", err)
	}
	manager.BeginRun("run-1", "user-1")
	manager.mu.Lock()
	manager.registrations["user-1"]["device-a"].LastSeenAt = time.Unix(100, 0)
	manager.registrations["user-1"]["device-b"].LastSeenAt = time.Unix(200, 0)
	manager.mu.Unlock()

	go func() {
		_, _ = manager.Request(context.Background(), "run-1", "ui_get_state", map[string]any{})
	}()

	evt := <-events
	request, _ := evt["request"].(map[string]any)
	if got, _ := request["targetDeviceId"].(string); got != "device-b" {
		t.Fatalf("expected most recent compatible device, got %#v", request["targetDeviceId"])
	}
}
