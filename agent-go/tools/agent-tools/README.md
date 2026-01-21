# Agent Tools (Python)

Client-side wrappers for the `agent-go` HTTP APIs.

## Environment

- `AGENT_SERVER_BASE_URL` (default: `http://127.0.0.1:3131`)
- `AGENT_AUTH_HEADER` (optional, full `Bearer ...` value for `X-Agent-Auth`)

## Python API

```python
from api_client import AgentAPIClient

client = AgentAPIClient.from_env()
session = client.create_session("0123456789abcdef0123456789abcdef", harness="codex")
run = client.send_message(session["id"], [client.text_input("hey, who are you")])
print(run)
```

## CLI

From `agent/`:

```bash
python3 ./tools/agent-tools/session.py create 0123456789abcdef0123456789abcdef --harness codex
python3 ./tools/agent-tools/session.py message 0123456789abcdef0123456789abcdef "hey, who are you"
python3 ./tools/agent-tools/session.py get 0123456789abcdef0123456789abcdef
python3 ./tools/agent-tools/session.py list
python3 ./tools/agent-tools/session.py stop 0123456789abcdef0123456789abcdef
python3 ./tools/agent-tools/session.py delete 0123456789abcdef0123456789abcdef
```

These tools do not read or write SQLite directly; they only call `agent-go` APIs.
