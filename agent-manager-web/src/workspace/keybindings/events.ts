// ACTIONS_AND_KEYBINDINGS_SPEC: This file defines workspace keyboard-related
// DOM event names and payloads. Keep docs/ACTIONS_AND_KEYBINDINGS_SPEC.md in
// sync with any additions or behavior changes here.
export const WORKSPACE_OPEN_COORDINATOR_EVENT = 'agent-manager-web:open-coordinator'
export const WORKSPACE_CANCEL_STREAM_EVENT = 'agent-manager-web:cancel-stream'
export const WORKSPACE_PANE_ZOOM_TOGGLE_EVENT =
  'agent-manager-web:workspace-pane-zoom-toggle'
export const WORKSPACE_TOGGLE_ALL_COLLAPSIBLES_EVENT = 'collapsible:toggle-all'

export interface WorkspaceCancelStreamEventDetail {
  readonly leafId?: string
}

export interface WorkspacePaneZoomToggleEventDetail {
  readonly leafId?: string
}

export interface WorkspaceToggleAllCollapsiblesEventDetail {
  readonly open?: boolean
  readonly leafId?: string
}
