# agent-manager (local dev + Modal sandboxes)

## Expose agent-manager to Modal sandboxes (local dev)

Modal sandboxes can’t reach `localhost` on your machine. For local development, expose `agent-manager` to the public internet and pass that URL into sandboxes.

1. Start `agent-manager`:
   - `cd agent-manager && bun dev`
   - This will try to auto-start **Tailscale Funnel** (if `tailscale` is on your PATH and you’re logged in / Funnel-enabled).
   - If it succeeds, it sets `SERVER_PUBLIC_URL` automatically.

2. If you prefer starting Funnel manually (for a stable `https://<device>.<tailnet>.ts.net` URL), start it manually:
   - `tailscale funnel --bg 3132`

3. Export the public base URL (if you didn’t auto-start Funnel):
   - `export SERVER_PUBLIC_URL="https://YOUR-DEVICE.YOUR-TAILNET.ts.net"`

4. (Recommended) Set an API key that sandboxes must present when calling `agent-manager`:
   - `export AGENT_MANAGER_API_KEY="$(openssl rand -hex 32)"`

### What gets injected into sandboxes

When an agent sandbox is created, `agent-manager` injects:
- `AGENT_MANAGER_BASE_URL` from `SERVER_PUBLIC_URL`
- `AGENT_MANAGER_API_KEY` (if configured) via Modal secret injection
- `AGENT_MANAGER_AGENT_ID` (UUID, matches `agent-manager`’s `/agents/:agentId`)
- `AGENT_MANAGER_AGENT_SESSION_ID` (32-hex, matches the sandbox agent’s `/session` id)

### Calling agent-manager from inside a sandbox

For agent-scoped endpoints, `agent-manager` accepts an API key header on `/agents/:agentId/*`:
- `X-Agent-Manager-Api-Key: ...`

Example:
- `curl -sS -H "X-Agent-Manager-Api-Key: $AGENT_MANAGER_API_KEY" "$AGENT_MANAGER_BASE_URL/agents/$AGENT_MANAGER_AGENT_ID/access"`
