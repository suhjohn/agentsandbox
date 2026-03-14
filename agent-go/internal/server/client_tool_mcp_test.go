package server

import (
	"bufio"
	"bytes"
	"net/http"
	"testing"
)

func TestHandleMCPRequestInitializeUsesClientProtocolVersion(t *testing.T) {
	t.Parallel()

	resp := handleMCPRequest(&http.Client{}, "http://127.0.0.1:1", "token", "run-123", mcpRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "initialize",
		Params: map[string]any{
			"protocolVersion": "2025-03-26",
		},
	})

	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("expected result map, got %#v", resp.Result)
	}
	if got, _ := result["protocolVersion"].(string); got != "2025-03-26" {
		t.Fatalf("expected protocolVersion to echo client value, got %q", got)
	}
	capabilities, ok := result["capabilities"].(map[string]any)
	if !ok {
		t.Fatalf("expected capabilities map, got %#v", result["capabilities"])
	}
	tools, ok := capabilities["tools"].(map[string]any)
	if !ok {
		t.Fatalf("expected tools capabilities, got %#v", capabilities["tools"])
	}
	if got, _ := tools["listChanged"].(bool); got != false {
		t.Fatalf("expected listChanged=false, got %#v", tools["listChanged"])
	}
}

func TestReadMCPMessageReadsNewlineDelimitedJSON(t *testing.T) {
	t.Parallel()

	reader := bufio.NewReader(bytes.NewBufferString("{\"jsonrpc\":\"2.0\",\"id\":1}\n"))
	payload, err := readMCPMessage(reader)
	if err != nil {
		t.Fatalf("readMCPMessage: %v", err)
	}
	if got := string(payload); got != "{\"jsonrpc\":\"2.0\",\"id\":1}" {
		t.Fatalf("unexpected payload %q", got)
	}
}

func TestWriteMCPMessageWritesNewlineDelimitedJSON(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	if err := writeMCPMessage(&buf, map[string]any{"jsonrpc": "2.0", "id": 1}); err != nil {
		t.Fatalf("writeMCPMessage: %v", err)
	}
	if got := buf.String(); got != "{\"id\":1,\"jsonrpc\":\"2.0\"}\n" && got != "{\"jsonrpc\":\"2.0\",\"id\":1}\n" {
		t.Fatalf("unexpected output %q", got)
	}
}

func TestHandleMCPRequestToolCallRequiresRunIDAtCallTime(t *testing.T) {
	t.Parallel()

	resp := handleMCPRequest(&http.Client{}, "http://127.0.0.1:1", "token", "", mcpRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "tools/call",
		Params: map[string]any{
			"name": "client_tool_request",
			"arguments": map[string]any{
				"toolName": "ui_get_state",
				"args":     map[string]any{},
			},
		},
	})

	if resp.Error == nil {
		t.Fatalf("expected tools/call without run id to fail")
	}
	if resp.Error.Message != "AGENT_GO_CLIENT_TOOL_RUN_ID is required for client_tool_request" {
		t.Fatalf("unexpected error %q", resp.Error.Message)
	}
}
