package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func ensureValidWorkspaceName(input string) (string, error) {
	name := strings.TrimSpace(input)
	if name == "" || name == "." || name == ".." || strings.Contains(name, "/") || strings.Contains(name, "\\") {
		return "", fail(http.StatusBadRequest, "Invalid workspace name")
	}
	return name, nil
}

func ensureValidWorkspaceFilePath(input string) (string, error) {
	value := strings.TrimSpace(input)
	if value == "" || strings.ContainsRune(value, '\x00') || strings.Contains(value, "\\") || filepath.IsAbs(value) {
		return "", fail(http.StatusBadRequest, "Invalid file path")
	}
	normalized := filepath.Clean(value)
	if normalized == "." || normalized == ".." || strings.HasPrefix(normalized, ".."+string(filepath.Separator)) {
		return "", fail(http.StatusBadRequest, "Invalid file path")
	}
	return normalized, nil
}

func resolveWorkspaceRoot(workspacesDir, name string) (string, error) {
	baseResolved, err := filepath.Abs(workspacesDir)
	if err != nil {
		return "", fail(http.StatusBadRequest, "Invalid workspace path")
	}
	candidate := filepath.Join(baseResolved, name)
	resolvedCandidate, err := filepath.Abs(candidate)
	if err != nil {
		return "", fail(http.StatusBadRequest, "Invalid workspace path")
	}
	prefix := baseResolved
	if !strings.HasSuffix(prefix, string(filepath.Separator)) {
		prefix += string(filepath.Separator)
	}
	if !strings.HasPrefix(resolvedCandidate, prefix) {
		return "", fail(http.StatusBadRequest, "Invalid workspace name")
	}
	info, err := os.Stat(resolvedCandidate)
	if err != nil || !info.IsDir() {
		return "", fail(http.StatusNotFound, "Workspace not found")
	}
	realBase, _ := filepath.EvalSymlinks(baseResolved)
	realCandidate, _ := filepath.EvalSymlinks(resolvedCandidate)
	if realBase != "" && realCandidate != "" {
		realPrefix := realBase
		if !strings.HasSuffix(realPrefix, string(filepath.Separator)) {
			realPrefix += string(filepath.Separator)
		}
		if !strings.HasPrefix(realCandidate, realPrefix) {
			return "", fail(http.StatusBadRequest, "Invalid workspace path")
		}
	}
	return resolvedCandidate, nil
}
