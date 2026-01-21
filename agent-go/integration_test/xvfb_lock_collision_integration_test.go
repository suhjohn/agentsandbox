//go:build dockerintegration

package agentgo

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestContainerBootsWithX11LockPIDCollision(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("docker not available")
	}
	root := repoRoot(t)
	secretSeed := strings.Repeat("x", 32)
	baseTag := "agent-go:it-xvfb-base"
	derivedTag := "agent-go:it-xvfb-stale"
	containerName := fmt.Sprintf("agent_go_it_xvfb_%d", time.Now().UnixNano())
	agentBinary := ensureDockerAgentServerBinary(t, root)

	runCmd(t, []string{"docker", "build", "-f", "agent-go/Dockerfile", "--build-arg", "PORT=3131", "--build-arg", "AGENT_SERVER_BINARY=" + agentBinary, "-t", baseTag, "."}, root, nil, false)
	runCmd(t, []string{"docker", "build", "--build-arg", "BASE_IMAGE=" + baseTag, "-f", "agent-go/integration_test/Dockerfile.xvfb-stale", "-t", derivedTag, "."}, root, nil, false)
	defer runCmd(t, []string{"docker", "rm", "-f", containerName}, root, nil, true)

	runCmd(t, []string{"docker", "run", "-d", "--name", containerName, "--shm-size=1g", "-P", "-e", "OPENAI_API_KEY=sk-test", "-e", "SECRET_SEED=" + secretSeed, derivedTag}, root, nil, false)

	apiPort := parseHostPort(t, runCmd(t, []string{"docker", "port", containerName, "3131/tcp"}, root, nil, false).Stdout)
	novncPort := parseHostPort(t, runCmd(t, []string{"docker", "port", containerName, "6080/tcp"}, root, nil, false).Stdout)
	apiBaseURL := fmt.Sprintf("http://127.0.0.1:%d", apiPort)
	noVNCBaseURL := fmt.Sprintf("http://127.0.0.1:%d", novncPort)

	waitFor(t, 20*time.Second, func() error {
		res, err := http.Get(apiBaseURL + "/health")
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return fmt.Errorf("health=%d", res.StatusCode)
		}
		return nil
	})
	waitFor(t, 20*time.Second, func() error {
		res, err := http.Get(noVNCBaseURL + "/")
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return fmt.Errorf("novnc=%d", res.StatusCode)
		}
		return nil
	})

	ps := runCmd(t, []string{"docker", "exec", containerName, "ps", "aux"}, root, nil, false)
	mustContainAll(t, ps.Stdout, []string{"Xvfb :99", "openbox", "x11vnc", "websockify"})
}
