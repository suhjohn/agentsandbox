package registry

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"agent-go/internal/apierr"
	"agent-go/internal/modelcatalog"
)

var datedModelIDPattern = regexp.MustCompile(`-\d{8}$`)

type ResolveModelFunc func(pattern string) (string, *string, error)

func NormalizeModelSelection(rawModel, rawEffort *string, resolve ResolveModelFunc, validEffort func(string) bool) (*string, *string, error) {
	explicitProvided, explicitEffort, err := normalizeReasoningEffortInput(rawEffort, validEffort)
	if err != nil {
		return nil, nil, err
	}
	if rawModel == nil {
		return nil, explicitEffort, nil
	}

	trimmedModel := strings.TrimSpace(*rawModel)
	if trimmedModel == "" {
		return nil, explicitEffort, nil
	}

	model, inlineEffort, err := resolve(trimmedModel)
	if err != nil {
		return nil, nil, err
	}
	_, effort, err := mergeReasoningEffort(inlineEffort, explicitProvided, explicitEffort)
	if err != nil {
		return nil, nil, err
	}
	return StringPtr(model), effort, nil
}

func normalizeReasoningEffortInput(raw *string, validEffort func(string) bool) (bool, *string, error) {
	if raw == nil {
		return false, nil, nil
	}
	trimmed := strings.ToLower(strings.TrimSpace(*raw))
	if trimmed == "" {
		return true, nil, nil
	}
	if !validEffort(trimmed) {
		return false, nil, apierr.Fail(http.StatusBadRequest, "Invalid modelReasoningEffort")
	}
	return true, StringPtr(trimmed), nil
}

func mergeReasoningEffort(inline *string, explicitProvided bool, explicit *string) (bool, *string, error) {
	if inline == nil && !explicitProvided {
		return false, nil, nil
	}
	if inline != nil && explicitProvided {
		if explicit == nil || !strings.EqualFold(strings.TrimSpace(*inline), strings.TrimSpace(*explicit)) {
			return false, nil, apierr.Fail(http.StatusBadRequest, "Conflicting modelReasoningEffort")
		}
		return true, explicit, nil
	}
	if explicitProvided {
		return true, explicit, nil
	}
	return true, inline, nil
}

func ResolveCatalogModelPattern(pattern string, candidates []modelcatalog.ModelDef, harness string, canonical func(modelcatalog.ModelDef) string, validEffort func(string) bool) (string, *string, error) {
	trimmed := strings.TrimSpace(pattern)
	if trimmed == "" {
		return "", nil, apierr.Fail(http.StatusBadRequest, "model must be empty or resolvable")
	}
	if len(candidates) == 0 {
		return "", nil, fmt.Errorf("no models configured for harness %s", harness)
	}

	if exact := findExactModel(trimmed, candidates); exact != nil {
		return canonical(*exact), nil, nil
	}

	providerMap := make(map[string]string, len(candidates))
	for _, model := range candidates {
		providerMap[strings.ToLower(model.Provider)] = model.Provider
	}

	filtered := candidates
	patternToMatch := trimmed
	if slashIndex := strings.Index(trimmed, "/"); slashIndex >= 0 {
		maybeProvider := trimmed[:slashIndex]
		if provider, ok := providerMap[strings.ToLower(maybeProvider)]; ok {
			filtered = filterModelsByProvider(candidates, provider)
			patternToMatch = trimmed[slashIndex+1:]
		}
	}

	model, effort := parseModelPattern(patternToMatch, filtered, validEffort)
	if model == nil {
		return "", nil, apierr.Fail(http.StatusBadRequest, fmt.Sprintf("Unknown model %q for harness %s", trimmed, strings.ToLower(strings.TrimSpace(harness))))
	}
	return canonical(*model), effort, nil
}

func parseModelPattern(pattern string, candidates []modelcatalog.ModelDef, validEffort func(string) bool) (*modelcatalog.ModelDef, *string) {
	if model := tryMatchModel(pattern, candidates); model != nil {
		return model, nil
	}

	lastColonIndex := strings.LastIndex(pattern, ":")
	if lastColonIndex < 0 {
		return nil, nil
	}

	prefix := pattern[:lastColonIndex]
	suffix := strings.ToLower(strings.TrimSpace(pattern[lastColonIndex+1:]))
	if !validEffort(suffix) {
		return nil, nil
	}

	model, _ := parseModelPattern(prefix, candidates, validEffort)
	if model == nil {
		return nil, nil
	}
	return model, StringPtr(suffix)
}

func tryMatchModel(pattern string, candidates []modelcatalog.ModelDef) *modelcatalog.ModelDef {
	trimmed := strings.TrimSpace(pattern)
	if trimmed == "" {
		return nil
	}
	if slashIndex := strings.Index(trimmed, "/"); slashIndex >= 0 {
		provider := trimmed[:slashIndex]
		id := trimmed[slashIndex+1:]
		for i := range candidates {
			if strings.EqualFold(candidates[i].Provider, provider) && strings.EqualFold(candidates[i].ID, id) {
				return &candidates[i]
			}
		}
	}
	for i := range candidates {
		if strings.EqualFold(candidates[i].ID, trimmed) {
			return &candidates[i]
		}
	}

	lower := strings.ToLower(trimmed)
	matches := make([]modelcatalog.ModelDef, 0, 8)
	for _, candidate := range candidates {
		if strings.Contains(strings.ToLower(candidate.ID), lower) || strings.Contains(strings.ToLower(candidate.Name), lower) {
			matches = append(matches, candidate)
		}
	}
	if len(matches) == 0 {
		return nil
	}

	aliases := make([]modelcatalog.ModelDef, 0, len(matches))
	dated := make([]modelcatalog.ModelDef, 0, len(matches))
	for _, match := range matches {
		if isAliasModelID(match.ID) {
			aliases = append(aliases, match)
		} else {
			dated = append(dated, match)
		}
	}
	best := aliases
	if len(best) == 0 {
		best = dated
	}
	if len(best) == 0 {
		return nil
	}
	bestIndex := 0
	for i := 1; i < len(best); i++ {
		if best[i].ID > best[bestIndex].ID {
			bestIndex = i
		}
	}
	return &best[bestIndex]
}

func filterModelsByProvider(candidates []modelcatalog.ModelDef, provider string) []modelcatalog.ModelDef {
	filtered := make([]modelcatalog.ModelDef, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.Provider == provider {
			filtered = append(filtered, candidate)
		}
	}
	return filtered
}

func findExactModel(pattern string, candidates []modelcatalog.ModelDef) *modelcatalog.ModelDef {
	trimmed := strings.TrimSpace(pattern)
	for i := range candidates {
		if strings.EqualFold(candidates[i].ID, trimmed) || strings.EqualFold(candidates[i].Provider+"/"+candidates[i].ID, trimmed) {
			return &candidates[i]
		}
	}
	return nil
}

func isAliasModelID(id string) bool {
	if strings.HasSuffix(id, "-latest") {
		return true
	}
	return !datedModelIDPattern.MatchString(id)
}

func IsValidStandardReasoningEffort(value string) bool {
	switch value {
	case "minimal", "low", "medium", "high", "xhigh":
		return true
	default:
		return false
	}
}
