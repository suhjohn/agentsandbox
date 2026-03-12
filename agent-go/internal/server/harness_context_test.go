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
