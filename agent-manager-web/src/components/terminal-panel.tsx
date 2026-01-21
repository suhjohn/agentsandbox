import { useEffect, useEffectEvent, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import {
  buildTerminalConnectionKey,
  buildTerminalWebSocketAuthSubprotocol,
} from "@/lib/terminal-connect";
import "xterm/css/xterm.css";

const TERMINAL_BUFFER_LIMIT = 500_000;
const CONNECTION_IDLE_CLOSE_MS = 30 * 60_000;
const MIN_TERMINAL_DIMENSION_PX = 32;
const TERMINAL_DEBUG_PREFIX = "[terminal]";

type ConnectionListener = (chunk: string) => void;
type ConnectionLifecycleListener = (event: ConnectionLifecycleEvent) => void;

type ConnectionLifecycleEvent =
  | { readonly type: "open" }
  | {
      readonly type: "close";
      readonly code: number;
      readonly reason: string;
      readonly wasClean: boolean;
    }
  | {
      readonly type: "error";
      readonly readyState: number;
      readonly eventType: string;
    };

interface TerminalConnection {
  readonly key: string;
  readonly wsUrl: string;
  readonly wsProtocol: string;
  readonly ws: WebSocket;
  readonly decoder: TextDecoder;
  readonly listeners: Set<ConnectionListener>;
  readonly lifecycleListeners: Set<ConnectionLifecycleListener>;
  readonly handleOpen: () => void;
  readonly handleMessage: (ev: MessageEvent) => void;
  readonly handleClose: (ev: CloseEvent) => void;
  readonly handleError: (ev: Event) => void;
  refCount: number;
  closeTimer: number | null;
  outputBuffer: string;
}

const terminalConnections = new Map<string, TerminalConnection>();

function redactWsUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of ["access_token", "_modal_connect_token"] as const) {
      const value = url.searchParams.get(key);
      if (value == null) continue;
      url.searchParams.set(key, `${value.slice(0, 6)}...(${value.length})`);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function redactWsProtocol(rawProtocol: string): string {
  const protocol = rawProtocol.trim();
  if (protocol.length === 0) return protocol;
  const dotIndex = protocol.indexOf(".");
  if (dotIndex < 0) return `${protocol.slice(0, 6)}...(${protocol.length})`;
  const prefix = protocol.slice(0, dotIndex + 1);
  const token = protocol.slice(dotIndex + 1);
  return `${prefix}${token.slice(0, 6)}...(${token.length})`;
}

function appendToBuffer(connection: TerminalConnection, chunk: string): void {
  if (chunk.length === 0) return;
  const next = connection.outputBuffer + chunk;
  if (next.length <= TERMINAL_BUFFER_LIMIT) {
    connection.outputBuffer = next;
    return;
  }
  connection.outputBuffer = next.slice(-TERMINAL_BUFFER_LIMIT);
}

function emitChunk(connection: TerminalConnection, chunk: string): void {
  appendToBuffer(connection, chunk);
  for (const listener of connection.listeners) {
    listener(chunk);
  }
}

function emitLifecycleEvent(
  connection: TerminalConnection,
  event: ConnectionLifecycleEvent,
): void {
  for (const listener of connection.lifecycleListeners) {
    listener(event);
  }
}

function teardownConnection(connection: TerminalConnection): void {
  if (connection.closeTimer !== null) {
    window.clearTimeout(connection.closeTimer);
    connection.closeTimer = null;
  }
  if (terminalConnections.get(connection.key) === connection) {
    terminalConnections.delete(connection.key);
  }
  connection.listeners.clear();
  connection.lifecycleListeners.clear();
  connection.ws.removeEventListener("open", connection.handleOpen);
  connection.ws.removeEventListener("message", connection.handleMessage);
  connection.ws.removeEventListener("close", connection.handleClose);
  connection.ws.removeEventListener("error", connection.handleError);
  if (
    connection.ws.readyState === WebSocket.CONNECTING ||
    connection.ws.readyState === WebSocket.OPEN
  ) {
    try {
      connection.ws.close();
    } catch {
      // ignore
    }
  }
}

function createConnection(input: {
  readonly key: string;
  readonly wsUrl: string;
  readonly wsProtocol: string;
}): TerminalConnection {
  console.info(`${TERMINAL_DEBUG_PREFIX} ws.create`, {
    wsUrl: redactWsUrl(input.wsUrl),
    wsProtocol: redactWsProtocol(input.wsProtocol),
  });
  const ws = new WebSocket(input.wsUrl, input.wsProtocol);
  ws.binaryType = "arraybuffer";

  const connection: TerminalConnection = {
    key: input.key,
    wsUrl: input.wsUrl,
    wsProtocol: input.wsProtocol,
    ws,
    decoder: new TextDecoder(),
    listeners: new Set(),
    lifecycleListeners: new Set(),
    refCount: 0,
    closeTimer: null,
    outputBuffer: "\x1b[90mConnecting...\x1b[0m\r\n",
    handleOpen: () => {
      console.info(`${TERMINAL_DEBUG_PREFIX} ws.open`, {
        wsUrl: redactWsUrl(connection.wsUrl),
        readyState: connection.ws.readyState,
      });
      emitLifecycleEvent(connection, { type: "open" });
      emitChunk(connection, "\x1b[90mConnected.\x1b[0m\r\n");
    },
    handleMessage: (ev: MessageEvent) => {
      const payload = ev.data;
      if (typeof payload === "string") {
        emitChunk(connection, payload);
        return;
      }
      if (payload instanceof ArrayBuffer) {
        emitChunk(
          connection,
          connection.decoder.decode(new Uint8Array(payload), { stream: true }),
        );
        return;
      }
      if (payload instanceof Blob) {
        void payload
          .arrayBuffer()
          .then((buf) => {
            emitChunk(
              connection,
              connection.decoder.decode(new Uint8Array(buf), {
                stream: true,
              }),
            );
          })
          .catch(() => {
            // ignore
          });
        return;
      }
      emitChunk(connection, String(payload));
    },
    handleClose: (ev: CloseEvent) => {
      console.warn(`${TERMINAL_DEBUG_PREFIX} ws.close`, {
        wsUrl: redactWsUrl(connection.wsUrl),
        code: ev.code,
        reason: ev.reason,
        wasClean: ev.wasClean,
      });
      emitLifecycleEvent(connection, {
        type: "close",
        code: ev.code,
        reason: ev.reason,
        wasClean: ev.wasClean,
      });
      const reason = ev.reason.trim();
      const details =
        reason.length > 0
          ? ` code=${ev.code} reason=${reason}`
          : ` code=${ev.code}`;
      emitChunk(connection, `\r\n\x1b[90mDisconnected.${details}\x1b[0m\r\n`);
    },
    handleError: (ev: Event) => {
      console.error(`${TERMINAL_DEBUG_PREFIX} ws.error`, {
        wsUrl: redactWsUrl(connection.wsUrl),
        readyState: connection.ws.readyState,
        eventType: ev.type,
      });
      emitLifecycleEvent(connection, {
        type: "error",
        readyState: connection.ws.readyState,
        eventType: ev.type,
      });
      emitChunk(connection, "\r\n\x1b[31mConnection error.\x1b[0m\r\n");
    },
  };

  ws.addEventListener("open", connection.handleOpen);
  ws.addEventListener("message", connection.handleMessage);
  ws.addEventListener("close", connection.handleClose);
  ws.addEventListener("error", connection.handleError);
  return connection;
}

function getOrCreateConnection(input: {
  readonly key: string;
  readonly wsUrl: string;
  readonly wsProtocol: string;
}): TerminalConnection {
  const existing = terminalConnections.get(input.key);
  if (
    existing &&
    (existing.ws.readyState === WebSocket.CONNECTING ||
      existing.ws.readyState === WebSocket.OPEN)
  ) {
    return existing;
  }
  if (existing) {
    teardownConnection(existing);
  }
  const connection = createConnection(input);
  terminalConnections.set(input.key, connection);
  return connection;
}

function retainConnection(input: {
  readonly key: string;
  readonly wsUrl: string;
  readonly wsProtocol: string;
}): TerminalConnection {
  const connection = getOrCreateConnection(input);
  connection.refCount += 1;
  if (connection.closeTimer !== null) {
    window.clearTimeout(connection.closeTimer);
    connection.closeTimer = null;
  }
  return connection;
}

function releaseConnection(connection: TerminalConnection): void {
  connection.refCount = Math.max(0, connection.refCount - 1);
  if (connection.refCount > 0) return;
  if (connection.closeTimer !== null) return;

  connection.closeTimer = window.setTimeout(() => {
    connection.closeTimer = null;
    if (connection.refCount > 0) return;
    teardownConnection(connection);
  }, CONNECTION_IDLE_CLOSE_MS);
}

function subscribeConnection(
  connection: TerminalConnection,
  listener: ConnectionListener,
): () => void {
  connection.listeners.add(listener);
  return () => {
    connection.listeners.delete(listener);
  };
}

function subscribeConnectionLifecycle(
  connection: TerminalConnection,
  listener: ConnectionLifecycleListener,
): () => void {
  connection.lifecycleListeners.add(listener);
  return () => {
    connection.lifecycleListeners.delete(listener);
  };
}

function sendConnectionInput(
  connection: TerminalConnection,
  data: string,
): void {
  if (connection.ws.readyState !== WebSocket.OPEN) return;
  try {
    connection.ws.send(data);
  } catch {
    // ignore
  }
}

function sendConnectionResize(
  connection: TerminalConnection,
  cols: number,
  rows: number,
): void {
  if (connection.ws.readyState !== WebSocket.OPEN) return;
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
  if (cols < 2 || rows < 2) return;
  try {
    connection.ws.send(
      JSON.stringify({
        type: "resize",
        cols: Math.floor(cols),
        rows: Math.floor(rows),
      }),
    );
  } catch {
    // ignore
  }
}

type TerminalPanelProps = {
  readonly wsUrl: string;
  readonly wsAuthToken: string;
  readonly onConnectionLost?: () => void;
};

export function TerminalPanel(props: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onConnectionLostEvent = useEffectEvent(() => {
    props.onConnectionLost?.();
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const connection = retainConnection({
      key: buildTerminalConnectionKey({
        wsUrl: props.wsUrl,
        authToken: props.wsAuthToken,
      }),
      wsUrl: props.wsUrl,
      wsProtocol: buildTerminalWebSocketAuthSubprotocol(props.wsAuthToken),
    });

    let isActive = true;
    let terminalOpened = false;
    let disconnectNotified = false;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: {
        background: "#0b0f14",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    let lastSentCols = 0;
    let lastSentRows = 0;

    let pendingWrite = "";
    let writeScheduled = false;
    const scheduleFlush = () => {
      if (writeScheduled || !terminalOpened) return;
      writeScheduled = true;
      queueMicrotask(() => {
        writeScheduled = false;
        if (!isActive || !terminalOpened) return;
        if (pendingWrite.length === 0) return;
        const data = pendingWrite;
        pendingWrite = "";
        try {
          term.write(data);
        } catch {
          // ignore writes after dispose
        }
      });
    };

    const safeWrite = (data: string) => {
      if (!isActive) return;
      pendingWrite += data;
      scheduleFlush();
    };

    const fitIfVisible = () => {
      if (!isActive || !terminalOpened) return;
      if (!container.isConnected) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width < MIN_TERMINAL_DIMENSION_PX || height < MIN_TERMINAL_DIMENSION_PX) {
        return;
      }
      try {
        fit.fit();
        const cols = term.cols;
        const rows = term.rows;
        if (cols !== lastSentCols || rows !== lastSentRows) {
          lastSentCols = cols;
          lastSentRows = rows;
          sendConnectionResize(connection, cols, rows);
        }
      } catch {
        // ignore transient layout issues
      }
    };

    const openIfVisible = () => {
      if (!isActive || terminalOpened) return;
      if (!container.isConnected) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width < MIN_TERMINAL_DIMENSION_PX || height < MIN_TERMINAL_DIMENSION_PX) {
        return;
      }
      try {
        term.open(container);
        terminalOpened = true;
        scheduleFlush();
        fitIfVisible();
        if (connection.ws.readyState === WebSocket.OPEN) {
          try {
            term.focus();
          } catch {
            // ignore
          }
        }
      } catch (err) {
        console.error(`${TERMINAL_DEBUG_PREFIX} term.open.failed`, {
          wsUrl: redactWsUrl(props.wsUrl),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    let fitRaf: number | null = null;
    let fitSettleTimer: number | null = null;
    const scheduleFit = () => {
      if (!isActive) return;
      if (fitRaf !== null) return;
      fitRaf = window.requestAnimationFrame(() => {
        fitRaf = null;
        if (!isActive) return;
        openIfVisible();
        fitIfVisible();
      });
      if (fitSettleTimer !== null) {
        window.clearTimeout(fitSettleTimer);
      }
      fitSettleTimer = window.setTimeout(() => {
        fitSettleTimer = null;
        if (!isActive) return;
        openIfVisible();
        fitIfVisible();
      }, 120);
    };

    safeWrite(connection.outputBuffer);

    const unsubscribe = subscribeConnection(connection, (chunk) => {
      safeWrite(chunk);
    });
    const unsubscribeLifecycle = subscribeConnectionLifecycle(
      connection,
      (event) => {
        if (!isActive) return;
        if (event.type === "open") {
          disconnectNotified = false;
          return;
        }
        if (disconnectNotified) return;
        disconnectNotified = true;
        onConnectionLostEvent();
      },
    );

    const disposable = term.onData((data) => {
      sendConnectionInput(connection, data);
    });
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (cols !== lastSentCols || rows !== lastSentRows) {
        lastSentCols = cols;
        lastSentRows = rows;
      }
      sendConnectionResize(connection, cols, rows);
    });
    const handleWsOpen = () => {
      sendConnectionResize(connection, term.cols, term.rows);
    };
    connection.ws.addEventListener("open", handleWsOpen);

    const resizeObserver = new ResizeObserver(() => {
      scheduleFit();
    });
    resizeObserver.observe(container);
    window.addEventListener("resize", scheduleFit);
    scheduleFit();

    return () => {
      isActive = false;
      pendingWrite = "";
      writeScheduled = false;
      if (fitRaf !== null) {
        window.cancelAnimationFrame(fitRaf);
        fitRaf = null;
      }
      if (fitSettleTimer !== null) {
        window.clearTimeout(fitSettleTimer);
        fitSettleTimer = null;
      }
      window.removeEventListener("resize", scheduleFit);
      resizeObserver.disconnect();
      disposable.dispose();
      resizeDisposable.dispose();
      connection.ws.removeEventListener("open", handleWsOpen);
      unsubscribe();
      unsubscribeLifecycle();
      try {
        term.dispose();
      } catch {
        // ignore
      }
      releaseConnection(connection);
    };
  }, [props.wsAuthToken, props.wsUrl]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
