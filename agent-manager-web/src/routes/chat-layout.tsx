import { Outlet } from "@tanstack/react-router";
import { useAuth } from "../lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ChatLayout() {
  const auth = useAuth();

  if (!auth.user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>You need to log in to use chat.</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-xs text-muted-foreground">
            Use /auth/login or /auth/register on {auth.baseUrl}
          </div>
        </CardContent>
      </Card>
    );
  }

  return <Outlet />;
}
