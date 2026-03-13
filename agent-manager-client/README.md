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
4. Mirrors only the generated `agent_manager_client` package into `agent-manager/seeds/coordinator/tools/agent-manager-tools`

The mirror step replaces `agent-manager/seeds/coordinator/tools/agent-manager-tools/agent_manager_client` only. It does not delete sibling files in that tool directory, so files like `README.md` are preserved across rebuilds.

## Auth Modes

Bearer/JWT auth is represented in the OpenAPI document and works with `bearer_client(...)`.

Manager API keys are the default non-browser auth path. Use `api_key_client(...)` to send `X-API-Key: <key>`.

## Example

```python
from agent_manager_client import api_key_client
from agent_manager_client.generated_client.api.images import get_images

client = api_key_client(
    base_url="https://manager.example.com",
    api_key="amk_example",
)

page = get_images.sync(client=client, limit=20)
print(page.data)
```
