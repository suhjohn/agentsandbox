import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { ChatConversationPage } from "./chat-conversation";
import { Button } from "@/components/ui/button";

export function ChatIndexPage() {
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

  if (!auth.user) {
    return (
      <div className="text-sm text-muted-foreground">
        You need to log in to use chat.
      </div>
    );
  }

  if (coordinatorSessionsQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading chat…</div>;
  }

  if (coordinatorSessionsQuery.isError) {
    return (
      <div className="text-sm text-destructive">
        {(coordinatorSessionsQuery.error as Error).message}
      </div>
    );
  }

  if (createCoordinatorSessionMutation.isError) {
    return (
      <div className="text-sm text-destructive">
        {(createCoordinatorSessionMutation.error as Error).message}
      </div>
    );
  }

  if (!coordinatorSessionId) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          No coordinator session yet.
        </div>
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
    );
  }

  return <ChatConversationPage coordinatorSessionId={coordinatorSessionId} />;
}
