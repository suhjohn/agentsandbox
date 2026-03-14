package server

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

const clientToolMCPProtocolVersion = "2024-11-05"

type mcpRequest struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      any            `json:"id,omitempty"`
	Method  string         `json:"method"`
	Params  map[string]any `json:"params,omitempty"`
}

type mcpResponse struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      any            `json:"id,omitempty"`
	Result  any            `json:"result,omitempty"`
	Error   *mcpErrorReply `json:"error,omitempty"`
}

type mcpErrorReply struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func runClientToolMCP(args []string) error {
	fs := flag.NewFlagSet("client-tool-mcp", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected args: %v", fs.Args())
	}
	baseURL := strings.TrimSpace(os.Getenv("AGENT_GO_INTERNAL_BASE_URL"))
	internalToken := strings.TrimSpace(os.Getenv("AGENT_GO_INTERNAL_TOKEN"))
	runID := strings.TrimSpace(os.Getenv("AGENT_GO_CLIENT_TOOL_RUN_ID"))
	if baseURL == "" || internalToken == "" {
		return errors.New("AGENT_GO_INTERNAL_BASE_URL and AGENT_GO_INTERNAL_TOKEN are required")
	}
	client := &http.Client{}
	return serveClientToolMCP(os.Stdin, os.Stdout, client, baseURL, internalToken, runID)
}

func serveClientToolMCP(stdin io.Reader, stdout io.Writer, client *http.Client, baseURL, internalToken, runID string) error {
	reader := bufio.NewReader(stdin)
	for {
		payload, err := readMCPMessage(reader)
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		var req mcpRequest
		if err := json.Unmarshal(payload, &req); err != nil {
			if writeErr := writeMCPMessage(stdout, mcpResponse{
				JSONRPC: "2.0",
				Error: &mcpErrorReply{
					Code:    -32700,
					Message: "Parse error",
				},
			}); writeErr != nil {
				return writeErr
			}
			continue
		}
		resp := handleMCPRequest(client, baseURL, internalToken, runID, req)
		if req.ID == nil {
			continue
		}
		if err := writeMCPMessage(stdout, resp); err != nil {
			return err
		}
	}
}

func handleMCPRequest(client *http.Client, baseURL, internalToken, runID string, req mcpRequest) mcpResponse {
	resp := mcpResponse{
		JSONRPC: "2.0",
		ID:      req.ID,
	}
	switch req.Method {
	case "initialize":
		protocolVersion := clientToolMCPProtocolVersion
		if value := asString(req.Params["protocolVersion"]); strings.TrimSpace(value) != "" {
			protocolVersion = strings.TrimSpace(value)
		}
		resp.Result = map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities": map[string]any{
				"tools": map[string]any{
					"listChanged": false,
				},
			},
			"serverInfo": map[string]any{
				"name":    "agent-go-client-tool-mcp",
				"version": "1.0.0",
			},
		}
	case "notifications/initialized":
		resp.ID = nil
	case "tools/list":
		resp.Result = map[string]any{
			"tools": []map[string]any{
				{
					"name":        "client_tool_request",
					"title":       "Client Tool Request",
					"description": "Request execution of a named client-side tool and wait until agent-go routes it to a compatible attached device for the current run user.",
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
					"outputSchema": map[string]any{
						"type":                 "object",
						"additionalProperties": false,
						"properties": map[string]any{
							"ok":     map[string]any{"type": "boolean"},
							"result": map[string]any{},
							"error": map[string]any{
								"type":                 "object",
								"additionalProperties": false,
								"properties": map[string]any{
									"code":      map[string]any{"type": "string"},
									"message":   map[string]any{"type": "string"},
									"retryable": map[string]any{"type": "boolean"},
								},
								"required": []string{"code", "message", "retryable"},
							},
						},
						"required": []string{"ok"},
					},
				},
			},
		}
	case "tools/call":
		name, _ := req.Params["name"].(string)
		if strings.TrimSpace(name) != "client_tool_request" {
			resp.Error = &mcpErrorReply{Code: -32602, Message: "Unknown tool"}
			return resp
		}
		arguments, _ := req.Params["arguments"].(map[string]any)
		if arguments == nil {
			resp.Error = &mcpErrorReply{Code: -32602, Message: "Missing tool arguments"}
			return resp
		}
		toolResult, err := callInternalClientToolRequest(client, baseURL, internalToken, runID, arguments)
		if err != nil {
			resp.Error = &mcpErrorReply{Code: -32603, Message: err.Error()}
			return resp
		}
		raw, _ := json.Marshal(toolResult)
		resp.Result = map[string]any{
			"content": []map[string]any{{
				"type": "text",
				"text": string(raw),
			}},
			"structuredContent": toolResult,
		}
	default:
		resp.Error = &mcpErrorReply{Code: -32601, Message: "Method not found"}
	}
	return resp
}

func callInternalClientToolRequest(client *http.Client, baseURL, internalToken, runID string, arguments map[string]any) (clientToolCallResult, error) {
	if strings.TrimSpace(runID) == "" {
		return clientToolCallResult{}, errors.New("AGENT_GO_CLIENT_TOOL_RUN_ID is required for client_tool_request")
	}
	body, err := json.Marshal(internalClientToolRequestPayload{
		RunID:    runID,
		ToolName: asString(arguments["toolName"]),
		Args:     arguments["args"],
	})
	if err != nil {
		return clientToolCallResult{}, err
	}
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(baseURL, "/")+"/internal/client-tools/request", bytes.NewReader(body))
	if err != nil {
		return clientToolCallResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Agent-Auth", "Bearer "+internalToken)
	res, err := client.Do(req)
	if err != nil {
		return clientToolCallResult{}, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		raw, _ := io.ReadAll(res.Body)
		return clientToolCallResult{}, fmt.Errorf("internal client tool request failed (%d): %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	var result clientToolCallResult
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		return clientToolCallResult{}, err
	}
	return result, nil
}

func readMCPMessage(reader *bufio.Reader) ([]byte, error) {
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
			return []byte(trimmed), nil
		}
		return nil, errors.New("invalid stdio MCP message framing")
	}
}

func writeMCPMessage(writer io.Writer, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := writer.Write(raw); err != nil {
		return err
	}
	_, err = writer.Write([]byte("\n"))
	return err
}

func asString(value any) string {
	v, _ := value.(string)
	return strings.TrimSpace(v)
}
