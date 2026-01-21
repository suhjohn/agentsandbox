import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { ChatConversationPage } from "@/routes/chat-conversation";
import { Button } from "@/components/ui/button";
import type { PanelDefinition } from "./types";

export interface CoordinatorPanelConfig {}

function deserializeCoordinatorConfig(): CoordinatorPanelConfig {
  return {};
}

function CoordinatorPanel() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const coordinatorSessionsQuery = useQuery({
    queryKey: ["coordinatorSessions"],
    queryFn: () => auth.api.listCoordinatorSessions({ limit: 20 }),
    enabled: !!auth.user && !auth.isBootstrapping,
  });

  const createCoordinatorSessionMutation = useMutation({
    mutationFn: async () => auth.api.createCoordinatorSession(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["coordinatorSessions"] });
    },
  });

  const coordinatorSessionId =
    coordinatorSessionsQuery.data?.data[0]?.id ??
    createCoordinatorSessionMutation.data?.id ??
    null;

  if (auth.isBootstrapping) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-text-secondary">
        Loading coordinator…
      </div>
    );
  }

  if (!auth.user) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-text-secondary">
        Please log in to use coordinator.
      </div>
    );
  }

  if (coordinatorSessionsQuery.isLoading) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-text-secondary">
        Loading coordinator…
      </div>
    );
  }

  if (coordinatorSessionsQuery.isError) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-destructive">
        {(coordinatorSessionsQuery.error as Error).message}
      </div>
    );
  }

  if (createCoordinatorSessionMutation.isError) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-destructive">
        {(createCoordinatorSessionMutation.error as Error).message}
      </div>
    );
  }

  if (!coordinatorSessionId) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-text-secondary">
        <div className="flex flex-col items-center gap-3">
          <span>No coordinator session yet.</span>
          <Button
            size="sm"
            onClick={() => {
              void createCoordinatorSessionMutation.mutateAsync();
            }}
            disabled={createCoordinatorSessionMutation.isPending}
          >
            {createCoordinatorSessionMutation.isPending
              ? "Creating…"
              : "Create coordinator session"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0">
      <ChatConversationPage
        coordinatorSessionId={coordinatorSessionId}
        variant="dialog"
        showDelete={false}
        showTitle={false}
      />
    </div>
  );
}

export const coordinatorPanelDefinition: PanelDefinition<CoordinatorPanelConfig> = {
  type: "coordinator",
  title: "Coordinator",
  configVersion: 1,
  defaultConfig: {},
  deserializeConfig: () => deserializeCoordinatorConfig(),
  bodyPadding: "none",
  Component: CoordinatorPanel,
};
