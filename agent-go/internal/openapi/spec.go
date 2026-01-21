package openapi

import _ "embed"

// Spec is the canonical runtime OpenAPI contract served by GET /openapi.json.
//
// Keep this file in sync with any client generation (for example, Orval in
// agent-manager-web).
//
//go:embed openapi.json
var Spec []byte

