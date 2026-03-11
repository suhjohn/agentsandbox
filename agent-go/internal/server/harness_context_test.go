package server

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestListToolReadmesIncludesBundledAndUserTools(t *testing.T) {
	root := filepath.Join(t.TempDir(), "tools")
	paths := []string{
		filepath.Join(root, "default", "browser-tools", "README.md"),
		filepath.Join(root, "bespoke-tool", "README.md"),
	}
	for _, path := range paths {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("MkdirAll(%q): %v", path, err)
		}
		if err := os.WriteFile(path, []byte("# README\n"), 0o644); err != nil {
			t.Fatalf("WriteFile(%q): %v", path, err)
		}
	}

	got := listToolReadmes(root)
	want := []string{
		filepath.Join(root, "bespoke-tool", "README.md"),
		filepath.Join(root, "default", "browser-tools", "README.md"),
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
