package modelcatalog

import (
	_ "embed"
	"encoding/json"
	"sync"
)

type ModelDef struct {
	Provider  string `json:"provider"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Reasoning bool   `json:"reasoning"`
}

type catalogPayload struct {
	Models []ModelDef `json:"models"`
}

var (
	//go:embed models.generated.json
	catalogJSON []byte
	loadOnce    sync.Once
	allModels   []ModelDef
	loadErr     error
)

func All() []ModelDef {
	loadOnce.Do(func() {
		var payload catalogPayload
		loadErr = json.Unmarshal(catalogJSON, &payload)
		if loadErr != nil {
			return
		}
		allModels = append([]ModelDef(nil), payload.Models...)
	})
	if loadErr != nil {
		panic(loadErr)
	}
	out := make([]ModelDef, len(allModels))
	copy(out, allModels)
	return out
}

func OpenAI() []ModelDef {
	all := All()
	out := make([]ModelDef, 0, len(all))
	for _, model := range all {
		if model.Provider == "openai" {
			out = append(out, model)
		}
	}
	return out
}
