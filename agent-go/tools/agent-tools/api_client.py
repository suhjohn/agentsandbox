#!/usr/bin/env python3
"""Client-side wrappers for agent-go session APIs."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional


SESSION_ID_HEX_LEN = 32


def _clean_base_url(raw: str) -> str:
    value = raw.strip()
    if not value:
        raise ValueError("base URL cannot be empty")
    return value.rstrip("/")


def _json_body(payload: Optional[Dict[str, Any]]) -> Optional[bytes]:
    if payload is None:
        return None
    return json.dumps(payload).encode("utf-8")


@dataclass
class AgentAPIClient:
    base_url: str
    auth_header: Optional[str] = None
    timeout_seconds: int = 60

    @classmethod
    def from_env(cls) -> "AgentAPIClient":
        base_url = (
            os.environ.get("AGENT_SERVER_BASE_URL")
            or os.environ.get("AGENT_BASE_URL")
            or "http://127.0.0.1:3131"
        )
        auth_header = os.environ.get("AGENT_AUTH_HEADER")
        return cls(base_url=_clean_base_url(base_url), auth_header=auth_header)

    def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.auth_header:
            headers["X-Agent-Auth"] = self.auth_header
        if extra:
            headers.update(extra)
        return headers

    def request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        data = _json_body(payload)
        request_headers = self._headers(headers)
        if data is not None:
            request_headers["Content-Type"] = "application/json"

        req = urllib.request.Request(
            url=f"{self.base_url}{path}",
            method=method.upper(),
            data=data,
            headers=request_headers,
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8")
                if not raw.strip():
                    return None
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"HTTP {exc.code} {method.upper()} {path}: {body or exc.reason}"
            ) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(
                f"Failed to reach agent-go at {self.base_url}: {exc.reason}"
            ) from exc

    def create_session(
        self,
        session_id: str,
        harness: str = "codex",
        agent_id: str = "default",
        model: Optional[str] = None,
        model_reasoning_effort: Optional[str] = None,
    ) -> Dict[str, Any]:
        self._validate_session_id(session_id)
        payload: Dict[str, Any] = {
            "id": session_id,
            "harness": harness,
            "agentId": agent_id,
        }
        if model:
            payload["model"] = model
        if model_reasoning_effort:
            payload["modelReasoningEffort"] = model_reasoning_effort
        return self.request("POST", "/session", payload)

    def list_sessions(self) -> Iterable[Dict[str, Any]]:
        response = self.request("GET", "/session")
        if isinstance(response, list):
            return response
        return []

    def get_session(self, session_id: str) -> Dict[str, Any]:
        self._validate_session_id(session_id)
        return self.request("GET", f"/session/{session_id}")

    def send_message(
        self,
        session_id: str,
        input_items: Iterable[Dict[str, Any]],
        model: Optional[str] = None,
        model_reasoning_effort: Optional[str] = None,
    ) -> Dict[str, Any]:
        self._validate_session_id(session_id)
        payload: Dict[str, Any] = {"input": list(input_items)}
        if model:
            payload["model"] = model
        if model_reasoning_effort:
            payload["modelReasoningEffort"] = model_reasoning_effort
        return self.request("POST", f"/session/{session_id}/message", payload)

    def stop_run(self, session_id: str) -> Dict[str, Any]:
        self._validate_session_id(session_id)
        return self.request("POST", f"/session/{session_id}/stop", payload={})

    def delete_session(self, session_id: str) -> Dict[str, Any]:
        self._validate_session_id(session_id)
        return self.request("DELETE", f"/session/{session_id}")

    @staticmethod
    def text_input(text: str) -> Dict[str, str]:
        return {"type": "text", "text": text}

    @staticmethod
    def _validate_session_id(session_id: str) -> None:
        value = (session_id or "").strip()
        if len(value) != SESSION_ID_HEX_LEN:
            raise ValueError("session_id must be a 32-character hex string")
        if any(ch not in "0123456789abcdefABCDEF" for ch in value):
            raise ValueError("session_id must be a 32-character hex string")
