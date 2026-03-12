package server

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	harnessregistry "agent-go/internal/harness/registry"
)

func TestListToolReadmesIncludesBundledAndUserTools(t *testing.T) {
	root := filepath.Join(t.TempDir(), "tools")
	files := map[string]string{
		filepath.Join(root, "default", "browser-tools", "README.md"): "# Browser Tools\n",
		filepath.Join(root, "bespoke-tool", "README.md"):             "# Bespoke Tool\n",
	}
	for path, body := range files {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("MkdirAll(%q): %v", path, err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatalf("WriteFile(%q): %v", path, err)
		}
	}

	got := listToolReadmes(root)
	want := []harnessregistry.ToolReadme{
		{
			Path:    filepath.Join(root, "bespoke-tool", "README.md"),
			Content: "# Bespoke Tool",
		},
		{
			Path:    filepath.Join(root, "default", "browser-tools", "README.md"),
			Content: "# Browser Tools",
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("listToolReadmes() = %#v, want %#v", got, want)
	}
}

func TestListToolReadmesIncludesSymlinkedBundledTools(t *testing.T) {
	tempDir := t.TempDir()
	root := filepath.Join(tempDir, "tools")
	bundledSource := filepath.Join(tempDir, "bundled-source")

	files := map[string]string{
		filepath.Join(bundledSource, "browser-tools", "README.md"):       "# Browser Tools\n",
		filepath.Join(bundledSource, "agent-manager-tools", "README.md"): "# Agent Manager Tools\n",
		filepath.Join(root, "bespoke-tool", "README.md"):                 "# Bespoke Tool\n",
	}
	for path, body := range files {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("MkdirAll(%q): %v", path, err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatalf("WriteFile(%q): %v", path, err)
		}
	}

	defaultDir := filepath.Join(root, "default")
	if err := os.MkdirAll(defaultDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", defaultDir, err)
	}
	if err := os.Symlink(filepath.Join(bundledSource, "browser-tools"), filepath.Join(defaultDir, "browser-tools")); err != nil {
		t.Fatalf("Symlink(browser-tools): %v", err)
	}
	if err := os.Symlink(filepath.Join(bundledSource, "agent-manager-tools"), filepath.Join(defaultDir, "agent-manager-tools")); err != nil {
		t.Fatalf("Symlink(agent-manager-tools): %v", err)
	}

	got := listToolReadmes(root)
	want := []harnessregistry.ToolReadme{
		{
			Path:    filepath.Join(root, "bespoke-tool", "README.md"),
			Content: "# Bespoke Tool",
		},
		{
			Path:    filepath.Join(root, "default", "agent-manager-tools", "README.md"),
			Content: "# Agent Manager Tools",
		},
		{
			Path:    filepath.Join(root, "default", "browser-tools", "README.md"),
			Content: "# Browser Tools",
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("listToolReadmes() = %#v, want %#v", got, want)
	}
}

func TestBundledWorkspaceToolsDirReturnsDefaultSubdir(t *testing.T) {
	root := filepath.Join(t.TempDir(), "tools")
	if got := bundledWorkspaceToolsDir(root); got != "" {
		t.Fatalf("bundledWorkspaceToolsDir() = %q, want empty", got)
	}

	defaultDir := filepath.Join(root, "default")
	if err := os.MkdirAll(defaultDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", defaultDir, err)
	}

	if got := bundledWorkspaceToolsDir(root); got != defaultDir {
		t.Fatalf("bundledWorkspaceToolsDir() = %q, want %q", got, defaultDir)
	}
}
