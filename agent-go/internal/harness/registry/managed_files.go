package registry

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const (
	managedFileOwner = "agent-go"
	managedFileKind  = "agents-md"
	managedStartTag  = "<!-- agent-go:managed:start -->"
	managedEndTag    = "<!-- agent-go:managed:end -->"
)

var managedFileHeaderPattern = regexp.MustCompile(`^<!--\s*agent-go:managed\s+kind=([^\s]+)\s+harness=([^\s]+)\s+version=(\d+)\s*-->$`)

type ManagedFileSpec struct {
	Harness string
	Path    string
	Version int
	Content string
}

type ManagedFileResult struct {
	Wrote  bool
	Reason string
}

func EnsureManagedContextFile(spec ManagedFileSpec) (ManagedFileResult, error) {
	path := strings.TrimSpace(spec.Path)
	harness := strings.ToLower(strings.TrimSpace(spec.Harness))
	if path == "" {
		return ManagedFileResult{Reason: "missing-path"}, nil
	}
	if harness == "" {
		return ManagedFileResult{}, fmt.Errorf("managed context file harness is required")
	}
	if spec.Version <= 0 {
		return ManagedFileResult{}, fmt.Errorf("managed context file version must be positive")
	}

	content := strings.TrimSpace(spec.Content)
	if content == "" {
		return ManagedFileResult{Reason: "empty-content"}, nil
	}
	userSuffix := ""
	desired := ""

	current, err := os.ReadFile(path)
	if err == nil {
		currentText := string(current)
		header, managed := parseManagedFileHeader(currentText)
		if !managed {
			return ManagedFileResult{Reason: "existing-unmanaged"}, nil
		}
		if header.Kind != managedFileKind || header.Harness != harness {
			return ManagedFileResult{Reason: "existing-owned-by-other"}, nil
		}
		if header.Version > spec.Version {
			return ManagedFileResult{Reason: "existing-newer-version"}, nil
		}
		userSuffix = extractManagedFileSuffix(currentText)
		desired = marshalManagedFile(harness, spec.Version, content, userSuffix)
		if currentText == desired {
			return ManagedFileResult{Reason: "up-to-date"}, nil
		}
	} else if !os.IsNotExist(err) {
		return ManagedFileResult{}, err
	} else {
		desired = marshalManagedFile(harness, spec.Version, content, "")
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return ManagedFileResult{}, err
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), ".managed-context-*")
	if err != nil {
		return ManagedFileResult{}, err
	}
	tmpPath := tmp.Name()
	_, writeErr := tmp.WriteString(desired)
	closeErr := tmp.Close()
	if writeErr != nil {
		_ = os.Remove(tmpPath)
		return ManagedFileResult{}, writeErr
	}
	if closeErr != nil {
		_ = os.Remove(tmpPath)
		return ManagedFileResult{}, closeErr
	}
	if err := os.Chmod(tmpPath, 0o644); err != nil {
		_ = os.Remove(tmpPath)
		return ManagedFileResult{}, err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return ManagedFileResult{}, err
	}
	return ManagedFileResult{Wrote: true, Reason: "written"}, nil
}

type managedFileHeader struct {
	Kind    string
	Harness string
	Version int
}

func marshalManagedFile(harness string, version int, content string, suffix string) string {
	header := fmt.Sprintf("<!-- %s:managed kind=%s harness=%s version=%d -->\n", managedFileOwner, managedFileKind, harness, version)
	body := strings.TrimSpace(content) + "\n"
	var text strings.Builder
	text.WriteString(header)
	text.WriteString(managedStartTag)
	text.WriteByte('\n')
	text.WriteString(body)
	text.WriteString(managedEndTag)
	text.WriteByte('\n')
	if suffix = strings.TrimLeft(suffix, "\n"); suffix != "" {
		text.WriteByte('\n')
		text.WriteString(suffix)
		if !strings.HasSuffix(suffix, "\n") {
			text.WriteByte('\n')
		}
	}
	return text.String()
}

func parseManagedFileHeader(content string) (managedFileHeader, bool) {
	firstLine, _, _ := strings.Cut(content, "\n")
	matches := managedFileHeaderPattern.FindStringSubmatch(strings.TrimSpace(firstLine))
	if len(matches) != 4 {
		return managedFileHeader{}, false
	}
	version, err := strconv.Atoi(matches[3])
	if err != nil {
		return managedFileHeader{}, false
	}
	return managedFileHeader{
		Kind:    strings.ToLower(strings.TrimSpace(matches[1])),
		Harness: strings.ToLower(strings.TrimSpace(matches[2])),
		Version: version,
	}, true
}

func extractManagedFileSuffix(content string) string {
	start := strings.Index(content, managedStartTag)
	if start < 0 {
		return ""
	}
	searchFrom := start + len(managedStartTag)
	endOffset := strings.Index(content[searchFrom:], managedEndTag)
	if endOffset < 0 {
		return ""
	}
	afterEnd := searchFrom + endOffset + len(managedEndTag)
	if afterEnd < len(content) && content[afterEnd] == '\r' {
		afterEnd++
	}
	if afterEnd < len(content) && content[afterEnd] == '\n' {
		afterEnd++
	}
	return content[afterEnd:]
}
