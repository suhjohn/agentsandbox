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
	resources, ok := capabilities["resources"].(map[string]any)
	if !ok {
		t.Fatalf("expected resources capabilities, got %#v", capabilities["resources"])
	}
	if got, _ := resources["listChanged"].(bool); got != false {
		t.Fatalf("expected resources.listChanged=false, got %#v", resources["listChanged"])
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

func TestHandleMCPRequestListsResources(t *testing.T) {
	t.Parallel()

	resp := handleMCPRequest(&http.Client{}, "http://127.0.0.1:1", "token", "run-123", mcpRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "resources/list",
	})

	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("expected result map, got %#v", resp.Result)
	}
	resources, ok := result["resources"].([]map[string]any)
	if !ok {
		raw, ok := result["resources"].([]any)
		if !ok {
			t.Fatalf("expected resources list, got %#v", result["resources"])
		}
		resources = make([]map[string]any, 0, len(raw))
		for _, entry := range raw {
			value, _ := entry.(map[string]any)
			resources = append(resources, value)
		}
	}
	if len(resources) == 0 {
		t.Fatal("expected at least one resource")
	}
	if got, _ := resources[0]["uri"].(string); got == "" {
		t.Fatalf("expected resource uri, got %#v", resources[0])
	}
}

func TestHandleMCPRequestReadsCatalogResource(t *testing.T) {
	t.Parallel()

	resp := handleMCPRequest(&http.Client{}, "http://127.0.0.1:1", "token", "run-123", mcpRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "resources/read",
		Params: map[string]any{
			"uri": "agent-go://client-tools/catalog",
		},
	})

	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("expected result map, got %#v", resp.Result)
	}
	contents, ok := result["contents"].([]map[string]any)
	if !ok {
		raw, ok := result["contents"].([]any)
		if !ok || len(raw) == 0 {
			t.Fatalf("expected contents list, got %#v", result["contents"])
		}
		content, _ := raw[0].(map[string]any)
		if text, _ := content["text"].(string); text == "" {
			t.Fatalf("expected resource text, got %#v", content)
		}
		return
	}
	if len(contents) == 0 {
		t.Fatal("expected resource content")
	}
	if text, _ := contents[0]["text"].(string); text == "" {
		t.Fatalf("expected resource text, got %#v", contents[0])
	}
}
