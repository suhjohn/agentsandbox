package server

import (
	codexh "agent-go/internal/harness/codex"
	opencodeh "agent-go/internal/harness/opencode"
	pih "agent-go/internal/harness/pi"
)

type CodexCLI = codexh.CodexCLI

type CodexJSONLEvent = codexh.CodexJSONLEvent

type CodexGlobalOptions = codexh.CodexGlobalOptions

type CodexRootOptions = codexh.CodexRootOptions

type CodexExecOptions = codexh.CodexExecOptions

type CodexResumeOptions = codexh.CodexResumeOptions

var NewCodexCLI = codexh.NewCodexCLI

type OpencodeCLI = opencodeh.OpencodeCLI

type OpencodeOptions = opencodeh.OpencodeOptions

var NewOpencodeCLI = opencodeh.NewOpencodeCLI

type PiCLI = pih.PiCLI

type PiOptions = pih.PiOptions

type PiJSONLEvent = pih.PiJSONLEvent

var NewPiCLI = pih.NewPiCLI
