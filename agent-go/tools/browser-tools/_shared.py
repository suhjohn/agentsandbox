#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import os
import secrets
import socket
import ssl
import struct
import subprocess
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional


INTERNAL_URL_PREFIXES = (
    "about:",
    "chrome:",
    "chrome-extension:",
    "chrome-search:",
    "chrome-untrusted:",
    "devtools:",
    "edge:",
    "brave:",
)


class BrowserToolsError(RuntimeError):
    pass


def get_flag_value(argv: List[str], name: str) -> Optional[str]:
    if name not in argv:
        return None
    idx = argv.index(name)
    if idx + 1 >= len(argv):
        return None
    value = argv[idx + 1]
    if value.startswith("-"):
        return None
    return value


def has_flag(argv: List[str], name: str) -> bool:
    return name in argv


def positional_args(argv: List[str], flags_with_value: Iterable[str] = ("--port", "--browser-url")) -> List[str]:
    flags = set(flags_with_value)
    out: List[str] = []
    skip_next = False
    for i, arg in enumerate(argv):
        if skip_next:
            skip_next = False
            continue
        if arg in flags:
            skip_next = True
            continue
        if any(arg.startswith(f"{flag}=") for flag in flags):
            continue
        if arg.startswith("-"):
            continue
        out.append(arg)
    return out


def get_browser_url(argv: List[str]) -> str:
    explicit = get_flag_value(argv, "--browser-url")
    if explicit:
        return explicit
    port_raw = get_flag_value(argv, "--port") or os.environ.get("BROWSER_TOOLS_PORT") or "9222"
    try:
        port = int(port_raw)
    except ValueError as exc:
        raise BrowserToolsError(f"Invalid --port value: {port_raw}") from exc
    if port <= 0:
        raise BrowserToolsError(f"Invalid --port value: {port_raw}")
    return f"http://localhost:{port}"


def is_internal_chrome_url(url: str) -> bool:
    if not url or url == "about:blank":
        return True
    return url.startswith(INTERNAL_URL_PREFIXES)


def print_result(result: Any) -> None:
    if isinstance(result, list):
        for i, row in enumerate(result):
            if i > 0:
                print("")
            if isinstance(row, dict):
                for key, value in row.items():
                    print(f"{key}: {value}")
            else:
                print(row)
        return

    if isinstance(result, dict):
        for key, value in result.items():
            print(f"{key}: {value}")
        return

    print(result)


def preview_text(value: str, max_len: int = 60) -> str:
    if len(value) <= max_len:
        return value
    return f"{value[: max_len - 3]}..."


def is_mac_platform() -> bool:
    return os.uname().sysname.lower() == "darwin"


def run_cli(main: Callable[[], int]) -> None:
    try:
        raise SystemExit(main())
    except BrowserToolsError as exc:
        print(f"✗ {exc}", file=os.sys.stderr)
        raise SystemExit(1)
    except KeyboardInterrupt:
        print("✗ Interrupted", file=os.sys.stderr)
        raise SystemExit(1)


def wait_for_cdp(browser_url: str, retries: int = 60, sleep_seconds: float = 0.5) -> bool:
    for _ in range(retries):
        try:
            _ = browser_json(browser_url, "/json/version")
            return True
        except Exception:  # noqa: BLE001
            time.sleep(sleep_seconds)
    return False


def find_chrome_executable(chrome_path: Optional[str]) -> Optional[str]:
    if chrome_path and Path(chrome_path).exists():
        return chrome_path

    candidates = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    for candidate in candidates:
        try:
            found = subprocess.check_output(["bash", "-lc", f"command -v {candidate}"], text=True).strip()
            if found:
                return found
        except Exception:  # noqa: BLE001
            pass
    return None


def browser_json(browser_url: str, path: str, method: str = "GET") -> Any:
    url = f"{browser_url.rstrip('/')}{path}"
    req = urllib.request.Request(url=url, method=method)
    with urllib.request.urlopen(req, timeout=10) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw)


@dataclass
class BrowserTarget:
    id: str
    type: str
    url: str
    title: str
    websocket_url: str


class BrowserHTTP:
    def __init__(self, browser_url: str):
        self.browser_url = browser_url.rstrip("/")

    def list_targets(self) -> List[BrowserTarget]:
        entries = browser_json(self.browser_url, "/json/list")
        out: List[BrowserTarget] = []
        for row in entries:
            if not isinstance(row, dict):
                continue
            ws_url = row.get("webSocketDebuggerUrl")
            target_id = row.get("id")
            if not isinstance(ws_url, str) or not isinstance(target_id, str):
                continue
            out.append(
                BrowserTarget(
                    id=target_id,
                    type=str(row.get("type") or ""),
                    url=str(row.get("url") or ""),
                    title=str(row.get("title") or ""),
                    websocket_url=ws_url,
                )
            )
        return out

    def get_active_page_target(self) -> Optional[BrowserTarget]:
        pages = [t for t in self.list_targets() if t.type == "page"]
        if not pages:
            return None

        non_internal = [p for p in pages if not is_internal_chrome_url(p.url)]
        if non_internal:
            web_like = [p for p in non_internal if p.url.startswith(("http:", "https:", "file:"))]
            if web_like:
                return web_like[-1]
            return non_internal[-1]

        return pages[-1]

    def new_target(self, url: str = "about:blank") -> BrowserTarget:
        encoded = urllib.parse.quote(url, safe="")
        try:
            created = browser_json(self.browser_url, f"/json/new?{encoded}", method="PUT")
        except Exception:  # noqa: BLE001
            created = browser_json(self.browser_url, f"/json/new?{encoded}", method="GET")
        target_id = str(created["id"])
        target = self.get_target_by_id(target_id)
        if target is None:
            raise BrowserToolsError("Failed to open new tab")
        return target

    def activate_target(self, target_id: str) -> None:
        _ = browser_json(self.browser_url, f"/json/activate/{target_id}")

    def get_target_by_id(self, target_id: str) -> Optional[BrowserTarget]:
        for target in self.list_targets():
            if target.id == target_id:
                return target
        return None


class WebSocketLike:
    def send_text(self, message: str) -> None:  # pragma: no cover - interface only
        raise NotImplementedError

    def recv_text(self, timeout: Optional[float]) -> Optional[str]:  # pragma: no cover - interface only
        raise NotImplementedError

    def close(self) -> None:  # pragma: no cover - interface only
        raise NotImplementedError


class StdlibWebSocket(WebSocketLike):
    def __init__(self, ws_url: str):
        parsed = urllib.parse.urlparse(ws_url)
        if parsed.scheme not in ("ws", "wss"):
            raise BrowserToolsError(f"Unsupported websocket URL: {ws_url}")
        host = parsed.hostname or ""
        if not host:
            raise BrowserToolsError("Missing websocket hostname")
        port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"

        sock = socket.create_connection((host, port), timeout=10)
        if parsed.scheme == "wss":
            ctx = ssl.create_default_context()
            sock = ctx.wrap_socket(sock, server_hostname=host)

        key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
        host_header = host if parsed.port is None else f"{host}:{port}"
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host_header}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        sock.sendall(request.encode("utf-8"))

        response = self._read_http_headers(sock)
        if " 101 " not in response.splitlines()[0]:
            raise BrowserToolsError(f"WebSocket handshake failed: {response.splitlines()[0]}")

        self.sock = sock

    @staticmethod
    def _read_http_headers(sock: socket.socket) -> str:
        buf = bytearray()
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf.extend(chunk)
        return buf.decode("utf-8", errors="replace")

    @staticmethod
    def _read_exact(sock: socket.socket, size: int) -> bytes:
        out = bytearray()
        while len(out) < size:
            chunk = sock.recv(size - len(out))
            if not chunk:
                raise BrowserToolsError("WebSocket connection closed")
            out.extend(chunk)
        return bytes(out)

    def send_text(self, message: str) -> None:
        payload = message.encode("utf-8")
        self._send_frame(opcode=0x1, payload=payload)

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        fin_opcode = 0x80 | (opcode & 0x0F)
        length = len(payload)
        mask_key = secrets.token_bytes(4)

        header = bytearray([fin_opcode])
        if length < 126:
            header.append(0x80 | length)
        elif length <= 0xFFFF:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))

        masked = bytes(payload[i] ^ mask_key[i % 4] for i in range(length))
        self.sock.sendall(bytes(header) + mask_key + masked)

    def recv_text(self, timeout: Optional[float]) -> Optional[str]:
        self.sock.settimeout(timeout)
        payload = bytearray()
        opcode = None

        while True:
            try:
                first_two = self._read_exact(self.sock, 2)
            except socket.timeout:
                return None
            fin = (first_two[0] & 0x80) != 0
            frame_opcode = first_two[0] & 0x0F
            masked = (first_two[1] & 0x80) != 0
            length = first_two[1] & 0x7F

            if length == 126:
                length = struct.unpack("!H", self._read_exact(self.sock, 2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._read_exact(self.sock, 8))[0]

            mask = self._read_exact(self.sock, 4) if masked else None
            chunk = self._read_exact(self.sock, length) if length > 0 else b""
            if masked and mask:
                chunk = bytes(chunk[i] ^ mask[i % 4] for i in range(len(chunk)))

            if frame_opcode == 0x8:
                return None
            if frame_opcode == 0x9:
                self._send_frame(opcode=0xA, payload=chunk)
                continue
            if frame_opcode == 0xA:
                continue

            if opcode is None and frame_opcode != 0x0:
                opcode = frame_opcode
            payload.extend(chunk)
            if not fin:
                continue

            if opcode == 0x1:
                return payload.decode("utf-8", errors="replace")
            return None

    def close(self) -> None:
        try:
            self._send_frame(opcode=0x8, payload=b"")
        except Exception:  # noqa: BLE001
            pass
        try:
            self.sock.close()
        except Exception:  # noqa: BLE001
            pass


class WebsocketClientAdapter(WebSocketLike):
    def __init__(self, ws_url: str):
        import websocket  # type: ignore

        self.websocket = websocket.create_connection(ws_url, timeout=10)

    def send_text(self, message: str) -> None:
        self.websocket.send(message)

    def recv_text(self, timeout: Optional[float]) -> Optional[str]:
        self.websocket.settimeout(timeout)
        try:
            value = self.websocket.recv()
        except TimeoutError:
            return None
        except Exception as exc:  # noqa: BLE001
            if "timed out" in str(exc).lower():
                return None
            raise
        if value is None:
            return None
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return str(value)

    def close(self) -> None:
        self.websocket.close()


def connect_websocket(ws_url: str) -> WebSocketLike:
    try:
        return WebsocketClientAdapter(ws_url)
    except Exception:  # noqa: BLE001
        return StdlibWebSocket(ws_url)


class CDPSession:
    def __init__(self, websocket_url: str):
        self.ws = connect_websocket(websocket_url)
        self._next_id = 1
        self._queue: List[Dict[str, Any]] = []

    def close(self) -> None:
        self.ws.close()

    def _recv_json(self, timeout: Optional[float]) -> Optional[Dict[str, Any]]:
        raw = self.ws.recv_text(timeout)
        if raw is None:
            return None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if isinstance(data, dict):
            return data
        return None

    def poll(self, timeout: float = 0.0) -> Optional[Dict[str, Any]]:
        # Prefer reading from the socket first. Some CDP commands can trigger
        # events (no "id") before the command response arrives; if we always
        # drain the in-memory queue first, those events can starve the socket
        # and prevent ever receiving the awaited response.
        item = self._recv_json(timeout)
        if item is not None:
            return item
        if self._queue:
            return self._queue.pop(0)
        return None

    def call(self, method: str, params: Optional[Dict[str, Any]] = None, timeout: float = 30.0) -> Dict[str, Any]:
        request_id = self._next_id
        self._next_id += 1
        message = {"id": request_id, "method": method, "params": params or {}}
        self.ws.send_text(json.dumps(message))

        deadline = time.monotonic() + timeout
        while True:
            remaining = max(0.0, deadline - time.monotonic())
            if remaining <= 0.0:
                raise BrowserToolsError(f"CDP timeout waiting for response to {method}")
            item = self.poll(timeout=remaining)
            if item is None:
                continue
            if item.get("id") != request_id:
                self._queue.append(item)
                continue
            if "error" in item:
                err = item["error"]
                if isinstance(err, dict):
                    msg = err.get("message") or str(err)
                else:
                    msg = str(err)
                raise BrowserToolsError(f"CDP {method} failed: {msg}")
            result = item.get("result")
            if isinstance(result, dict):
                return result
            return {}

    def evaluate(self, expression: str, await_promise: bool = True, return_by_value: bool = True) -> Any:
        result = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "awaitPromise": await_promise,
                "returnByValue": return_by_value,
                "replMode": True,
            },
        )
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            raise BrowserToolsError(f"Evaluation failed: {details}")
        remote = result.get("result")
        if isinstance(remote, dict):
            if "value" in remote:
                return remote["value"]
            return remote
        return remote


@dataclass
class PageConnection:
    browser_http: BrowserHTTP
    target: BrowserTarget
    session: CDPSession

    def close(self) -> None:
        self.session.close()


def connect_active_page(argv: List[str], new_tab: bool = False, new_tab_url: str = "about:blank") -> PageConnection:
    browser_http = BrowserHTTP(get_browser_url(argv))
    if new_tab:
        target = browser_http.new_target(new_tab_url)
    else:
        target = browser_http.get_active_page_target() or browser_http.new_target("about:blank")

    session = CDPSession(target.websocket_url)
    session.call("Page.enable")
    session.call("Runtime.enable")
    return PageConnection(browser_http=browser_http, target=target, session=session)


def wait_until(condition: Callable[[], bool], timeout_ms: int, interval_ms: int = 100) -> None:
    deadline = time.monotonic() + timeout_ms / 1000.0
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(interval_ms / 1000.0)
    raise BrowserToolsError("Timed out waiting for condition")


def wait_for_document_ready(session: CDPSession, timeout_ms: int = 30_000) -> None:
    deadline = time.monotonic() + timeout_ms / 1000.0
    while time.monotonic() < deadline:
        state = session.evaluate("document.readyState")
        if state in ("interactive", "complete"):
            return
        time.sleep(0.1)
    raise BrowserToolsError("Timed out waiting for document readiness")


def wait_for_network_idle(session: CDPSession, timeout_ms: int, idle_ms: int = 500) -> None:
    session.call("Network.enable")
    inflight: set[str] = set()
    last_change = time.monotonic()
    deadline = time.monotonic() + timeout_ms / 1000.0

    while time.monotonic() < deadline:
        msg = session.poll(timeout=0.2)
        now = time.monotonic()
        if isinstance(msg, dict) and "method" in msg:
            method = msg.get("method")
            params = msg.get("params") if isinstance(msg.get("params"), dict) else {}
            req_id = params.get("requestId")
            if method == "Network.requestWillBeSent" and isinstance(req_id, str):
                inflight.add(req_id)
                last_change = now
            if method in ("Network.loadingFinished", "Network.loadingFailed") and isinstance(req_id, str):
                inflight.discard(req_id)
                last_change = now

        if not inflight and (now - last_change) * 1000 >= idle_ms:
            return

    raise BrowserToolsError("Timed out waiting for network idle")
