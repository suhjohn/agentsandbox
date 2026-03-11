# agent-manager-client

Python client artifacts generated from `agent-manager/openapi.json`.

This package assumes `uv` for local Python workflow management.

## Setup

```bash
cd agent-manager-client
uv sync
```

## Regenerate

```bash
uv run scripts/generate.py
```

That script:

1. Regenerates `agent-manager/openapi.json`
2. Copies the spec into this package
3. Regenerates the Python client package with `openapi-python-client`
4. Mirrors only the generated `agent_manager_client` package into `agent-go/tools/agent-manager-tools`

The mirror step replaces `agent-go/tools/agent-manager-tools/agent_manager_client` only. It does not delete sibling files in `agent-go/tools/agent-manager-tools`, so files like `README.md` are preserved across rebuilds.

## Auth Modes

Bearer/JWT auth is represented in the OpenAPI document and works with `bearer_client(...)`.

Runtime-internal auth is a real manager auth path but is not modeled as a separate security scheme in the OpenAPI spec. For the runtime callback flow, the runtime injects headers only at dispatch time:

- `X-Agent-Internal-Auth: <AGENT_INTERNAL_AUTH_SECRET>`
- `X-Agent-Id: <AGENT_ID>`

Use `runtime_internal_client(...)` for that path. It configures the generated client to send those headers without adding an `Authorization: Bearer ...` header.

## Example

```python
from agent_manager_client import runtime_internal_client
from agent_manager_client.generated_client.api.session import put_session_id
from agent_manager_client.generated_client.models.put_session_id_body import PutSessionIdBody

client = runtime_internal_client(
    base_url="https://manager.example.com",
    internal_auth_secret="secret",
    agent_id="agent-123",
)

put_session_id.sync(
    id="session-123",
    client=client,
    body=PutSessionIdBody(
        agent_id="agent-123",
        created_by="runtime-internal",
        status="initial",
        harness="codex",
    ),
)
```
