# Agent Manager Tools (Python)

Generated Python client for the `agent-manager` control plane (images, agents, sessions, access tokens, API keys, sandbox provisioning). **Not** for runtime shell access, browser automation, or SQLite inspection — those are runtime concerns.

`agent-manager` creates sandboxes and injects `AGENT_MANAGER_BASE_URL`, `AGENT_ID`, and `AGENT_MANAGER_API_KEY`. The `agent-go` runtime inside the sandbox uses that API key for manager calls. This README lives under the coordinator tool tree so Codex/PI can discover it from inside the sandbox.

## Setup

```python
import sys
sys.path.append("tools/agent-manager-tools")  # sandbox path
# or: sys.path.append("agent-manager/seeds/coordinator/tools/agent-manager-tools")  # repo checkout
```

## Auth

`api_key_client` sends `X-API-Key` and is used for all manager API calls from the sandbox or any external caller with a manager API key.

```python
import os
from agent_manager_client import api_key_client

client = api_key_client(
    base_url=os.environ["AGENT_MANAGER_BASE_URL"],
    api_key=os.environ["AGENT_MANAGER_API_KEY"],
    raise_on_unexpected_status=True,
)
```

## Guidelines

- `sync(...)` for simple scripts; `sync_detailed(...)` when you need status codes/headers.
- List endpoints: rows in `.data`, pagination in `.next_cursor`.
- Generated models are source of truth for field names (snake_case in Python, auto-serialized to JSON).
- Always use `raise_on_unexpected_status=True` during development.
- Runtime access: call `GET /agents/{agentId}/access` first, then use returned `agent_api_url` + `agent_auth_token` outside this client.

## API Reference

Common imports used in all snippets below:

```python
import os, sys
from uuid import UUID
sys.path.append("tools/agent-manager-tools")
from agent_manager_client import api_key_client
from agent_manager_client.generated_client.types import UNSET
```

### Create Session (Agent + First Prompt)

Requires an API key scoped for `POST /session`. Creates agent from image, creates deterministic runtime session, starts first run.

```python
from agent_manager_client.generated_client.api.session import post_session
from agent_manager_client.generated_client.models.post_session_body import PostSessionBody

result = post_session.sync(
    client=client,
    body=PostSessionBody(
        image_id="<image-uuid>",  # resolve via get_images
        message="Implement highlights in EpubReaderV2 and report the plan.",
        title="Epub Highlights",
        harness="codex",
    ),
)
# result.agent.id, result.session.{id, run_id, stream_url, run_stream_url}
# result.access.{agent_api_url, agent_auth_token} — use these for runtime connections
```

### List Images

```python
from agent_manager_client.generated_client.api.images import get_images

page = get_images.sync(client=client, limit=50)
for img in page.data:
    print(img.id, img.name, img.created_by, img.default_variant_id)
if page.next_cursor:
    next_page = get_images.sync(client=client, limit=50, cursor=page.next_cursor)
```

### Build Image

```python
from agent_manager_client.generated_client.api.images import (
    get_images_image_id_variants, post_images_image_id_build,
)
from agent_manager_client.generated_client.models.post_images_image_id_build_body import PostImagesImageIdBuildBody

variants = get_images_image_id_variants.sync(image_id="<image-uuid>", client=client)
result = post_images_image_id_build.sync(
    image_id="<image-uuid>", client=client,
    body=PostImagesImageIdBuildBody(variant_id=UUID(variants.data[0].id)),
)
# result.variant.{id, draft_image_id, active_image_id}
```

### Create & Manage Agents

```python
from agent_manager_client.generated_client.api.agents import (
    get_agents_agent_id, get_agents_agent_id_access, post_agents,
    post_agents_agent_id_archive, post_agents_agent_id_resume,
)
from agent_manager_client.generated_client.models.post_agents_body import PostAgentsBody

# Create — validate variant has non-empty active_image_id first
agent = post_agents.sync(client=client, body=PostAgentsBody(
    image_id=UUID("<image-uuid>"), variant_id=UUID("<variant-uuid>"),
))

# Access
access = get_agents_agent_id_access.sync(agent_id=agent.id, client=client)
# access.{agent_api_url, agent_auth_token}

# Status / lifecycle
status = get_agents_agent_id.sync(agent_id=agent.id, client=client)
post_agents_agent_id_archive.sync(agent_id=agent.id, client=client)
post_agents_agent_id_resume.sync(agent_id=agent.id, client=client)
```

### Follow-Up Prompt (Continue Agent Run)

```python
from agent_manager_client.generated_client.api.agents import post_agents_agent_id_session
from agent_manager_client.generated_client.models.post_agents_agent_id_session_body import PostAgentsAgentIdSessionBody

result = post_agents_agent_id_session.sync(
    agent_id="<agent-uuid>", client=client,
    body=PostAgentsAgentIdSessionBody(
        message="Continue the analysis and summarize the backend request lifecycle.",
        title="Backend Deep Dive",
    ),
)
# result.{agent.id, session.id, session.run_id, session.stream_url}
# Optional session_id must be 32 hex.
```

### Export Session Data

```python
from agent_manager_client.generated_client.api.session import get_session, get_session_id

sessions = get_session.sync(client=client, limit=20)
detail = get_session_id.sync(id="<session-id>", client=client)
payload = detail.to_dict()  # writing to sandbox file is a separate runtime step
```

### Terminal / Runtime Inspection

```python
from agent_manager_client.generated_client.api.agents import get_agents_agent_id_access
from agent_manager_client.generated_client.api.terminal import post_terminal_connect
from agent_manager_client.generated_client.models.post_terminal_connect_body_type_1 import PostTerminalConnectBodyType1
from agent_manager_client.generated_client.models.post_terminal_connect_body_type_1_target_type import PostTerminalConnectBodyType1TargetType

access = get_agents_agent_id_access.sync(agent_id="<agent-uuid>", client=client)
terminal = post_terminal_connect.sync(client=client, body=PostTerminalConnectBodyType1(
    target_type=PostTerminalConnectBodyType1TargetType.AGENTSANDBOX,
    target_id=UUID("<agent-uuid>"),
))
# terminal.{ws_url, terminal_url}
# For direct runtime: use agent_api_url + agent_auth_token for HTTP, terminal/shell for filesystem/SQLite
```

### Runtime Callback to Manager

From inside the sandbox, sync state back to the manager using the injected API key:

```python
from agent_manager_client.generated_client.api.session import put_session_id
from agent_manager_client.generated_client.api.agents import post_agents_agent_id_snapshot
from agent_manager_client.generated_client.models.put_session_id_body import PutSessionIdBody

put_session_id.sync(id="<32-hex-session-id>", client=client, body=PutSessionIdBody(
    agent_id=os.environ["AGENT_ID"], status="processing", harness="codex", title="Deep Dive",
))
post_agents_agent_id_snapshot.sync(agent_id=os.environ["AGENT_ID"], client=client)
```

## Typical Flow

1. `get_images` — resolve image ids
2. `get_images_image_id_variants` — check variant/active image state
3. `post_session` (bootstrap + first run) or `post_agents` (bare agent creation)
4. `get_agents_agent_id_access` / `post_terminal_connect` — runtime/browser/terminal access
5. `post_agents_agent_id_session` — follow-up prompts
6. `get_session` / `get_session_id` — conversation export/audit
