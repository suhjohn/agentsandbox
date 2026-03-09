package registry

import "strings"

func PromptFromInputs(input []Input) string {
	parts := make([]string, 0, len(input))
	for _, item := range input {
		switch item.Type {
		case "text":
			if text := strings.TrimSpace(item.Text); text != "" {
				parts = append(parts, text)
			}
		case "local_image":
			if path := strings.TrimSpace(item.Path); path != "" {
				parts = append(parts, "[image: "+path+"]")
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func FirstNonEmptyString(values ...any) string {
	for _, value := range values {
		switch t := value.(type) {
		case string:
			if s := strings.TrimSpace(t); s != "" {
				return s
			}
		case []any:
			if s := FirstNonEmptyString(t...); s != "" {
				return s
			}
		case map[string]any:
			if s := FirstNonEmptyString(t["text"], t["content"], t["output_text"]); s != "" {
				return s
			}
		}
	}
	return ""
}

func StringPtr(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
