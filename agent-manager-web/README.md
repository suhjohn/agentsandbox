# agent-manager-web

Minimal TanStack Router + React Query web UI for `agent-manager` auth + agent chat APIs.

## Run

1) Start the backend:
- `cd agent-manager && bun run dev`

2) Start the web app:
- `cd agent-manager-web && bun install`
- `BACKEND_URL=http://localhost:3132 bun run dev`

## Supported user stories

### Authentication
- As a user, I can register with name/email/password (`POST /auth/register`).
- As a user, I can log in with email/password (`POST /auth/login`).
- As a user, I can log in with GitHub OAuth (popup via `GET /auth/github/start` → `GET /auth/github/callback`).
- As a user, I stay signed in across reloads via local storage (access + refresh tokens).
- As a user, my access token is refreshed on `401` using my refresh token (`POST /auth/refresh`).
- As a user, I can log out (`POST /auth/logout`).

### Chat (agent)
- As a user, I can list my conversations (`GET /agent/conversations`).
- As a user, I can start a new conversation by sending a message (no `conversationId`) (`POST /agent/chat`, SSE).
- As a user, I can open a conversation and see message history (`GET /agent/conversations/:id/messages`).
- As a user, I can send a message in an existing conversation and see the assistant stream back (`POST /agent/chat`, SSE).
- As a user, I can rename a conversation (`PATCH /agent/conversations/:id`).
- As a user, I can delete a conversation (`DELETE /agent/conversations/:id`).
