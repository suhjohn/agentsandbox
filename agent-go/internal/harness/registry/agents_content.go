package registry

import "strings"

func SharedAgentsSection(ctx RuntimeContext) string {
	path := strings.TrimSpace(ctx.SharedAgentsPath)
	body := strings.TrimSpace(ctx.SharedAgentsContent)
	if body == "" {
		return ""
	}

	var content strings.Builder
	content.WriteString("# Shared Instructions\n")
	if path != "" {
		content.WriteString("- Source: " + path + "\n")
	}
	content.WriteString("\n")
	content.WriteString(body)
	content.WriteString("\n\n")
	return content.String()
}
