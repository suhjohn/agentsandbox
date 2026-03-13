// Tool UI renderers for the agent chat interface
//
// Tools are generated from API routes via @agent-manager/src/agent/tool-generator.ts
// Tool naming convention: ${method}_${path} where path has leading / removed and /: replaced with _
//
// Includes:
// - web_search: OpenAI web search tool
// - Image tools: get_images, post_images, get/patch/delete_images_imageId, post_images_imageId_{archive,build,clone}
// - Session tools: get_sessions, post_sessions, get/patch/delete_sessions_sessionId, post_sessions_sessionId_{archive,resume,complete}

import type { ReactNode } from "react";

// =============================================================================
// Common Types
// =============================================================================

type Visibility = "public" | "private";
type SessionStatus = "active" | "completed" | "archived";

// =============================================================================
// Image Types
// =============================================================================

interface Image {
  id: string;
  visibility: Visibility;
  name: string;
  description?: string | null;
  createdBy: string;
  currentImageId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

interface ListImagesArgs {
  query?: {
    visibility?: Visibility;
    limit?: number;
    cursor?: string;
  };
}

interface ListImagesResult {
  data: Image[];
  nextCursor: string | null;
}

interface CreateImageArgs {
  body: {
    name: string;
    description?: string;
    visibility?: Visibility;
  };
}

interface GetImageArgs {
  params: { imageId: string };
}

interface UpdateImageArgs {
  params: { imageId: string };
  body: {
    name?: string;
    description?: string;
    visibility?: Visibility;
  };
}

interface DeleteImageArgs {
  params: { imageId: string };
}

interface ArchiveImageArgs {
  params: { imageId: string };
}

interface BuildImageArgs {
  params: { imageId: string };
}

interface CloneImageArgs {
  params: { imageId: string };
  body: { name?: string };
}

// =============================================================================
// Session Types
// =============================================================================

interface Session {
  id: string;
  name?: string | null;
  imageId?: string | null;
  currentSandboxId?: string | null;
  status: SessionStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface ListSessionsArgs {
  query?: {
    status?: SessionStatus;
    imageId?: string;
    limit?: number;
    cursor?: string;
  };
}

interface ListSessionsResult {
  data: Session[];
  nextCursor: string | null;
}

interface CreateSessionArgs {
  body: {
    imageId: string;
    message: string;
    parentAgentId?: string;
    region?: string | string[];
    title?: string;
    harness?: string;
    model?: string;
    modelReasoningEffort?: string;
  };
}

interface GetSessionArgs {
  params: { sessionId: string };
}

interface UpdateSessionArgs {
  params: { sessionId: string };
  body: { name?: string };
}

interface DeleteSessionArgs {
  params: { sessionId: string };
}

interface ArchiveSessionArgs {
  params: { sessionId: string };
}

interface ResumeSessionArgs {
  params: { sessionId: string };
}

interface CompleteSessionArgs {
  params: { sessionId: string };
}

// =============================================================================
// Web Search Types (OpenAI web_search tool)
// =============================================================================

interface WebSearchArgs {
  query?: string;
}

interface WebSearchResult {
  action?: {
    url: string;
    type: string;
  };
}

// =============================================================================
// Common Result Types
// =============================================================================

interface OkResult {
  ok: boolean;
}

interface ErrorResult {
  error: string;
}

// =============================================================================
// Tool UI Component Types
// =============================================================================

interface ToolUI {
  args: (props: { args: unknown }) => ReactNode;
  result: (props: { result: unknown }) => ReactNode;
}

// =============================================================================
// Tool UI Map
// =============================================================================

export const ToolUIMap: Record<string, ToolUI> = {
  // Web Search (OpenAI)
  web_search: {
    args: ({ args }) => {
      const a = args as WebSearchArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Web Search</span>
          {a.query && `: ${a.query}`}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as WebSearchResult;
      if (!r.action?.url) {
        return <div className="text-sm text-muted-foreground">No results</div>;
      }
      return (
        <div className="text-sm">
          <a
            href={r.action.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            {r.action.url}
          </a>
        </div>
      );
    },
  },

  // Images
  get_images: {
    args: ({ args }) => {
      const a = args as ListImagesArgs;
      return (
        <div className="text-sm">
          List images
          {a.query?.visibility && ` (${a.query.visibility})`}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as ListImagesResult;
      return <div className="text-sm">Found {r.data?.length ?? 0} images</div>;
    },
  },

  post_images: {
    args: ({ args }) => {
      const a = args as CreateImageArgs;
      return (
        <div className="text-sm">
          <div>
            <span className="font-medium">Create image:</span> {a.body?.name}
            {a.body?.visibility && (
              <span className="text-muted-foreground"> ({a.body.visibility})</span>
            )}
          </div>
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as Image | ErrorResult;
      if ("error" in r) {
        return <div className="text-sm text-destructive">{r.error}</div>;
      }
      return (
        <div className="text-sm">
          Created image: {r.name} ({r.id})
        </div>
      );
    },
  },

  get_images_imageId: {
    args: ({ args }) => {
      const a = args as GetImageArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Get image:</span> {a.params?.imageId}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as Image | ErrorResult;
      return (
        <div className="text-sm">
          {"error" in r ? r.error : `Image: ${r.name}`}
        </div>
      );
    },
  },

  patch_images_imageId: {
    args: ({ args }) => {
      const a = args as UpdateImageArgs;
      return (
        <div className="text-sm">
          <div>
            <span className="font-medium">Update image:</span> {a.params?.imageId}
            {a.body?.name && <span> → {a.body.name}</span>}
          </div>
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as Image | ErrorResult;
      if ("error" in r) {
        return <div className="text-sm text-destructive">{r.error}</div>;
      }
      return (
        <div className="text-sm">
          Updated: {r.name}
        </div>
      );
    },
  },

  delete_images_imageId: {
    args: ({ args }) => {
      const a = args as DeleteImageArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Delete image:</span> {a.params?.imageId}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as OkResult;
      return <div className="text-sm">{r.ok ? "Deleted" : "Failed"}</div>;
    },
  },

  post_images_imageId_archive: {
    args: ({ args }) => {
      const a = args as ArchiveImageArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Archive image:</span> {a.params?.imageId}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as Image | ErrorResult;
      return (
        <div className="text-sm">
          {"error" in r ? r.error : `Archived: ${r.name}`}
        </div>
      );
    },
  },

  post_images_imageId_build: {
    args: ({ args }) => {
      const a = args as BuildImageArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Build image:</span> {a.params?.imageId}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as Image | ErrorResult;
      return (
        <div className="text-sm">
          {"error" in r ? r.error : `Built: ${r.name}`}
        </div>
      );
    },
  },

  post_images_imageId_clone: {
    args: ({ args }) => {
      const a = args as CloneImageArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Clone image:</span> {a.params?.imageId}
          {a.body?.name && ` as "${a.body.name}"`}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as Image | ErrorResult;
      return (
        <div className="text-sm">
          {"error" in r ? r.error : `Cloned: ${r.name}`}
        </div>
      );
    },
  },

  // Sessions
  get_sessions: {
    args: ({ args }) => {
      const a = args as ListSessionsArgs;
      return (
        <div className="text-sm">
          List sessions
          {a.query?.status && ` (${a.query.status})`}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as ListSessionsResult;
      return <div className="text-sm">Found {r.data?.length ?? 0} sessions</div>;
    },
  },

  post_sessions: {
    args: ({ args }) => {
      const a = args as CreateSessionArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Create session</span>
          {a.body?.title ? `: ${a.body.title}` : ""}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as Session;
      return <div className="text-sm">Created session: {r.name ?? r.id}</div>;
    },
  },

  get_sessions_sessionId: {
    args: ({ args }) => {
      const a = args as GetSessionArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Get session:</span> {a.params?.sessionId}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as Session | ErrorResult;
      return (
        <div className="text-sm">
          {"error" in r ? r.error : `Session: ${r.name ?? r.id}`}
        </div>
      );
    },
  },

  patch_sessions_sessionId: {
    args: ({ args }) => {
      const a = args as UpdateSessionArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Update session:</span> {a.params?.sessionId}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as Session | ErrorResult;
      return (
        <div className="text-sm">
          {"error" in r ? r.error : `Updated: ${r.name ?? r.id}`}
        </div>
      );
    },
  },

  delete_sessions_sessionId: {
    args: ({ args }) => {
      const a = args as DeleteSessionArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Delete session:</span> {a.params?.sessionId}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as OkResult;
      return <div className="text-sm">{r.ok ? "Deleted" : "Failed"}</div>;
    },
  },

  post_sessions_sessionId_archive: {
    args: ({ args }) => {
      const a = args as ArchiveSessionArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Archive session:</span> {a.params?.sessionId}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as Session | ErrorResult;
      return (
        <div className="text-sm">
          {"error" in r ? r.error : `Archived: ${r.name ?? r.id}`}
        </div>
      );
    },
  },

  post_sessions_sessionId_resume: {
    args: ({ args }) => {
      const a = args as ResumeSessionArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Resume session:</span> {a.params?.sessionId}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as Session | ErrorResult;
      return (
        <div className="text-sm">
          {"error" in r ? r.error : `Resumed: ${r.name ?? r.id}`}
        </div>
      );
    },
  },

  post_sessions_sessionId_complete: {
    args: ({ args }) => {
      const a = args as CompleteSessionArgs;
      return (
        <div className="text-sm">
          <span className="font-medium">Complete session:</span> {a.params?.sessionId}
        </div>
      );
    },
    result: ({ result }) => {
      const r = result as Session | ErrorResult;
      return (
        <div className="text-sm">
          {"error" in r ? r.error : `Completed: ${r.name ?? r.id}`}
        </div>
      );
    },
  },

};

// =============================================================================
// Helper to render tool UI
// =============================================================================

export function renderToolArgs(toolName: string, args: unknown): ReactNode {
  const ui = ToolUIMap[toolName];
  if (!ui) {
    return (
      <div className="text-sm text-gray-500">
        {toolName}: {JSON.stringify(args)}
      </div>
    );
  }
  return ui.args({ args });
}

export function renderToolResult(toolName: string, result: unknown): ReactNode {
  const ui = ToolUIMap[toolName];
  if (!ui) {
    return <div className="text-sm text-gray-500">{JSON.stringify(result)}</div>;
  }
  return ui.result({ result });
}
