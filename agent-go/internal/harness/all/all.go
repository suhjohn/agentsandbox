package all

import (
	codexh "agent-go/internal/harness/codex"
	pih "agent-go/internal/harness/pi"
	"agent-go/internal/harness/registry"
)

type Config struct {
	DefaultWorkingDir string
	RuntimeDir        string
}

func Build(codexCLI *codexh.CodexCLI, piCLI *pih.PiCLI, cfg Config) (*registry.Registry, error) {
	return registry.New(
		codexh.NewHarness(codexCLI),
		pih.NewHarness(piCLI),
	)
}
