package registry

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureManagedContextFileWritesMissingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "AGENTS.md")

	result, err := EnsureManagedContextFile(ManagedFileSpec{
		Harness: "codex",
		Path:    path,
		Version: 1,
		Content: "# Codex\n",
	})
	if err != nil {
		t.Fatalf("EnsureManagedContextFile: %v", err)
	}
	if !result.Wrote {
		t.Fatalf("expected write, got %+v", result)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	text := string(raw)
	if !strings.Contains(text, "agent-go:managed kind=agents-md harness=codex version=1") {
		t.Fatalf("expected managed header, got %q", text)
	}
	if !strings.Contains(text, "# Codex") {
		t.Fatalf("expected content, got %q", text)
	}
}

func TestEnsureManagedContextFilePreservesUnmanagedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "AGENTS.md")
	if err := os.WriteFile(path, []byte("# user-owned\n"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	result, err := EnsureManagedContextFile(ManagedFileSpec{
		Harness: "codex",
		Path:    path,
		Version: 1,
		Content: "# runtime-owned\n",
	})
	if err != nil {
		t.Fatalf("EnsureManagedContextFile: %v", err)
	}
	if result.Wrote {
		t.Fatalf("expected unmanaged file to be preserved, got %+v", result)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if got := string(raw); got != "# user-owned\n" {
		t.Fatalf("unexpected file contents: %q", got)
	}
}

func TestEnsureManagedContextFileUpdatesManagedOlderVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "AGENTS.md")

	if _, err := EnsureManagedContextFile(ManagedFileSpec{
		Harness: "codex",
		Path:    path,
		Version: 1,
		Content: "# old\n",
	}); err != nil {
		t.Fatalf("seed managed file: %v", err)
	}

	result, err := EnsureManagedContextFile(ManagedFileSpec{
		Harness: "codex",
		Path:    path,
		Version: 2,
		Content: "# new\n",
	})
	if err != nil {
		t.Fatalf("EnsureManagedContextFile: %v", err)
	}
	if !result.Wrote {
		t.Fatalf("expected managed file update, got %+v", result)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	text := string(raw)
	if !strings.Contains(text, "version=2") || !strings.Contains(text, "# new") {
		t.Fatalf("unexpected updated file contents: %q", text)
	}
}
