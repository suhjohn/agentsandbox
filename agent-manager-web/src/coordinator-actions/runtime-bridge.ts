import type {
  ChatRuntimeController,
  DialogRuntimeController,
  SettingsGeneralRuntimeController,
  SettingsImageDetailRuntimeController,
  SettingsImagesRuntimeController,
  SessionsSidePanelRuntimeController,
  WorkspaceKeybindingRuntimeController,
  WorkspaceRuntimeController,
} from "./types";

type ChatControllerKind = "page" | "dialog";

let dialogOpen = false;
let dialogController: { readonly id: number; readonly value: DialogRuntimeController } | null =
  null;
let workspaceController: {
  readonly id: number;
  readonly value: WorkspaceRuntimeController;
} | null = null;
let sessionsSidePanelController: {
  readonly id: number;
  readonly value: SessionsSidePanelRuntimeController;
} | null = null;
let workspaceKeyboardController: {
  readonly id: number;
  readonly value: WorkspaceKeybindingRuntimeController;
} | null = null;
let settingsGeneralController: {
  readonly id: number;
  readonly value: SettingsGeneralRuntimeController;
} | null = null;
let settingsImagesController: {
  readonly id: number;
  readonly value: SettingsImagesRuntimeController;
} | null = null;
let settingsImageDetailController: {
  readonly id: number;
  readonly value: SettingsImageDetailRuntimeController;
} | null = null;

const chatControllers: Partial<
  Record<ChatControllerKind, { readonly id: number; readonly value: ChatRuntimeController }>
> = {};

let nextRegistrationId = 1;

function nextId(): number {
  const id = nextRegistrationId;
  nextRegistrationId += 1;
  return id;
}

export function setCoordinatorDialogOpen(open: boolean): void {
  dialogOpen = open;
}

export function isCoordinatorDialogOpen(): boolean {
  return dialogOpen;
}

export function registerDialogRuntimeController(
  controller: DialogRuntimeController,
): () => void {
  const id = nextId();
  dialogController = { id, value: controller };
  return () => {
    if (dialogController?.id === id) dialogController = null;
  };
}

export function registerWorkspaceRuntimeController(
  controller: WorkspaceRuntimeController,
): () => void {
  const id = nextId();
  workspaceController = { id, value: controller };
  return () => {
    if (workspaceController?.id === id) workspaceController = null;
  };
}

export function registerSessionsSidePanelRuntimeController(
  controller: SessionsSidePanelRuntimeController,
): () => void {
  const id = nextId();
  sessionsSidePanelController = { id, value: controller };
  return () => {
    if (sessionsSidePanelController?.id === id) sessionsSidePanelController = null;
  };
}

export function registerWorkspaceKeyboardRuntimeController(
  controller: WorkspaceKeybindingRuntimeController,
): () => void {
  const id = nextId();
  workspaceKeyboardController = { id, value: controller };
  return () => {
    if (workspaceKeyboardController?.id === id) workspaceKeyboardController = null;
  };
}

export function registerChatRuntimeController(
  kind: ChatControllerKind,
  controller: ChatRuntimeController,
): () => void {
  const id = nextId();
  chatControllers[kind] = { id, value: controller };
  return () => {
    const current = chatControllers[kind];
    if (current?.id === id) delete chatControllers[kind];
  };
}

export function registerSettingsGeneralRuntimeController(
  controller: SettingsGeneralRuntimeController,
): () => void {
  const id = nextId();
  settingsGeneralController = { id, value: controller };
  return () => {
    if (settingsGeneralController?.id === id) settingsGeneralController = null;
  };
}

export function registerSettingsImagesRuntimeController(
  controller: SettingsImagesRuntimeController,
): () => void {
  const id = nextId();
  settingsImagesController = { id, value: controller };
  return () => {
    if (settingsImagesController?.id === id) settingsImagesController = null;
  };
}

export function registerSettingsImageDetailRuntimeController(
  controller: SettingsImageDetailRuntimeController,
): () => void {
  const id = nextId();
  settingsImageDetailController = { id, value: controller };
  return () => {
    if (settingsImageDetailController?.id === id) settingsImageDetailController = null;
  };
}

export function getDialogRuntimeController(): DialogRuntimeController | null {
  return dialogController?.value ?? null;
}

export function getWorkspaceRuntimeController(): WorkspaceRuntimeController | null {
  return workspaceController?.value ?? null;
}

export function getSessionsSidePanelRuntimeController(): SessionsSidePanelRuntimeController | null {
  return sessionsSidePanelController?.value ?? null;
}

export function getWorkspaceKeyboardRuntimeController(): WorkspaceKeybindingRuntimeController | null {
  return workspaceKeyboardController?.value ?? null;
}

export function getSettingsGeneralRuntimeController(): SettingsGeneralRuntimeController | null {
  return settingsGeneralController?.value ?? null;
}

export function getSettingsImagesRuntimeController(): SettingsImagesRuntimeController | null {
  return settingsImagesController?.value ?? null;
}

export function getSettingsImageDetailRuntimeController(): SettingsImageDetailRuntimeController | null {
  return settingsImageDetailController?.value ?? null;
}

export function getActiveChatRuntimeController(): ChatRuntimeController | null {
  if (dialogOpen && chatControllers.dialog) return chatControllers.dialog.value;
  if (chatControllers.page) return chatControllers.page.value;
  return chatControllers.dialog?.value ?? null;
}

export function getChatRuntimeController(
  kind: ChatControllerKind,
): ChatRuntimeController | null {
  return chatControllers[kind]?.value ?? null;
}
