import {
  createContext,
  useEffect,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  getClientToolDeviceId,
  getSupportedClientTools,
  retainClientToolRegistration,
} from "./device-registration";
import { createClientToolStreamHandler } from "./stream-handler";

type RuntimeAccess = {
  readonly agentApiUrl: string;
  readonly agentAuthToken: string;
};

type ClientToolRuntimeContextValue = {
  readonly deviceId: string;
  readonly ensureRuntimeAccess: (access: RuntimeAccess) => void;
  readonly startRunStream: (input: RuntimeAccess & {
    readonly sessionId: string;
    readonly runId: string;
  }) => void;
};

const ClientToolRuntimeContext =
  createContext<ClientToolRuntimeContextValue | null>(null);

type RegistrationEntry = {
  readonly dispose: () => void;
};

type StreamEntry = {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
};

function runtimeKey(access: RuntimeAccess): string {
  return `${access.agentApiUrl}|${access.agentAuthToken}`;
}

export function ClientToolRuntimeProvider(props: {
  readonly children: ReactNode;
}) {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deviceId = useMemo(() => getClientToolDeviceId(), []);
  const registrationsRef = useRef(new Map<string, RegistrationEntry>());
  const streamsRef = useRef(new Map<string, StreamEntry>());

  useEffect(() => {
    if (auth.user?.id) return;
    for (const entry of streamsRef.current.values()) {
      entry.controller.abort();
    }
    streamsRef.current.clear();
    for (const entry of registrationsRef.current.values()) {
      entry.dispose();
    }
    registrationsRef.current.clear();
  }, [auth.user?.id]);

  useEffect(() => {
    return () => {
      for (const entry of streamsRef.current.values()) {
        entry.controller.abort();
      }
      streamsRef.current.clear();
      for (const entry of registrationsRef.current.values()) {
        entry.dispose();
      }
      registrationsRef.current.clear();
    };
  }, []);

  const value = useMemo<ClientToolRuntimeContextValue>(
    () => ({
      deviceId,
      ensureRuntimeAccess: (access) => {
        if (!auth.user?.id) return;
        const key = runtimeKey(access);
        if (registrationsRef.current.has(key)) return;
        const dispose = retainClientToolRegistration({
          agentApiUrl: access.agentApiUrl,
          agentAuthToken: access.agentAuthToken,
          payload: {
            userId: auth.user.id,
            deviceId,
            tools: getSupportedClientTools(),
            device: {
              platform:
                (
                  window.navigator as Navigator & {
                    userAgentData?: { readonly platform?: string };
                  }
                ).userAgentData?.platform ?? window.navigator.platform,
              label: window.navigator.userAgent,
            },
          },
        });
        registrationsRef.current.set(key, { dispose });
      },
      startRunStream: (input) => {
        if (!auth.user?.id) return;
        if (
          input.sessionId.trim().length === 0 ||
          input.runId.trim().length === 0
        ) {
          return;
        }
        const key = `${runtimeKey(input)}|${input.sessionId}|${input.runId}`;
        if (streamsRef.current.has(key)) return;

        const controller = new AbortController();
        const handler = createClientToolStreamHandler({
          agentApiUrl: input.agentApiUrl,
          agentAuthToken: input.agentAuthToken,
          userId: auth.user.id,
          deviceId,
          deps: {
            auth,
            navigate: (next) => navigate(next as any),
            queryClient,
            deviceId,
          },
          onError: (err) => {
            if (!controller.signal.aborted) {
              console.error("[client-tools] request handling failed", err);
            }
          },
        });

        const promise = (async () => {
          try {
            const response = await fetch(
              `${input.agentApiUrl}/session/${input.sessionId}/message/${input.runId}/stream`,
              {
                method: "GET",
                headers: {
                  Accept: "text/event-stream",
                  "X-Agent-Auth": `Bearer ${input.agentAuthToken}`,
                },
                signal: controller.signal,
              },
            );
            if (!response.ok || !response.body) {
              throw new Error(
                `Run stream failed (${response.status} ${response.statusText})`,
              );
            }
            await handler.consumeRunStream(response.body, controller.signal);
          } catch (err) {
            if (!controller.signal.aborted) {
              console.error("[client-tools] run stream failed", err);
            }
          } finally {
            handler.cancelAll();
            streamsRef.current.delete(key);
          }
        })();

        streamsRef.current.set(key, { controller, promise });
      },
    }),
    [auth, deviceId, navigate, queryClient],
  );

  return (
    <ClientToolRuntimeContext value={value}>
      {props.children}
    </ClientToolRuntimeContext>
  );
}

export function useClientToolRuntime() {
  const value = useContext(ClientToolRuntimeContext);
  if (value == null) {
    throw new Error("ClientToolRuntimeProvider is required");
  }
  return value;
}
