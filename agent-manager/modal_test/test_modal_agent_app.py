"""
Integration tests for Modal-deployed agent-go server.

This test suite validates the full flow:
  sandbox.py (volume setup) -> server.py (Modal web server) -> agent-go API

Run with:
  cd agent-manager/modal_test
  python test_modal_agent_app.py

Prerequisites:
  - Modal CLI authenticated (`modal token new`)
  - Environment variables set (SECRET_SEED, AGENT_BASE_IMAGE_REF, etc.)
  - Volume already initialized via sandbox.py
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import jwt
import requests
from dotenv import load_dotenv

DOTENV_PATH = (Path(__file__).resolve().parent.parent.parent / "agent-go" / ".env")
load_dotenv(dotenv_path=str(DOTENV_PATH))

APP_NAME = os.environ.get("MODAL_AGENT_ROOTFS_APP", "agent-rootfs-test-server-2")
VOLUME_NAME = os.environ.get("MODAL_AGENT_ROOTFS_VOLUME", "agent-rootfs-test-volume-2")
SECRET_SEED = os.environ.get("SECRET_SEED", "")
AGENT_ID = os.environ.get("AGENT_ID", "default")
AGENT_SESSION_ID = os.environ.get("AGENT_SESSION_ID")


@dataclass
class TestResult:
    name: str
    passed: bool
    message: str
    duration_ms: float


def derive_sandbox_secret(secret_seed: str, agent_session_id: str) -> str:
    """Derive the HMAC secret for sandbox-agent auth (matches agent-go)."""
    key = secret_seed.encode("utf-8")
    msg = f"sandbox-agent:{agent_session_id}".encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def create_auth_token(
    agent_session_id: str, user_id: str, secret_seed: str, agent_id: str
) -> str:
    """Create a JWT token for X-Agent-Auth header."""
    secret = derive_sandbox_secret(secret_seed, agent_session_id)
    now = int(time.time())
    claims = {
        "sid": agent_session_id,
        "sub": user_id,
        "typ": "sandbox-agent",
        "agentId": agent_id,
        "iat": now - 5,
        "exp": now + 300,
    }
    return jwt.encode(claims, secret, algorithm="HS256")


def new_session_id() -> str:
    """Generate a random 32-char hex session ID."""
    return secrets.token_hex(16)

def agent_id_to_agent_session_id(agent_id: str) -> str | None:
    """
    Match agent-manager semantics: agentSessionId is agentId with hyphens removed.
    In production, agentId is typically a UUID, so this yields a 32-hex string.
    """
    trimmed = agent_id.strip()
    if not trimmed:
        return None
    candidate = trimmed.replace("-", "")
    if re.fullmatch(r"[0-9a-fA-F]{32}", candidate):
        return candidate.lower()
    return None

def get_agent_session_id() -> str:
    """
    X-Agent-Auth `sid` is the sandbox "agent session id", not necessarily the
    /session/{id} you're operating on.
    """
    if isinstance(AGENT_SESSION_ID, str) and AGENT_SESSION_ID.strip():
        return AGENT_SESSION_ID.strip()
    derived = agent_id_to_agent_session_id(AGENT_ID)
    if derived:
        return derived
    # Fallback: tests don't require sid to match session IDs, but it must be stable
    # within a run so multiple requests share the same auth secret.
    return "default-agent-session"


def get_modal_app_url() -> str | None:
    """Best-effort: Modal CLI currently doesn't expose web URLs via `app list`."""
    return None


def deploy_modal_app() -> str:
    """Deploy the Modal app and return its URL."""
    print(f"Deploying Modal app '{APP_NAME}'...")
    result = subprocess.run(
        ["modal", "deploy", "server.py"],
        check=True,
        cwd=os.path.dirname(os.path.abspath(__file__)),
        capture_output=True,
        text=True,
    )
    # Typical output contains:
    #   Created web function fastapi_app => https://<...>.modal.run
    m = re.search(r"(https://[a-zA-Z0-9-]+\.modal\.run)", result.stdout)
    if not m:
        m = re.search(r"(https://[a-zA-Z0-9-]+\.modal\.run)", result.stderr)
    if not m:
        raise RuntimeError(
            "Deployed app, but couldn't parse web URL from `modal deploy` output.\n"
            f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
        )
    url = m.group(1)
    print(f"App deployed at: {url}")
    return url


def wait_for_health(base_url: str, timeout: float = 60.0) -> bool:
    """Wait for the server health endpoint to respond."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            resp = requests.get(f"{base_url}/health", timeout=5)
            if resp.status_code == 200:
                return True
        except requests.RequestException:
            pass
        time.sleep(2)
    return False


class ModalAgentIntegrationTests:
    """Integration tests for Modal-deployed agent-go server."""

    def __init__(self, base_url: str, secret_seed: str, agent_id: str):
        self.base_url = base_url.rstrip("/")
        self.secret_seed = secret_seed
        self.agent_id = agent_id
        self.results: list[TestResult] = []

    def _auth_headers(self, session_id: str, user_id: str = "integration-user") -> dict:
        token = create_auth_token(get_agent_session_id(), user_id, self.secret_seed, self.agent_id)
        return {"X-Agent-Auth": f"Bearer {token}", "Content-Type": "application/json"}

    def _run_test(self, name: str, test_fn):
        """Run a test and record the result."""
        start = time.time()
        try:
            test_fn()
            duration_ms = (time.time() - start) * 1000
            self.results.append(TestResult(name, True, "PASSED", duration_ms))
            print(f"  ✓ {name} ({duration_ms:.0f}ms)")
        except AssertionError as e:
            duration_ms = (time.time() - start) * 1000
            self.results.append(TestResult(name, False, str(e), duration_ms))
            print(f"  ✗ {name}: {e}")
        except Exception as e:
            duration_ms = (time.time() - start) * 1000
            self.results.append(TestResult(name, False, f"ERROR: {e}", duration_ms))
            print(f"  ✗ {name}: ERROR - {e}")

    def test_health_endpoint(self):
        """Test /health endpoint returns 200."""
        resp = requests.get(f"{self.base_url}/health", timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_create_session_persists(self):
        """Test POST /session creates a session (matches Go TestSessionAPIBlackbox_CreateSessionPersists)."""
        session_id = new_session_id()
        headers = self._auth_headers(session_id)

        resp = requests.post(
            f"{self.base_url}/session",
            headers=headers,
            json={
                "id": session_id,
                "harness": "codex",
                "model": "gpt-5.2",
                "modelReasoningEffort": "medium",
            },
            timeout=30,
        )

        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("id") == session_id, f"Unexpected id: {data}"
        assert data.get("harness") == "codex", f"Unexpected harness: {data}"
        assert data.get("createdBy") == "integration-user", f"Unexpected createdBy: {data}"

    def test_reject_harness_change(self):
        """Test that changing harness on existing session returns 409 (matches Go TestSessionAPIBlackbox_RejectHarnessChange)."""
        session_id = new_session_id()
        headers = self._auth_headers(session_id)

        create_resp = requests.post(
            f"{self.base_url}/session",
            headers=headers,
            json={"id": session_id, "harness": "codex"},
            timeout=30,
        )
        assert create_resp.status_code == 201, f"Create failed: {create_resp.status_code}"

        conflict_resp = requests.post(
            f"{self.base_url}/session",
            headers=headers,
            json={"id": session_id, "harness": "pi"},
            timeout=30,
        )
        assert conflict_resp.status_code == 409, f"Expected 409, got {conflict_resp.status_code}"
        data = conflict_resp.json()
        assert "harness cannot be modified" in data.get("error", ""), f"Unexpected error: {data}"

    def test_session_message_run(self):
        """Test POST /session/{id}/message runs and returns success (matches Go TestSessionAPIBlackbox_MessageRunPersistsFields)."""
        session_id = new_session_id()
        headers = self._auth_headers(session_id)

        create_resp = requests.post(
            f"{self.base_url}/session",
            headers=headers,
            json={"id": session_id, "harness": "codex"},
            timeout=30,
        )
        assert create_resp.status_code == 201, f"Create failed: {create_resp.status_code}"

        run_resp = requests.post(
            f"{self.base_url}/session/{session_id}/message",
            headers=headers,
            json={
                "input": [{"type": "text", "text": "Reply with exactly: ok"}],
                "model": "gpt-5.2",
                "modelReasoningEffort": "high",
            },
            timeout=60,
        )
        assert run_resp.status_code == 200, f"Expected 200, got {run_resp.status_code}: {run_resp.text}"
        data = run_resp.json()
        assert data.get("success") is True, f"Expected success=true: {data}"
        run_id = data.get("runId")
        assert run_id and len(run_id) == 32, f"Expected 32-char runId: {run_id}"

    def test_session_message_stream(self):
        """Test GET /session/{id}/message/{runId}/stream returns SSE."""
        session_id = new_session_id()
        headers = self._auth_headers(session_id)

        create_resp = requests.post(
            f"{self.base_url}/session",
            headers=headers,
            json={"id": session_id, "harness": "codex"},
            timeout=30,
        )
        assert create_resp.status_code == 201

        run_resp = requests.post(
            f"{self.base_url}/session/{session_id}/message",
            headers=headers,
            json={"input": [{"type": "text", "text": "Hello"}]},
            timeout=60,
        )
        assert run_resp.status_code == 200
        run_id = run_resp.json().get("runId")
        assert run_id

        stream_resp = requests.get(
            f"{self.base_url}/session/{session_id}/message/{run_id}/stream",
            headers=headers,
            timeout=30,
            stream=True,
        )
        assert stream_resp.status_code == 200, f"Expected 200, got {stream_resp.status_code}"
        content_type = stream_resp.headers.get("Content-Type", "")
        assert "text/event-stream" in content_type, f"Expected SSE content-type, got {content_type}"

        print("\n    [SSE Stream Events]")
        events_received = 0
        for line in stream_resp.iter_lines(decode_unicode=True):
            if line:
                print(f"      {line}")
                events_received += 1
                if events_received > 20:
                    print("      ... (truncated)")
                    break
        print(f"    [Received {events_received} SSE lines]")
        stream_resp.close()

    def test_pi_harness_session(self):
        """Test PI harness session creation and message (matches Go TestSessionAPIBlackbox_PIProviderEventsPersisted)."""
        session_id = new_session_id()
        headers = self._auth_headers(session_id)

        create_resp = requests.post(
            f"{self.base_url}/session",
            headers=headers,
            json={"id": session_id, "harness": "pi"},
            timeout=30,
        )
        assert create_resp.status_code == 201, f"Create failed: {create_resp.status_code}"

        run_resp = requests.post(
            f"{self.base_url}/session/{session_id}/message",
            headers=headers,
            json={"input": [{"type": "text", "text": "Reply with exactly: ok"}]},
            timeout=60,
        )
        assert run_resp.status_code == 200, f"Expected 200, got {run_resp.status_code}: {run_resp.text}"

    def test_get_session(self):
        """Test GET /session/{id} returns session details."""
        session_id = new_session_id()
        headers = self._auth_headers(session_id)

        create_resp = requests.post(
            f"{self.base_url}/session",
            headers=headers,
            json={"id": session_id, "harness": "codex", "model": "gpt-4"},
            timeout=30,
        )
        assert create_resp.status_code == 201

        get_resp = requests.get(
            f"{self.base_url}/session/{session_id}",
            headers=headers,
            timeout=30,
        )
        assert get_resp.status_code == 200, f"Expected 200, got {get_resp.status_code}"
        data = get_resp.json()
        assert data.get("id") == session_id
        assert data.get("harness") == "codex"

    def test_list_sessions(self):
        """Test GET /session returns session list."""
        session_id = new_session_id()
        headers = self._auth_headers(session_id)

        create_resp = requests.post(
            f"{self.base_url}/session",
            headers=headers,
            json={"id": session_id, "harness": "codex"},
            timeout=30,
        )
        assert create_resp.status_code == 201

        list_resp = requests.get(
            f"{self.base_url}/session",
            headers=headers,
            timeout=30,
        )
        assert list_resp.status_code == 200, f"Expected 200, got {list_resp.status_code}"
        data = list_resp.json()
        assert "sessions" in data, f"Expected 'sessions' key in response: {data}"
        assert isinstance(data["sessions"], list), f"Expected sessions to be list: {data}"

    def test_unauthorized_without_auth(self):
        """Test requests without auth header are rejected."""
        session_id = new_session_id()

        resp = requests.post(
            f"{self.base_url}/session",
            headers={"Content-Type": "application/json"},
            json={"id": session_id, "harness": "codex"},
            timeout=30,
        )
        assert resp.status_code in (401, 403), f"Expected 401/403, got {resp.status_code}"

    def test_invalid_auth_token(self):
        """Test requests with invalid auth token are rejected."""
        session_id = new_session_id()

        resp = requests.post(
            f"{self.base_url}/session",
            headers={
                "X-Agent-Auth": "Bearer invalid-token",
                "Content-Type": "application/json",
            },
            json={"id": session_id, "harness": "codex"},
            timeout=30,
        )
        assert resp.status_code in (401, 403), f"Expected 401/403, got {resp.status_code}"

    def run_all(self) -> bool:
        """Run all tests and return True if all passed."""
        print(f"\nRunning Modal Agent Integration Tests against {self.base_url}\n")

        tests = [
            ("Health Endpoint", self.test_health_endpoint),
            ("Create Session Persists", self.test_create_session_persists),
            ("Reject Harness Change", self.test_reject_harness_change),
            ("Session Message Run", self.test_session_message_run),
            ("Session Message Stream", self.test_session_message_stream),
            ("PI Harness Session", self.test_pi_harness_session),
            ("Get Session", self.test_get_session),
            ("List Sessions", self.test_list_sessions),
            ("Unauthorized Without Auth", self.test_unauthorized_without_auth),
            ("Invalid Auth Token", self.test_invalid_auth_token),
        ]

        for name, test_fn in tests:
            self._run_test(name, test_fn)

        passed = sum(1 for r in self.results if r.passed)
        failed = sum(1 for r in self.results if not r.passed)
        total_time = sum(r.duration_ms for r in self.results)

        print(f"\n{'='*60}")
        print(f"Results: {passed} passed, {failed} failed ({total_time:.0f}ms total)")
        print(f"{'='*60}\n")

        if failed > 0:
            print("Failed tests:")
            for r in self.results:
                if not r.passed:
                    print(f"  - {r.name}: {r.message}")
            print()

        return failed == 0


def main():
    if len(SECRET_SEED) < 32:
        print("ERROR: SECRET_SEED must be set and at least 32 characters")
        print("Set it in .env or export SECRET_SEED=...")
        sys.exit(1)

    base_url = os.environ.get("MODAL_AGENT_BASE_URL")

    if not base_url:
        print("MODAL_AGENT_BASE_URL not set; deploying Modal app to discover URL...")
        # Modal CLI doesn't provide web URLs via `modal app list --json`, so we deploy and parse output.
        base_url = deploy_modal_app()

    print(f"Using Modal app URL: {base_url}")
    print(f"Agent ID: {AGENT_ID}")

    print("\nWaiting for server health...")
    if not wait_for_health(base_url, timeout=120):
        print("ERROR: Server health check failed after 120s")
        sys.exit(1)
    print("Server is healthy!\n")

    tests = ModalAgentIntegrationTests(base_url, SECRET_SEED, AGENT_ID)
    success = tests.run_all()

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
