# Agent Manager Tools (Python)

`agent-manager` is the control plane for sandboxed agents. It owns manager-side records such as images, agents, sessions, access tokens, API keys, and sandbox provisioning. `agent-go` is the runtime inside the sandbox. The manager creates that sandbox, injects values like `AGENT_MANAGER_BASE_URL`, `AGENT_ID`, and `AGENT_MANAGER_API_KEY`, and then the runtime uses that API key for manager calls.

This README is intentionally stored under the workspace tools tree because the bundled `agent-go/tools/*` directories are exposed inside the sandbox workspace, so Codex and PI can discover this file and use the generated client from the running agent environment.

Use this tool when you need to talk to manager-owned APIs such as:

- images and image variants
- environment secret bindings
- agent creation, access, archive, and resume
- session creation and coordinator conversation export
- manager callbacks and general manager API calls from inside the sandbox

Do not use this tool for direct runtime shell access, browser automation, or SQLite inspection inside the sandbox. Those are runtime concerns, not manager API concerns.

From the workspace root inside the sandbox, import the mirrored package by adding this directory to `sys.path`:

```python
import sys
sys.path.append("tools/agent-manager-tools")
```

From the `agent-go/` repo checkout directly, use `agent-go/tools/agent-manager-tools` instead.

## Python API

Inside a normal `agent-go` sandbox, the auth you have by default is the injected manager API key:

```python
import os
import sys

sys.path.append("tools/agent-manager-tools")

from agent_manager_client import api_key_client
from agent_manager_client.generated_client.api.agents import post_agents_agent_id_snapshot

client = api_key_client(
    base_url=os.environ["AGENT_MANAGER_BASE_URL"],
    api_key=os.environ["AGENT_MANAGER_API_KEY"],
    raise_on_unexpected_status=True,
)

post_agents_agent_id_snapshot.sync(
    agent_id=os.environ["AGENT_ID"],
    client=client,
)
```

The same API key can also call normal manager routes if its scopes allow them.

## Auth Modes

### API key auth

Use `api_key_client(...)` for manager API calls from the sandbox or any external caller with a manager API key:

```python
from agent_manager_client import api_key_client

client = api_key_client(
    base_url="https://manager.example.com",
    api_key="<manager api key>",
    raise_on_unexpected_status=True,
)
```

This sends `X-API-Key: <key>`.

## Guideline

- Prefer `sync(...)` for simple scripts and `sync_detailed(...)` when you need status codes and raw headers.
- Manager list endpoints return rows in `.data` and pagination in `.next_cursor`.
- Treat generated models as the source of truth for field names. Use snake_case in Python; the client serializes to the manager's JSON field names.
- Use `raise_on_unexpected_status=True` while developing so auth and transport mistakes fail loudly.
- Inside a running `agent-go` sandbox, assume you have `AGENT_MANAGER_BASE_URL`, `AGENT_MANAGER_API_KEY`, and `AGENT_ID`.
- Use `api_key_client(...)` for manager routes from the sandbox.
- Use `bearer_client(...)` only when you explicitly have a user JWT or another bearer credential intended for manager routes.
- When you need runtime access, ask the manager for it first with `GET /agents/{agentId}/access`; then use the returned `agent_api_url` and `agent_auth_token` outside this generated client.
- `agent_manager_client` covers manager APIs. It does not replace sandbox shell access, browser tooling, or direct runtime SQLite inspection.

## Modules

### Common Imports

```python
import os
import sys
from uuid import UUID

sys.path.append("tools/agent-manager-tools")

from agent_manager_client import api_key_client, bearer_client
from agent_manager_client.generated_client.types import UNSET
```

The snippets below use one of these two clients:

```python
api_client = api_key_client(
    base_url=os.environ["AGENT_MANAGER_BASE_URL"],
    api_key=os.environ["AGENT_MANAGER_API_KEY"],
    raise_on_unexpected_status=True,
)

manager_client = bearer_client(
    base_url=os.environ["AGENT_MANAGER_BASE_URL"],
    token="<user bearer token>",
    raise_on_unexpected_status=True,
)
```

`api_client` is the default in-sandbox case. `manager_client` only works if some caller explicitly provides a user bearer token.

### Spin Up Agent + First Prompt

Coordinator case: create an agent from an image, create/fetch its deterministic runtime session, and start the first run.

This is a manager-side flow. It requires `manager_client` or an API key with permission for `POST /session`.

```python
from agent_manager_client.generated_client.api.session import post_session
from agent_manager_client.generated_client.models.post_session_body import PostSessionBody

result = post_session.sync(
    client=manager_client,
    body=PostSessionBody(
        image_id="<image-uuid>",
        message="Implement highlights in EpubReaderV2 and report the plan.",
        title="Epub Highlights",
        harness="codex",
    ),
)

print(result.agent.id)
print(result.session.id)
print(result.session.run_id)
print(result.session.stream_url)
print(result.session.run_stream_url)
print(result.access.agent_api_url)
print(result.access.agent_auth_token)
```

Notes:

- Resolve `image_id` from `GET /images`.
- The runtime session id is deterministic from the returned `agent.id`.
- Use the returned `access` payload for runtime/browser connections, not the manager bearer token.

### List Images

Coordinator case: enumerate images, paginate, and pick by name before creating agents.

```python
from agent_manager_client.generated_client.api.images import get_images

page = get_images.sync(client=manager_client, limit=50)
for item in page.data:
    print(item.id, item.name, item.created_by, item.default_variant_id)

if page.next_cursor:
    next_page = get_images.sync(client=manager_client, limit=50, cursor=page.next_cursor)
```

Notes:

- Read rows from `response.data`, not `response.images`.
- Read pagination from `response.next_cursor`.

### Build and Validate an Image

Coordinator case: choose a variant, trigger a build, then inspect active/draft image ids.

```python
from agent_manager_client.generated_client.api.images import (
    get_images_image_id_variants,
    post_images_image_id_build,
)
from agent_manager_client.generated_client.models.post_images_image_id_build_body import (
    PostImagesImageIdBuildBody,
)

image_id = "<image-uuid>"
variants = get_images_image_id_variants.sync(image_id=image_id, client=manager_client)

variant = variants.data[0]
result = post_images_image_id_build.sync(
    image_id=image_id,
    client=manager_client,
    body=PostImagesImageIdBuildBody(variant_id=UUID(variant.id)),
)

print("built variant:", result.variant.id)
print("draft image id:", result.variant.draft_image_id)
print("active image id:", result.variant.active_image_id)
```

Notes:

- The generated build route expects a `variant_id`.
- For setup-sandbox editing of `/shared/image/hooks/build.sh`, use terminal/setup sandbox APIs or other sandbox tooling; that edit path is not handled by `generated_client` alone.

### Create and Manage Agents from an Image

Coordinator case: create agents directly, fetch access links, archive/resume, and inspect status.

```python
from agent_manager_client.generated_client.api.agents import (
    get_agents_agent_id,
    get_agents_agent_id_access,
    post_agents,
    post_agents_agent_id_archive,
    post_agents_agent_id_resume,
)
from agent_manager_client.generated_client.models.post_agents_body import PostAgentsBody

agent = post_agents.sync(
    client=manager_client,
    body=PostAgentsBody(
        image_id=UUID("<image-uuid>"),
        variant_id=UUID("<variant-uuid>"),
    ),
)

agent_id = agent.id
access = get_agents_agent_id_access.sync(agent_id=agent_id, client=manager_client)
print(access.agent_api_url, access.agent_auth_token)

status = get_agents_agent_id.sync(agent_id=agent_id, client=manager_client)
print(status.status)

post_agents_agent_id_archive.sync(agent_id=agent_id, client=manager_client)
post_agents_agent_id_resume.sync(agent_id=agent_id, client=manager_client)
```

Notes:

- The manager generates the agent id and default name.
- Before creating an agent, validate that the chosen variant has a non-empty `active_image_id`.

### Continue Existing Agent Run

Coordinator case: send a follow-up prompt to an existing agent.

```python
from agent_manager_client.generated_client.api.agents import post_agents_agent_id_session
from agent_manager_client.generated_client.models.post_agents_agent_id_session_body import (
    PostAgentsAgentIdSessionBody,
)

result = post_agents_agent_id_session.sync(
    agent_id="<agent-uuid>",
    client=manager_client,
    body=PostAgentsAgentIdSessionBody(
        message="Continue the analysis and summarize the backend request lifecycle.",
        title="Backend Deep Dive",
    ),
)

print(result.agent.id)
print(result.session.id)
print(result.session.run_id)
print(result.session.stream_url)
```

Notes:

- Optional `session_id` must be 32 hex if you provide it.
- This is the manager-side way to resume an agent. Do not send the manager bearer token straight to runtime `/session/*` routes.

### Export Conversation Data to Agent Sandbox JSON

Coordinator case: fetch coordinator-session data before writing it into a sandbox file.

```python
from agent_manager_client.generated_client.api.agent import (
    get_coordinator_session,
    get_coordinator_session_coordinator_session_id_messages,
)

sessions = get_coordinator_session.sync(client=manager_client)
for session in sessions.data:
    print(session.id, session.title)

messages = get_coordinator_session_coordinator_session_id_messages.sync(
    coordinator_session_id="<coordinator-session-id>",
    client=manager_client,
)

payload = [message.to_dict() for message in messages.data]
print("message count:", len(payload))
```

Notes:

- `generated_client` gets the JSON payload from manager APIs.
- Writing that payload into an agent sandbox file is a separate runtime/sandbox step and is not done by this package.

### Agent Runtime Inspection (Status + Data)

Coordinator case: inspect runtime access state, terminal URLs, or session metadata before using sandbox tools.

Use manager APIs to fetch access and terminal credentials:

```python
from agent_manager_client.generated_client.api.agents import get_agents_agent_id_access
from agent_manager_client.generated_client.api.terminal import post_terminal_connect
from agent_manager_client.generated_client.models.post_terminal_connect_body_type_1 import (
    PostTerminalConnectBodyType1,
)
from agent_manager_client.generated_client.models.post_terminal_connect_body_type_1_target_type import (
    PostTerminalConnectBodyType1TargetType,
)

access = get_agents_agent_id_access.sync(agent_id="<agent-uuid>", client=manager_client)
print(access.agent_api_url, access.agent_session_id)

terminal = post_terminal_connect.sync(
    client=manager_client,
    body=PostTerminalConnectBodyType1(
        target_type=PostTerminalConnectBodyType1TargetType.AGENTSANDBOX,
        target_id=UUID("<agent-uuid>"),
    ),
)
print(terminal.ws_url)
print(terminal.terminal_url)
```

For direct runtime inspection:

- use the returned `agent_api_url` + `agent_auth_token` for runtime HTTP calls
- use terminal access or sandbox shell tools for process/filesystem/SQLite inspection
- use browser tools separately for browser-state inspection

`generated_client` does not run shell commands, query SQLite inside the sandbox, or inspect runtime files directly.

### Runtime Callback Sync Back to Manager

This is not a coordinator-exposed user flow, but it is part of the manager contract. It now uses the sandbox API key like any other manager route.

```python
from agent_manager_client import api_key_client
from agent_manager_client.generated_client.api.session import put_session_id
from agent_manager_client.generated_client.api.agents import post_agents_agent_id_snapshot
from agent_manager_client.generated_client.models.put_session_id_body import PutSessionIdBody

runtime_client = api_key_client(
    base_url=os.environ["AGENT_MANAGER_BASE_URL"],
    api_key=os.environ["AGENT_MANAGER_API_KEY"],
    raise_on_unexpected_status=True,
)

put_session_id.sync(
    id="<32-hex-session-id>",
    client=runtime_client,
    body=PutSessionIdBody(
        agent_id=os.environ["AGENT_ID"],
        status="processing",
        harness="codex",
        title="Deep Dive",
    ),
)

post_agents_agent_id_snapshot.sync(
    agent_id=os.environ["AGENT_ID"],
    client=runtime_client,
)
```

## Examples

### Resolve an image by name, then create a first-run session

```python
from agent_manager_client.generated_client.api.images import get_images
from agent_manager_client.generated_client.api.session import post_session
from agent_manager_client.generated_client.models.post_session_body import PostSessionBody

images = get_images.sync(client=manager_client, limit=50)
target = next(item for item in images.data if item.name == "alexandria0")

session = post_session.sync(
    client=manager_client,
    body=PostSessionBody(
        image_id=target.id,
        message="Do a deep dive on the server implementation from entrypoint to handlers.",
        title="Alexandria Server Deep Dive",
    ),
)

print(session.agent.id, session.session.run_id)
```

### Typical manager-side recipe chain

Use these building blocks in the same order as the coordinator:

1. `get_images.sync(...)` to resolve image ids.
2. `get_images_image_id_variants.sync(...)` when variant or active image state matters.
3. `post_session.sync(...)` or `post_agents.sync(...)` depending on whether you want bootstrap-first-run or bare agent creation.
4. `get_agents_agent_id_access.sync(...)` or `post_terminal_connect.sync(...)` when you need runtime/browser/terminal access.
5. `post_agents_agent_id_session.sync(...)` for follow-up prompts.
6. `get_coordinator_session*.sync(...)` for coordinator conversation export or audit.
