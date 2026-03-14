---
name: analyze-session-or-agent
description: Use this skill when the user wants to understand better what's going on with a session or an agent.
---

### Agent Runtime Inspection (Status + Data)

Trigger conditions:

- User asks if runtime is healthy, stuck, failing, or currently doing work.
- User asks for process/filesystem/log/DB inspection inside sandbox.
- User asks to verify session/runtime state with direct SQLite queries.
- Query the sqlite database for how the agent is doing.

Core runtime facts inside the sandbox:

- Agent API usually runs on \`127.0.0.1:\${PORT:-8080}\` (health endpoint: \`/health\`).
- Agent runtime root is typically \`/home/agent/runtime\` (or \`$ROOT_DIR\` when overridden).
- Agent SQLite DB defaults to \`/home/agent/runtime/agent.db\` (unless \`DATABASE_PATH\` is overridden).
- Agent server stdout/stderr is typically captured to \`$AGENT_SERVER_LOG_FILE\` (default: \`$ROOT_DIR/logs/agent-server.log\`).
- Agent image repo checkout is typically \`/opt/agentsandbox/agent-go\`; the runtime bootstrap scripts are \`/opt/agentsandbox/agent-go/docker/setup.sh\` and \`/opt/agentsandbox/agent-go/docker/start.sh\`.
- Repo-provided agent-go tools live in \`$AGENT_TOOLS_DIR\` (default: \`/opt/agentsandbox/agent-go/tools\`) and are usually exposed in the workspace under \`/home/agent/workspaces/tools/default/\*\`.
- Image-provided tools live in \`$IMAGE_TOOLS_DIR\` (default: \`/shared/image/tools\`) and are usually exposed in the workspace under \`/home/agent/workspaces/tools/image/\*\`.
- Browser automation capabilities from agent-go therefore typically appear at \`/home/agent/workspaces/tools/default/browser-tools\`.

When investigating:

- Prefer read-only inspection first (\`pwd\`, \`env\`, \`ls\`, \`find\`, \`cat\`, \`head\`, \`tail\`, \`grep\`).
- Verify health before deeper inspection (\`curl -fsS http://127.0.0.1:\${PORT:-8080}/health\`).
- If checking DB-backed state, inspect SQLite path/size before querying, then query directly with \`sqlite3\` when available.
- Typical direct SQLite checks in sandbox:
  \`sqlite3 /home/agent/runtime/agent.db ".tables"\`
  \`sqlite3 /home/agent/runtime/agent.db "SELECT id, status, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 20;"\`
- Only mutate files/state when the user explicitly asks for it.

Always provide concise summaries of actions and outcomes.
Act as autonomously as possible: proactively choose and execute the best available actions and tool calls end-to-end without waiting for extra confirmation unless disambiguation, missing required inputs, or safety/policy constraints make a question necessary.
Be comprehensive as possible in your tool calls and actions proactively.
