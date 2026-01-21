package pi

import (
	"strings"
	"testing"
)

func TestPiArgsCoverage(t *testing.T) {
	cli := NewPiCLI()
	args := cli.Args(PiOptions{
		Print:        true,
		Mode:         "rpc",
		Provider:     "openai",
		Model:        "gpt-4o",
		Thinking:     "high",
		Session:      "/tmp/s.jsonl",
		SessionDir:   "/tmp/sessions",
		Tools:        "read,bash",
		Extensions:   []string{"./ext.ts"},
		Skills:       []string{"./skill.md"},
		Prompts:      []string{"./prompt.md"},
		Themes:       []string{"./theme.json"},
		SystemPrompt: "custom",
		AppendPrompt: "append",
		Files:        []string{"foo.ts"},
		Messages:     []string{"hello"},
	})

	joined := strings.Join(args, " ")
	checks := []string{
		"-p",
		"--mode rpc",
		"--provider openai",
		"--model gpt-4o",
		"--thinking high",
		"--session /tmp/s.jsonl",
		"--session-dir /tmp/sessions",
		"--tools read,bash",
		"-e ./ext.ts",
		"--skill ./skill.md",
		"--prompt-template ./prompt.md",
		"--theme ./theme.json",
		"--system-prompt custom",
		"--append-system-prompt append",
		"@foo.ts",
		"hello",
	}
	for _, want := range checks {
		if !strings.Contains(joined, want) {
			t.Fatalf("expected %q in args: %v", want, args)
		}
	}

	pkg := [][]string{
		cli.InstallArgs(PiPackageOptions{Source: "npm:@foo/pi-tools", Local: true}),
		cli.RemoveArgs(PiPackageOptions{Source: "npm:@foo/pi-tools", Local: true}),
		cli.UpdateArgs(PiUpdateOptions{Source: "npm:@foo/pi-tools"}),
		cli.ListArgs(),
		cli.ConfigArgs(),
	}
	for i, next := range pkg {
		if len(next) == 0 {
			t.Fatalf("expected package args at index %d", i)
		}
	}
}

func TestDecodePiJSONL(t *testing.T) {
	input := strings.NewReader(strings.Join([]string{
		`{"type":"response","id":"1","command":"get_state","success":true,"data":{}}`,
		`{"type":"message_update","delta":"hi"}`,
		"not json",
		"",
	}, "\n"))

	events := make([]PiJSONLEvent, 0, 2)
	err := DecodePiJSONL(input, func(evt PiJSONLEvent) {
		events = append(events, evt)
	})
	if err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	if !events[0].IsResponse || events[0].Command != "get_state" || !events[0].Success || events[0].ID != "1" {
		t.Fatalf("unexpected response event: %+v", events[0])
	}
	if events[1].IsResponse {
		t.Fatalf("second event should not be response: %+v", events[1])
	}
}

func TestPiRPCHelpers(t *testing.T) {
	prompt := PiRPCPrompt("id-1", "hello", []PiRPCImage{{Type: "image", Data: "abc", MimeType: "image/png"}}, "steer")
	if prompt["type"] != "prompt" || prompt["id"] != "id-1" || prompt["streamingBehavior"] != "steer" {
		t.Fatalf("unexpected prompt command: %#v", prompt)
	}
	if _, ok := prompt["images"]; !ok {
		t.Fatalf("prompt should include images")
	}
	if got := PiRPCPrompt("", "hello", nil, "follow_up")["streamingBehavior"]; got != PiRPCStreamingBehaviorFollowUp {
		t.Fatalf("expected normalized followUp streaming behavior, got %#v", got)
	}
	if got := PiRPCPrompt("", "hello", nil, "follow-up")["streamingBehavior"]; got != PiRPCStreamingBehaviorFollowUp {
		t.Fatalf("expected normalized followUp streaming behavior for hyphen input, got %#v", got)
	}
	if got := PiRPCPrompt("", "hello", nil, "followUp")["streamingBehavior"]; got != PiRPCStreamingBehaviorFollowUp {
		t.Fatalf("expected followUp streaming behavior passthrough, got %#v", got)
	}

	newSession := PiRPCNewSession("", "  /tmp/parent.jsonl  ")
	if newSession["type"] != "new_session" || newSession["parentSession"] != "/tmp/parent.jsonl" {
		t.Fatalf("unexpected new_session command: %#v", newSession)
	}
	if _, ok := PiRPCSwitchSession("", "   ")["sessionPath"]; ok {
		t.Fatalf("switch_session should omit empty sessionPath")
	}
	if _, ok := PiRPCFork("", "   ")["entryId"]; ok {
		t.Fatalf("fork should omit empty entryId")
	}
	if got := PiRPCSwitchSession("", " /tmp/s.jsonl ")["sessionPath"]; got != "/tmp/s.jsonl" {
		t.Fatalf("switch_session should trim sessionPath, got %#v", got)
	}
	if got := PiRPCFork("", " entry-1 ")["entryId"]; got != "entry-1" {
		t.Fatalf("fork should trim entryId, got %#v", got)
	}

	cmds := []map[string]any{
		PiRPCSteer("", "s", nil),
		PiRPCFollowUp("", "f", nil),
		PiRPCAbort(""),
		PiRPCGetState(""),
		PiRPCGetMessages(""),
		PiRPCSetModel("", "openai", "gpt-4o"),
		PiRPCSetThinkingLevel("", "high"),
		PiRPCCycleModel(""),
		PiRPCCycleThinkingLevel(""),
		PiRPCNewSession("", ""),
		PiRPCSwitchSession("", "/tmp/s.jsonl"),
		PiRPCFork("", "entry-1"),
		PiRPCExportHTML("", "/tmp/session.html"),
	}
	for i, cmd := range cmds {
		if _, ok := cmd["type"]; !ok {
			t.Fatalf("command %d missing type: %#v", i, cmd)
		}
		if _, err := EncodePiRPCCommand(cmd); err != nil {
			t.Fatalf("encode failed for command %d: %v", i, err)
		}
	}
}
