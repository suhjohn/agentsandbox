package server

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type runRequest struct {
	Input                []inputItem `json:"input"`
	Model                *string     `json:"model"`
	ModelReasoningEffort *string     `json:"modelReasoningEffort"`
}

type inputItem struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Path     string `json:"path,omitempty"`
	Data     string `json:"data,omitempty"`
	Filename string `json:"filename,omitempty"`
}

type normalizedInput struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	Path string `json:"path,omitempty"`
}

func (s *server) normalizeInputs(sessionID string, input []inputItem) ([]normalizedInput, error) {
	out := make([]normalizedInput, 0, len(input))
	for _, item := range input {
		switch item.Type {
		case "text":
			text := strings.TrimSpace(item.Text)
			if text == "" {
				return nil, errors.New("text input must be non-empty")
			}
			out = append(out, normalizedInput{Type: "text", Text: text})
		case "local_image":
			p := strings.TrimSpace(item.Path)
			if p == "" {
				return nil, errors.New("local_image.path is required")
			}
			out = append(out, normalizedInput{Type: "local_image", Path: p})
		case "image":
			path, err := s.persistDataURLImage(sessionID, strings.TrimSpace(item.Data))
			if err != nil {
				return nil, err
			}
			out = append(out, normalizedInput{Type: "local_image", Path: path})
		default:
			return nil, fmt.Errorf("unsupported input type: %s", item.Type)
		}
	}
	return out, nil
}

func (s *server) persistDataURLImage(sessionID, dataURL string) (string, error) {
	if !strings.HasPrefix(strings.ToLower(dataURL), "data:") {
		return "", errors.New("image.data must be a data URL (data:<mime>;base64,...)")
	}
	comma := strings.IndexByte(dataURL, ',')
	if comma < 0 {
		return "", errors.New("invalid data URL")
	}
	header := dataURL[:comma]
	payload := strings.TrimSpace(dataURL[comma+1:])
	if !strings.Contains(strings.ToLower(header), ";base64") {
		return "", errors.New("image.data must include ;base64")
	}
	parts := strings.Split(strings.TrimPrefix(header, "data:"), ";")
	mime := strings.ToLower(strings.TrimSpace(parts[0]))
	ext := imageExtForMime(mime)
	if ext == "" {
		return "", fmt.Errorf("unsupported image mime type: %s", mime)
	}

	decoded, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(strings.ReplaceAll(payload, "-", "+"), "_", "/"))
	if err != nil {
		return "", errors.New("invalid base64 image data")
	}
	if len(decoded) == 0 {
		return "", errors.New("empty image data")
	}

	dir := filepath.Join(s.cfg.RuntimeDir, "runtime", "api-images", sessionID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	filename := fmt.Sprintf("%d-%s%s", time.Now().UnixMilli(), randomHex(8), ext)
	path := filepath.Join(dir, filename)
	if err := os.WriteFile(path, decoded, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func imageExtForMime(mime string) string {
	switch mime {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/heic":
		return ".heic"
	case "image/heif":
		return ".heif"
	default:
		return ""
	}
}

func titleFromInputs(input []normalizedInput) string {
	text := textFromInputs(input)
	if text == "" {
		return ""
	}
	parts := strings.Fields(text)
	if len(parts) == 0 {
		return ""
	}
	if len(parts) > 8 {
		parts = parts[:8]
	}
	title := strings.Join(parts, " ")
	if len(title) > 80 {
		title = title[:80]
	}
	return strings.TrimSpace(title)
}

func textFromInputs(input []normalizedInput) string {
	parts := []string{}
	for _, item := range input {
		if item.Type == "text" && strings.TrimSpace(item.Text) != "" {
			parts = append(parts, strings.TrimSpace(item.Text))
		}
	}
	return strings.Join(parts, "\n")
}

func (s *server) maybeGenerateSessionTitleAsync(sessionID string, input []normalizedInput) {
	text := textFromInputs(input)
	if strings.TrimSpace(text) == "" {
		return
	}
	fallbackTitle := titleFromInputs(input)
	go func() {
		session, err := s.store.getSessionByID(sessionID)
		if err != nil || session == nil {
			return
		}
		if session.Title != nil && strings.TrimSpace(*session.Title) != "" {
			return
		}

		title, err := s.generateSessionTitleFromText(text)
		if err != nil || strings.TrimSpace(title) == "" {
			title = fallbackTitle
		}
		title = strings.TrimSpace(title)
		if title == "" {
			return
		}
		if err := s.store.updateSessionTitleIfEmpty(sessionID, title); err == nil {
			s.queueManagerSessionSync(sessionID)
		}
	}()
}

func (s *server) generateSessionTitleFromText(sourceText string) (string, error) {
	trimmed := strings.TrimSpace(sourceText)
	if trimmed == "" {
		return "", nil
	}

	resolvedModel, _, err := s.materializeSessionDefaults("codex", nil, nil)
	if err != nil {
		return "", err
	}
	model := ""
	if resolvedModel != nil {
		model = strings.TrimSpace(*resolvedModel)
	}
	if model == "" {
		return "", errors.New("missing default model")
	}

	tempFile, err := os.CreateTemp("", "agent-title-*.txt")
	if err != nil {
		return "", err
	}
	tempPath := tempFile.Name()
	_ = tempFile.Close()
	defer func() { _ = os.Remove(tempPath) }()

	prompt := "Write a concise, 3-6 word title for this request. Return only the title.\n\nRequest:\n" + trimmed
	titleCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	result, err := s.codex.Run(titleCtx, s.codex.ExecArgs(CodexExecOptions{
		CodexRootOptions: CodexRootOptions{
			CodexGlobalOptions: CodexGlobalOptions{
				Config: []string{`model_reasoning_effort="minimal"`},
			},
			Prompt:  prompt,
			Model:   model,
			Sandbox: "read-only",
			CD:      s.cfg.DefaultWorkingDir,
		},
		SkipGitRepoCheck:  true,
		OutputLastMessage: tempPath,
	}), nil)
	if err != nil {
		return "", err
	}

	rawTitle := ""
	if bytes, readErr := os.ReadFile(tempPath); readErr == nil {
		rawTitle = strings.TrimSpace(string(bytes))
	}
	if rawTitle == "" {
		rawTitle = strings.TrimSpace(result.Stdout)
	}
	title := sanitizeGeneratedTitle(rawTitle)
	if title == "" {
		return "", errors.New("empty title")
	}
	return title, nil
}

func sanitizeGeneratedTitle(value string) string {
	text := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\r", " "), "\n", " "))
	if text == "" {
		return ""
	}
	text = strings.TrimSpace(strings.TrimLeft(strings.TrimRight(text, `"'`), `"'`))
	text = strings.TrimSpace(strings.TrimRight(text, ".!?"))
	if text == "" {
		return ""
	}
	if len(text) > 120 {
		text = strings.TrimSpace(text[:120])
	}
	return text
}
