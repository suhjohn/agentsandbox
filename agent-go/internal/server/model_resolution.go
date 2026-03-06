package server

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"agent-go/internal/modelcatalog"
)

var datedModelIDPattern = regexp.MustCompile(`-\d{8}$`)

type normalizedModelSelection struct {
	HasModel  bool
	Model     *string
	HasEffort bool
	Effort    *string
}

func normalizeSessionModelSelection(harness string, rawModel, rawEffort *string) (normalizedModelSelection, error) {
	explicitProvided, explicitEffort, err := normalizeReasoningEffortInput(harness, rawEffort)
	if err != nil {
		return normalizedModelSelection{}, err
	}
	if rawModel == nil {
		return normalizedModelSelection{
			HasEffort: explicitProvided,
			Effort:    explicitEffort,
		}, nil
	}

	trimmedModel := strings.TrimSpace(*rawModel)
	if trimmedModel == "" {
		return normalizedModelSelection{
			HasModel:  true,
			Model:     nil,
			HasEffort: explicitProvided,
			Effort:    explicitEffort,
		}, nil
	}

	model, inlineEffort, err := resolveHarnessModel(harness, trimmedModel)
	if err != nil {
		return normalizedModelSelection{}, err
	}
	hasEffort, effort, err := mergeReasoningEffort(inlineEffort, explicitProvided, explicitEffort)
	if err != nil {
		return normalizedModelSelection{}, err
	}
	return normalizedModelSelection{
		HasModel:  true,
		Model:     stringPtr(model),
		HasEffort: hasEffort,
		Effort:    effort,
	}, nil
}

func resolveSessionDefaultsForExecution(harness string, model, effort *string) (*string, *string, error) {
	selection, err := normalizeSessionModelSelection(harness, model, effort)
	if err != nil {
		return nil, nil, err
	}
	return selection.Model, selection.Effort, nil
}

func normalizeReasoningEffortInput(harness string, raw *string) (bool, *string, error) {
	if raw == nil {
		return false, nil, nil
	}
	trimmed := strings.ToLower(strings.TrimSpace(*raw))
	if trimmed == "" {
		return true, nil, nil
	}
	if !isValidReasoningEffortForHarness(harness, trimmed) {
		return false, nil, fail(http.StatusBadRequest, "Invalid modelReasoningEffort")
	}
	return true, stringPtr(trimmed), nil
}

func mergeReasoningEffort(inline *string, explicitProvided bool, explicit *string) (bool, *string, error) {
	if inline == nil && !explicitProvided {
		return false, nil, nil
	}
	if inline != nil && explicitProvided {
		if explicit == nil || !strings.EqualFold(strings.TrimSpace(*inline), strings.TrimSpace(*explicit)) {
			return false, nil, fail(http.StatusBadRequest, "Conflicting modelReasoningEffort")
		}
		return true, explicit, nil
	}
	if explicitProvided {
		return true, explicit, nil
	}
	return true, inline, nil
}

func resolveHarnessModel(harness, pattern string) (string, *string, error) {
	switch strings.ToLower(strings.TrimSpace(harness)) {
	case "", "codex":
		return resolveCodexModelPattern(pattern)
	case "pi":
		return resolvePIModelPattern(pattern)
	default:
		return "", nil, fail(http.StatusBadRequest, "Invalid harness")
	}
}

func resolveCodexModelPattern(pattern string) (string, *string, error) {
	model, effort, err := resolveModelPattern(pattern, modelcatalog.OpenAI(), "codex", func(def modelcatalog.ModelDef) string {
		return def.ID
	})
	if err != nil {
		return "", nil, err
	}
	return model, effort, nil
}

func resolvePIModelPattern(pattern string) (string, *string, error) {
	model, effort, err := resolveModelPattern(pattern, modelcatalog.All(), "pi", func(def modelcatalog.ModelDef) string {
		return def.Provider + "/" + def.ID
	})
	if err != nil {
		return "", nil, err
	}
	return model, effort, nil
}

func resolveModelPattern(pattern string, candidates []modelcatalog.ModelDef, harness string, canonical func(modelcatalog.ModelDef) string) (string, *string, error) {
	trimmed := strings.TrimSpace(pattern)
	if trimmed == "" {
		return "", nil, fail(http.StatusBadRequest, "model must be empty or resolvable")
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

	model, effort := parseModelPattern(patternToMatch, filtered, harness)
	if model == nil {
		return "", nil, fail(http.StatusBadRequest, fmt.Sprintf("Unknown model %q for harness %s", trimmed, strings.ToLower(strings.TrimSpace(harness))))
	}
	return canonical(*model), effort, nil
}

func parseModelPattern(pattern string, candidates []modelcatalog.ModelDef, harness string) (*modelcatalog.ModelDef, *string) {
	if model := tryMatchModel(pattern, candidates); model != nil {
		return model, nil
	}

	lastColonIndex := strings.LastIndex(pattern, ":")
	if lastColonIndex < 0 {
		return nil, nil
	}

	prefix := pattern[:lastColonIndex]
	suffix := strings.ToLower(strings.TrimSpace(pattern[lastColonIndex+1:]))
	if !isValidReasoningEffortForHarness(harness, suffix) {
		return nil, nil
	}

	model, _ := parseModelPattern(prefix, candidates, harness)
	if model == nil {
		return nil, nil
	}
	return model, stringPtr(suffix)
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

func isValidReasoningEffortForHarness(harness, value string) bool {
	switch strings.ToLower(strings.TrimSpace(harness)) {
	case "pi":
		switch value {
		case "off", "minimal", "low", "medium", "high", "xhigh":
			return true
		default:
			return false
		}
	default:
		return isValidReasoningEffort(value)
	}
}

func stringPtr(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
