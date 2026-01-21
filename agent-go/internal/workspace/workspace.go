package workspace

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func IsGitRepoRoot(root string) bool {
	info, err := os.Stat(filepath.Join(root, ".git"))
	return err == nil && info.IsDir()
}

type Status struct {
	HasChanges bool `json:"hasChanges"`
	Staged     int  `json:"staged"`
	Unstaged   int  `json:"unstaged"`
	Untracked  int  `json:"untracked"`
}

func RepoStatus(root string) Status {
	stdout, _, code := RunGit(root, 4*time.Second, "status", "--porcelain=v1")
	if code != 0 {
		return Status{}
	}
	status := Status{}
	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		if strings.HasPrefix(line, "??") {
			status.Untracked++
			continue
		}
		if len(line) >= 2 {
			x := line[0]
			y := line[1]
			if x != ' ' && x != '?' {
				status.Staged++
			}
			if y != ' ' {
				status.Unstaged++
			}
		}
	}
	status.HasChanges = status.Staged > 0 || status.Unstaged > 0 || status.Untracked > 0
	return status
}

func RepoPatch(root string, maxChars int) (string, bool) {
	files, truncated := RepoPatchByFile(root, maxChars)
	parts := make([]string, 0, len(files))
	for _, fp := range files {
		parts = append(parts, fp.Patch)
	}
	return strings.Join(parts, "\n"), truncated
}

type FilePatch struct {
	Kind  string
	Path  string
	Patch string
}

func RepoPatchByFile(root string, maxChars int) ([]FilePatch, bool) {
	remaining := maxChars
	truncated := false
	out := []FilePatch{}

	addPatch := func(kind, path, patch string) {
		if truncated {
			return
		}
		patch = strings.TrimRight(patch, "\n")
		if strings.TrimSpace(patch) == "" {
			return
		}
		if len(patch) > remaining {
			patch = patch[:remaining]
			truncated = true
		}
		remaining -= len(patch)
		out = append(out, FilePatch{Kind: kind, Path: path, Patch: patch})
		if remaining <= 0 {
			truncated = true
		}
	}

	unstaged, _, _ := RunGit(root, 60*time.Second, "diff", "--no-color", "--no-ext-diff")
	for _, chunk := range SplitPatchByFile(unstaged) {
		addPatch("unstaged", chunk.Path, chunk.Patch)
		if truncated {
			return out, true
		}
	}

	staged, _, _ := RunGit(root, 60*time.Second, "diff", "--cached", "--no-color", "--no-ext-diff")
	for _, chunk := range SplitPatchByFile(staged) {
		addPatch("staged", chunk.Path, chunk.Patch)
		if truncated {
			return out, true
		}
	}

	untrackedList, _, _ := RunGit(root, 10*time.Second, "ls-files", "--others", "--exclude-standard")
	count := 0
	for _, file := range strings.Split(untrackedList, "\n") {
		file = strings.TrimSpace(file)
		if file == "" {
			continue
		}
		count++
		if count > 200 {
			truncated = true
			break
		}
		patch, _, _ := RunGit(root, 20*time.Second, "diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", file)
		addPatch("untracked", file, patch)
		if truncated {
			break
		}
	}

	return out, truncated
}

type PatchChunk struct {
	Path  string
	Patch string
}

func SplitPatchByFile(patch string) []PatchChunk {
	patch = strings.TrimSpace(patch)
	if patch == "" {
		return nil
	}
	lines := strings.Split(patch, "\n")
	chunks := []PatchChunk{}
	start := -1
	for i, line := range lines {
		if strings.HasPrefix(line, "diff --git ") {
			if start >= 0 {
				chunkLines := lines[start:i]
				chunks = append(chunks, PatchChunk{Path: PatchPathFromDiffHeader(lines[start]), Patch: strings.Join(chunkLines, "\n")})
			}
			start = i
		}
	}
	if start >= 0 {
		chunks = append(chunks, PatchChunk{Path: PatchPathFromDiffHeader(lines[start]), Patch: strings.Join(lines[start:], "\n")})
	} else {
		chunks = append(chunks, PatchChunk{Path: "", Patch: patch})
	}
	return chunks
}

func PatchPathFromDiffHeader(line string) string {
	parts := strings.Fields(line)
	if len(parts) >= 4 {
		path := parts[3]
		path = strings.TrimPrefix(path, "b/")
		return path
	}
	return ""
}

func RunGit(cwd string, timeout time.Duration, args ...string) (string, string, int) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = cwd
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return "", err.Error(), 1
	}
	outBytes, _ := io.ReadAll(stdout)
	errBytes, _ := io.ReadAll(stderr)
	err := cmd.Wait()
	if err != nil {
		if exitErr := (&exec.ExitError{}); errors.As(err, &exitErr) {
			return string(outBytes), string(errBytes), exitErr.ExitCode()
		}
		return string(outBytes), err.Error(), 1
	}
	return string(outBytes), string(errBytes), 0
}

func ReadWorkTreeFile(root, rel string) string {
	full := filepath.Join(root, rel)
	data, err := os.ReadFile(full)
	if err != nil {
		return ""
	}
	if len(data) > 10_000_000 {
		return ""
	}
	if BytesContainsZero(data) {
		return ""
	}
	return string(data)
}

func GitShowFile(root, spec string) string {
	out, _, code := RunGit(root, 20*time.Second, "--no-pager", "show", spec)
	if code != 0 {
		return ""
	}
	if len(out) > 10_000_000 {
		return ""
	}
	if BytesContainsZero([]byte(out)) {
		return ""
	}
	return out
}

func BytesContainsZero(data []byte) bool {
	for _, b := range data {
		if b == 0 {
			return true
		}
	}
	return false
}
