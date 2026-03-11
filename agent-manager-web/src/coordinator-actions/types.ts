import type { QueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { AuthContextValue } from "@/lib/auth";

export type ActionErrorCode =
  | "ACTION_UNKNOWN"
  | "ACTION_INVALID_PARAMS"
  | "ACTION_UNAVAILABLE"
  | "ACTION_TIMEOUT"
  | "ACTION_EXECUTION_FAILED"
  | "ACTION_ABORTED";

export type ActionUnavailableReason =
  | "NOT_AUTHENTICATED"
  | "WRONG_ROUTE"
  | "DIALOG_CLOSED"
  | "STREAM_IN_PROGRESS"
  | "MUTATION_IN_PROGRESS"
  | "MISSING_REQUIRED_ENTITY"
  | "UI_NOT_READY";

export type SessionsSidePanelTimeRange = "all" | "24h" | "7d" | "30d" | "90d";

export type SessionsSidePanelArchivedFilter = "all" | "true" | "false";

export type SessionsSidePanelGroupBy = "none" | "imageId" | "createdBy" | "status";

export type SessionsSidePanelFilters = {
  readonly imageId: string;
  readonly agentId: string;
  readonly createdBy: string;
  readonly archived: SessionsSidePanelArchivedFilter;
  readonly status: string;
  readonly updatedAtRange: SessionsSidePanelTimeRange;
  readonly createdAtRange: SessionsSidePanelTimeRange;
  readonly q: string;
};

export type SessionsSidePanelSnapshot = {
  readonly open: boolean;
  readonly widthPx: number;
  readonly filters: SessionsSidePanelFilters;
  readonly groupBy: SessionsSidePanelGroupBy;
  readonly hasActiveFilters: boolean;
};

export type UiContextSnapshot = {
  readonly isAuthenticated: boolean;
  readonly routePath: string;
  readonly workspaceReady: boolean;
  readonly workspaceWindowCount: number;
  readonly workspaceLeafCount: number;
  readonly workspaceFocusedLeafId: string | null;
  readonly workspacePanelTypes: readonly string[];
  readonly workspaceSessionsPanelOpen: boolean;
  readonly workspaceSessionsPanelGroupBy: SessionsSidePanelGroupBy;
  readonly workspaceSessionsPanelHasActiveFilters: boolean;
  readonly chatDialogOpen: boolean;
  readonly chatStreaming: boolean;
  readonly chatHasConversation: boolean;
  readonly settingsGeneralReady: boolean;
  readonly settingsGeneralDirty: boolean;
  readonly settingsGeneralCanSave: boolean;
  readonly settingsImagesReady: boolean;
  readonly settingsImagesCount: number;
  readonly settingsImageDetailReady: boolean;
  readonly settingsImageLoaded: boolean;
  readonly settingsImageCanEdit: boolean;
  readonly settingsImageArchived: boolean;
  readonly settingsImageBuildRunning: boolean;
  readonly activeImageId: string | null;
  readonly hasDirtyImageDraft: boolean;
  readonly isBusy: boolean;
};

export type WorkspaceLayoutNodeSnapshot =
  | {
      readonly kind: "leaf";
      readonly leafId: string;
      readonly panelInstanceId: string;
    }
  | {
      readonly kind: "split";
      readonly splitId: string;
      readonly direction: "row" | "col";
      readonly ratio: number;
      readonly a: WorkspaceLayoutNodeSnapshot;
      readonly b: WorkspaceLayoutNodeSnapshot;
    };

export type WorkspacePanelType =
  | "coordinator"
  | "agent_list"
  | "agent_create"
  | "agent_detail"
  | "empty";

export type WorkspacePanelStateSnapshot = {
  readonly panelInstanceId: string;
  readonly panelType: WorkspacePanelType;
  readonly leafId: string;
  readonly focused: boolean;
  readonly configSummary: Readonly<Record<string, unknown>>;
};

export type WorkspaceStateSnapshot = {
  readonly workspaceReady: boolean;
  readonly workspaceFocusedLeafId: string | null;
  readonly workspacePanelTypes: readonly string[];
  readonly layout: WorkspaceLayoutNodeSnapshot | null;
  readonly panels: readonly WorkspacePanelStateSnapshot[];
};

export type UiStateSnapshot = {
  readonly capturedAt: string;
  readonly context: UiContextSnapshot;
  readonly workspace: WorkspaceStateSnapshot | null;
};

export type ChatRuntimeController = {
  readonly sendMessage: (
    text: string,
  ) => Promise<{ readonly accepted: boolean; readonly streamingStarted: boolean }>;
  readonly focusInput: () => Promise<{ readonly focused: boolean }>;
  readonly stopStream: () => Promise<{ readonly stopped: boolean }>;
  readonly isStreaming: () => boolean;
  readonly hasConversation: () => boolean;
};

export type DialogRuntimeController = {
  readonly openSessionsList: () => Promise<{ readonly mode: "sessions" }>;
  readonly focusComposer: () => Promise<{ readonly focused: boolean }>;
  readonly draftNewSession: () => Promise<{
    readonly drafted: true;
    readonly mode: "conversation";
  }>;
  readonly listSessions: (input?: {
    readonly limit?: number;
    readonly cursor?: string;
  }) => Promise<{
    readonly sessions: readonly {
      readonly id: string;
      readonly title: string | null;
      readonly createdBy: string;
      readonly createdAt: string;
      readonly updatedAt: string;
    }[];
    readonly nextCursor: string | null;
    readonly selectedSessionId: string | null;
    readonly mode: "conversation" | "sessions";
    readonly isDraftingNewSession: boolean;
  }>;
  readonly selectSession: (input: {
    readonly coordinatorSessionId: string;
  }) => Promise<{
    readonly selected: true;
    readonly coordinatorSessionId: string;
    readonly mode: "conversation";
  }>;
  readonly createSession: (input?: {
    readonly title?: string;
  }) => Promise<{
    readonly created: true;
    readonly coordinatorSessionId: string;
    readonly mode: "conversation";
  }>;
  readonly clearConversation: () => Promise<{ readonly cleared: boolean }>;
  readonly canClearConversation: () => boolean;
};

export type WorkspaceRuntimeController = {
  readonly getSnapshot: () => {
    readonly workspaceReady: boolean;
    readonly workspaceWindowCount: number;
    readonly workspaceLeafCount: number;
    readonly workspaceFocusedLeafId: string | null;
    readonly workspacePanelTypes: readonly string[];
  };
  readonly getStateSnapshot: () => WorkspaceStateSnapshot | null;
  readonly listPanels: () => ReadonlyArray<{
    readonly panelInstanceId: string;
    readonly panelType: WorkspacePanelType;
    readonly leafId: string;
    readonly focused: boolean;
  }>;
  readonly focusPane: (input: {
    readonly target: "leaf" | "panel_instance";
    readonly leafId?: string;
    readonly panelInstanceId?: string;
  }) => Promise<{
    readonly focused: true;
    readonly leafId: string;
    readonly panelInstanceId: string;
  }>;
  readonly movePane: (input: {
    readonly fromLeafId?: string;
    readonly fromPanelInstanceId?: string;
    readonly toLeafId?: string;
    readonly toPanelInstanceId?: string;
    readonly placement: "left" | "right" | "top" | "bottom";
  }) => Promise<{
    readonly moved: true;
    readonly fromLeafId: string;
    readonly toLeafId: string;
    readonly placement: "left" | "right" | "top" | "bottom";
    readonly focusedLeafId: string | null;
  }>;
  readonly closePane: (input: {
    readonly target: "focused" | "leaf" | "panel_instance";
    readonly leafId?: string;
    readonly panelInstanceId?: string;
  }) => Promise<{
    readonly closed: true;
    readonly closedLeafId: string;
    readonly closedPanelInstanceId: string;
    readonly focusedLeafId: string | null;
  }>;
  readonly openPanel: (input: {
    readonly panelType: WorkspacePanelType;
    readonly placement: "self" | "left" | "right" | "top" | "bottom";
    readonly config?: unknown;
  }) => Promise<{
    readonly opened: true;
    readonly panelType: WorkspacePanelType;
    readonly placement: "self" | "left" | "right" | "top" | "bottom";
    readonly panelInstanceId: string;
    readonly leafId: string;
  }>;
  readonly setPanelConfig: (input: {
    readonly target: "focused" | "first_of_type" | "panel_instance";
    readonly panelType?: WorkspacePanelType;
    readonly panelInstanceId?: string;
    readonly patch: Record<string, unknown>;
  }) => Promise<{
    readonly updated: true;
    readonly panelType: WorkspacePanelType;
    readonly panelInstanceId: string;
  }>;
  readonly resizeFocusedPanel: (input: {
    readonly dimension: "width" | "height";
    readonly mode: "set_fraction" | "delta_fraction";
    readonly value: number;
  }) => Promise<{
    readonly resized: true;
    readonly splitId: string;
    readonly ratio: number;
    readonly dimension: "width" | "height";
  }>;
};

export type SessionsSidePanelRuntimeController = {
  readonly getSnapshot: () => SessionsSidePanelSnapshot;
  readonly setOpen: (open: boolean) => Promise<SessionsSidePanelSnapshot>;
  readonly setFilters: (
    patch: Partial<SessionsSidePanelFilters>,
  ) => Promise<SessionsSidePanelSnapshot>;
  readonly setGroupBy: (
    groupBy: SessionsSidePanelGroupBy,
  ) => Promise<SessionsSidePanelSnapshot>;
  readonly resetFilters: () => Promise<SessionsSidePanelSnapshot>;
};

export type SettingsGeneralSnapshot = {
  readonly name: string;
  readonly regionText: string;
  readonly isDirty: boolean;
  readonly canSave: boolean;
  readonly regionError: string | null;
};

export type SettingsGeneralRuntimeController = {
  readonly getSnapshot: () => SettingsGeneralSnapshot;
  readonly setName: (name: string) => Promise<{ readonly name: string; readonly dirty: boolean }>;
  readonly setDefaultRegion: (
    regionText: string,
  ) => Promise<{ readonly regionText: string; readonly dirty: boolean }>;
  readonly save: () => Promise<{ readonly saved: true }>;
};

export type SettingsImagesSnapshot = {
  readonly imageIds: readonly string[];
};

export type SettingsImagesRuntimeController = {
  readonly getSnapshot: () => SettingsImagesSnapshot;
};

export type SettingsImageDetailSnapshot = {
  readonly imageId: string;
  readonly imageLoaded: boolean;
  readonly canEdit: boolean;
  readonly isArchived: boolean;
  readonly isBusy: boolean;
  readonly hasDirtyDraft: boolean;
  readonly isBuildRunning: boolean;
};

export type SettingsImageDetailRuntimeController = {
  readonly getSnapshot: () => SettingsImageDetailSnapshot;
  readonly setName: (name: string) => Promise<{ readonly name: string; readonly dirty: boolean }>;
  readonly setDescription: (
    description: string,
  ) => Promise<{ readonly description: string; readonly dirty: boolean }>;
  readonly save: () => Promise<{ readonly saved: true }>;
  readonly revert: () => Promise<{ readonly reverted: true; readonly dirty: false }>;
  readonly clone: () => Promise<{
    readonly cloned: true;
    readonly newImageId: string;
    readonly navigated: true;
  }>;
  readonly startBuild: () => Promise<{ readonly buildStarted: true }>;
  readonly stopBuild: () => Promise<{ readonly buildStopped: true }>;
  readonly archive: () => Promise<{ readonly archived: true; readonly routePath: string }>;
  readonly delete: () => Promise<{ readonly deleted: true; readonly redirectedTo: string }>;
};

export type UiExecutionContext = {
  readonly auth: AuthContextValue;
  readonly navigate: (input: unknown) => Promise<unknown>;
  readonly queryClient: QueryClient;
  readonly snapshot: UiContextSnapshot;
  readonly chatController: ChatRuntimeController | null;
  readonly dialogController: DialogRuntimeController | null;
  readonly workspaceController: WorkspaceRuntimeController | null;
  readonly sessionsSidePanelController: SessionsSidePanelRuntimeController | null;
  readonly settingsGeneralController: SettingsGeneralRuntimeController | null;
  readonly settingsImagesController: SettingsImagesRuntimeController | null;
  readonly settingsImageDetailController: SettingsImageDetailRuntimeController | null;
};

export type SemanticActionDefinition<
  TParams = unknown,
  TResult = unknown,
> = {
  readonly id: string;
  readonly version: 1;
  readonly description: string;
  readonly paramsSchema: z.ZodType<TParams>;
  readonly paramsJsonSchema: Record<string, unknown>;
  readonly canRun: (
    ctx: UiContextSnapshot,
  ) =>
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly reason: ActionUnavailableReason;
        readonly details?: string;
      };
  readonly run: (ctx: UiExecutionContext, params: TParams) => Promise<TResult>;
};

export type ClientToolActionRequest = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly timeoutMs: number;
};

export type ClientToolActionResult =
  {
    readonly toolCallId: string;
    readonly ok: boolean;
    readonly data?: unknown;
    readonly error?: {
      readonly code: ActionErrorCode;
      readonly message: string;
      readonly retryable: boolean;
      readonly reason?: ActionUnavailableReason;
    };
    readonly uiStateBefore: UiStateSnapshot;
    readonly uiStateAfter: UiStateSnapshot;
  };
