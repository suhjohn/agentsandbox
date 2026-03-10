package all

import (
	codexh "agent-go/internal/harness/codex"
	opencodeh "agent-go/internal/harness/opencode"
	pih "agent-go/internal/harness/pi"
	"agent-go/internal/harness/registry"
)

type Config struct {
	DefaultWorkingDir string
	RuntimeDir        string
}

func Build(codexCLI *codexh.CodexCLI, piCLI *pih.PiCLI, opencodeCLI *opencodeh.OpencodeCLI, cfg Config) (*registry.Registry, error) {
	return registry.New(
		codexh.NewHarness(codexCLI),
		opencodeh.NewHarness(opencodeCLI),
		pih.NewHarness(piCLI),
	)
}
