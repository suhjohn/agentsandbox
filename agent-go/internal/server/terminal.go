package server

import (
	"net/http"

	terminalpkg "agent-go/internal/terminal"
)

func (s *server) handleTerminalWS(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAuth(r); err != nil {
		return err
	}
	return terminalpkg.HandleWS(w, r, s.terminalWorkingDir(), s.isAllowedOrigin)
}

func (s *server) terminalWorkingDir() string {
	return terminalpkg.WorkingDir(s.cfg.DefaultWorkingDir, s.cfg.WorkspacesDir)
}
