import { Link } from "@tanstack/react-router";
import { WorkspaceProvider } from "@/workspace/store";
import { WorkspaceView } from "@/workspace/ui/workspace-view";
import { useAuth } from "@/lib/auth";
import { CoordinatorWorkspaceBridge } from "@/coordinator-actions/workspace-bridge";

export function WorkspacePage() {
  const auth = useAuth();

  if (!auth.user) {
    return (
      <div className="h-dvh grid place-items-center px-6">
        <div className="max-w-md w-full rounded-2xl border bg-bg px-6 py-5">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Please <Link to="/login" className="underline">log in</Link> to use the workspace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <WorkspaceProvider userId={auth.user.id}>
      <CoordinatorWorkspaceBridge />
      <WorkspaceView />
    </WorkspaceProvider>
  );
}
