import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { useAuth } from "../lib/auth";
import { CoordinatorSessionDialog } from "../components/coordinator-session-dialog";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  getDialogRuntimeController,
  setCoordinatorDialogOpen,
} from "@/frontend-runtime/bridge";
import {
  listAvailableMicrophones,
  readPreferredMicrophoneId,
  startRealtimeCoordinatorPtt,
  type RealtimeCoordinatorPttSession,
  writePreferredMicrophoneId,
} from "@/lib/coordinator-ptt";

const COORDINATOR_COMPOSE_EVENT = "agent-manager-web:coordinator-compose";
const COORDINATOR_PTT_START_EVENT = "agent-manager-web:coordinator-ptt-start";
const COORDINATOR_PTT_STOP_EVENT = "agent-manager-web:coordinator-ptt-stop";
const COORDINATOR_PTT_STATE_EVENT = "agent-manager-web:coordinator-ptt-state";

type CoordinatorPttStatus = "idle" | "starting" | "recording" | "transcribing";

function isCoordinatorToggleShortcut(e: KeyboardEvent): boolean {
  return (
    e.code === "Space" && e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey
  );
}

function isCoordinatorNewChatShortcut(e: KeyboardEvent): boolean {
  return (
    e.code === "Space" && e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey
  );
}

function isCoordinatorSessionsListShortcut(e: KeyboardEvent): boolean {
  return (
    e.code === "KeyL" && e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey
  );
}

function isCoordinatorPttShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.code === "Period";
}

function getCoordinatorPttDeviceCycleDirection(e: KeyboardEvent): -1 | 1 | 0 {
  if (!(e.metaKey || e.ctrlKey)) return 0;
  if (e.code === "ArrowUp") return -1;
  if (e.code === "ArrowDown") return 1;
  return 0;
}

function scoreMicrophoneLabel(label: string): number {
  const lower = label.toLowerCase();
  let score = 0;
  if (
    lower.includes("built-in") ||
    lower.includes("macbook") ||
    lower.includes("microphone")
  ) {
    score += 3;
  }
  if (
    lower.includes("usb") ||
    lower.includes("focusrite") ||
    lower.includes("shure")
  ) {
    score += 4;
  }
  if (
    lower.includes("bluetooth") ||
    lower.includes("airpods") ||
    lower.includes("hands-free") ||
    lower.includes("headset") ||
    lower.includes("sco")
  ) {
    score -= 6;
  }
  return score;
}

export function RootLayout() {
  const auth = useAuth();
  const [isCoordinatorDialogOpen, setIsCoordinatorDialogOpen] = useState(false);
  const setCoordinatorDialogOpenPersisted = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setIsCoordinatorDialogOpen((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        setCoordinatorDialogOpen(resolved);
        return resolved;
      });
    },
    [],
  );
  const [pttStatus, setPttStatus] = useState<CoordinatorPttStatus>("idle");
  const [pttLevel, setPttLevel] = useState(0);
  const [pttMicrophoneLabel, setPttMicrophoneLabel] = useState<string | null>(
    null,
  );
  const pttStateRef = useRef<"idle" | "starting" | "recording" | "stopping">(
    "idle",
  );
  const pttStopAfterStartRef = useRef(false);
  const pttSessionRef = useRef<RealtimeCoordinatorPttSession | null>(null);
  const pttLastMicDeviceIdRef = useRef<string | null>(null);
  const pttMicSwitchInFlightRef = useRef(false);

  const pushTranscriptToComposer = useCallback(
    (text: string, focus: boolean, send: boolean): void => {
      window.dispatchEvent(
        new CustomEvent(COORDINATOR_COMPOSE_EVENT, {
          detail: {
            text,
            replace: true,
            focus,
            send,
          },
        }),
      );
    },
    [],
  );

  const stopCoordinatorPtt = useCallback(async (): Promise<void> => {
    const state = pttStateRef.current;
    if (state === "idle" || state === "stopping") return;
    if (state === "starting") {
      pttStopAfterStartRef.current = true;
      return;
    }

    const session = pttSessionRef.current;
    pttSessionRef.current = null;
    pttStateRef.current = "stopping";
    setPttStatus("transcribing");
    setPttLevel(0);
    if (!session) {
      pttStateRef.current = "idle";
      setPttStatus("idle");
      setPttLevel(0);
      return;
    }

    try {
      const text = (await session.stop()).trim();
      if (text.length === 0) {
        toast.error("No transcription captured");
        return;
      }
      pushTranscriptToComposer(text, true, true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Transcription failed";
      toast.error(message);
    } finally {
      pttStateRef.current = "idle";
      pttStopAfterStartRef.current = false;
      setPttStatus("idle");
      setPttLevel(0);
    }
  }, [pushTranscriptToComposer]);

  const startCoordinatorPtt = useCallback(async (): Promise<void> => {
    if (pttStateRef.current !== "idle") return;
    if (!auth.user) {
      toast.error("Log in to use voice transcription");
      return;
    }
    if (!auth.accessToken) {
      toast.error("Authentication token unavailable");
      return;
    }

    pttStateRef.current = "starting";
    pttStopAfterStartRef.current = false;
    setPttStatus("starting");
    setPttLevel(0);
    setCoordinatorDialogOpenPersisted(true);

    try {
      let preferredDeviceId = readPreferredMicrophoneId();
      if (!preferredDeviceId) {
        const microphones = await listAvailableMicrophones({
          requestPermission: true,
        });
        if (microphones.length > 0) {
          const bestMic = [...microphones].sort(
            (a, b) =>
              scoreMicrophoneLabel(b.label) - scoreMicrophoneLabel(a.label),
          )[0];
          if (bestMic) {
            preferredDeviceId = bestMic.deviceId;
            writePreferredMicrophoneId(bestMic.deviceId);
            setPttMicrophoneLabel(bestMic.label);
          }
        }
      }

      let dialogController = getDialogRuntimeController();
      if (!dialogController) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        dialogController = getDialogRuntimeController();
      }
      if (!dialogController) {
        throw new Error("Coordinator dialog is not ready");
      }
      let shouldCreateSession = true;
      if (isCoordinatorDialogOpen) {
        try {
          const dialogState = await dialogController.listSessions({ limit: 1 });
          const hasActiveConversationSession =
            dialogState.mode === "conversation" &&
            dialogState.selectedSessionId !== null &&
            dialogState.selectedSessionId.trim().length > 0 &&
            dialogState.isDraftingNewSession === false;
          shouldCreateSession = !hasActiveConversationSession;
        } catch {
          // If we cannot inspect state, keep prior behavior and create a session.
          shouldCreateSession = true;
        }
      }
      if (shouldCreateSession) {
        await dialogController.createSession();
      }

      const session = await startRealtimeCoordinatorPtt({
        baseUrl: auth.baseUrl,
        accessToken: auth.accessToken,
        preferredDeviceId,
        onMicrophoneInfo: (info) => {
          pttLastMicDeviceIdRef.current = info.deviceId;
          setPttMicrophoneLabel(info.label);
        },
        onLevel: (level) => {
          if (pttStateRef.current !== "recording") return;
          setPttLevel(level);
        },
      });
      pttSessionRef.current = session;
      pttStateRef.current = "recording";
      setPttStatus("recording");
      setPttLevel(0);

      if (pttStopAfterStartRef.current) {
        await stopCoordinatorPtt();
      }
    } catch (error) {
      pttStateRef.current = "idle";
      pttStopAfterStartRef.current = false;
      setPttStatus("idle");
      setPttLevel(0);
      pttSessionRef.current?.cancel();
      pttSessionRef.current = null;
      const message =
        error instanceof Error
          ? error.message
          : "Failed to start transcription";
      toast.error(message);
    }
  }, [
    auth.accessToken,
    auth.baseUrl,
    auth.user,
    isCoordinatorDialogOpen,
    setCoordinatorDialogOpenPersisted,
    stopCoordinatorPtt,
  ]);

  const cycleCoordinatorPttInputDevice = useCallback(
    async (direction: -1 | 1): Promise<void> => {
      if (pttMicSwitchInFlightRef.current) return;
      pttMicSwitchInFlightRef.current = true;
      try {
        const microphones = await listAvailableMicrophones({
          requestPermission: true,
        });
        if (microphones.length === 0) {
          toast.error("No microphone devices found");
          return;
        }

        const preferredId = readPreferredMicrophoneId();
        const currentId = preferredId ?? pttLastMicDeviceIdRef.current;
        const currentIndex = currentId
          ? microphones.findIndex((mic) => mic.deviceId === currentId)
          : -1;
        const baseIndex = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex =
          (baseIndex + direction + microphones.length) % microphones.length;
        const nextMic = microphones[nextIndex];
        if (!nextMic) return;

        writePreferredMicrophoneId(nextMic.deviceId);
        setPttMicrophoneLabel(nextMic.label);

        if (pttStateRef.current !== "recording") return;
        const previousSession = pttSessionRef.current;
        pttSessionRef.current = null;
        pttStateRef.current = "idle";
        pttStopAfterStartRef.current = false;
        setPttStatus("idle");
        setPttLevel(0);
        previousSession?.cancel();
        await startCoordinatorPtt();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to switch microphone";
        toast.error(message);
      } finally {
        pttMicSwitchInFlightRef.current = false;
      }
    },
    [startCoordinatorPtt],
  );

  const getReadyDialogController = useCallback(async () => {
    let dialogController = getDialogRuntimeController();
    if (dialogController) return dialogController;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    dialogController = getDialogRuntimeController();
    return dialogController;
  }, []);

  const focusCoordinatorComposer = useCallback(async (): Promise<void> => {
    const dialogController = await getReadyDialogController();
    await dialogController?.focusComposer();
  }, [getReadyDialogController]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const cycleDirection = getCoordinatorPttDeviceCycleDirection(e);
      if (cycleDirection !== 0 && pttStateRef.current !== "idle") {
        if (!e.repeat) {
          e.preventDefault();
          void cycleCoordinatorPttInputDevice(cycleDirection);
        }
        return;
      }
      if (isCoordinatorPttShortcut(e)) {
        if (!e.repeat) {
          e.preventDefault();
          void startCoordinatorPtt();
        }
        return;
      }
      if (isCoordinatorNewChatShortcut(e)) {
        if (!e.repeat) {
          e.preventDefault();
          setCoordinatorDialogOpenPersisted(true);
          void getReadyDialogController().then(async (controller) => {
            await controller?.draftNewSession();
            await controller?.focusComposer();
          });
        }
        return;
      }
      if (isCoordinatorSessionsListShortcut(e)) {
        if (!e.repeat) {
          e.preventDefault();
          setCoordinatorDialogOpenPersisted(true);
          void getReadyDialogController().then((controller) =>
            controller?.openSessionsList(),
          );
        }
        return;
      }
      if (!isCoordinatorToggleShortcut(e)) return;
      e.preventDefault();
      const willOpen = !isCoordinatorDialogOpen;
      setCoordinatorDialogOpenPersisted((prev) => !prev);
      if (willOpen) {
        void focusCoordinatorComposer();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const shouldStopByShortcut = isCoordinatorPttShortcut(e);
      const shouldStopByModifierRelease =
        pttStateRef.current !== "idle" &&
        (e.key === "Meta" || e.key === "Control");
      if (!shouldStopByShortcut && !shouldStopByModifierRelease) return;
      e.preventDefault();
      void stopCoordinatorPtt();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    cycleCoordinatorPttInputDevice,
    focusCoordinatorComposer,
    getReadyDialogController,
    setCoordinatorDialogOpenPersisted,
    startCoordinatorPtt,
    stopCoordinatorPtt,
  ]);

  useEffect(() => {
    const onOpen = () => setCoordinatorDialogOpenPersisted(true);
    const onClose = () => setCoordinatorDialogOpenPersisted(false);
    const onPttStart = () => {
      void startCoordinatorPtt();
    };
    const onPttStop = () => {
      void stopCoordinatorPtt();
    };
    window.addEventListener("agent-manager-web:open-coordinator", onOpen);
    window.addEventListener("agent-manager-web:close-coordinator", onClose);
    window.addEventListener(COORDINATOR_PTT_START_EVENT, onPttStart);
    window.addEventListener(COORDINATOR_PTT_STOP_EVENT, onPttStop);
    return () => {
      window.removeEventListener("agent-manager-web:open-coordinator", onOpen);
      window.removeEventListener(
        "agent-manager-web:close-coordinator",
        onClose,
      );
      window.removeEventListener(COORDINATOR_PTT_START_EVENT, onPttStart);
      window.removeEventListener(COORDINATOR_PTT_STOP_EVENT, onPttStop);
    };
  }, [
    setCoordinatorDialogOpenPersisted,
    startCoordinatorPtt,
    stopCoordinatorPtt,
  ]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(COORDINATOR_PTT_STATE_EVENT, {
        detail: {
          status: pttStatus,
          level: pttStatus === "recording" ? pttLevel : 0,
          microphoneLabel: pttMicrophoneLabel,
        },
      }),
    );
  }, [pttLevel, pttMicrophoneLabel, pttStatus]);

  useEffect(() => {
    return () => {
      pttStopAfterStartRef.current = false;
      pttSessionRef.current?.cancel();
      pttSessionRef.current = null;
      pttStateRef.current = "idle";
    };
  }, []);

  return (
    <div className="h-dvh w-full">
      <Toaster position="bottom-right" />
      <CoordinatorSessionDialog
        open={isCoordinatorDialogOpen}
        onOpenChange={setCoordinatorDialogOpenPersisted}
      />

      {auth.error ? (
        <div className="mx-4 mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {auth.error}
        </div>
      ) : null}

      <Outlet />
    </div>
  );
}
