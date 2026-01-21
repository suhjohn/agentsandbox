import { useNavigate } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setIsSubmitting(true);
    try {
      await auth.register({ name, email, password });
      await navigate({ to: "/" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Registration failed";
      setLocalError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Register</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
          {localError ? (
            <div className="rounded-none border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {localError}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <div className="text-sm text-muted-foreground">Name</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <div className="text-sm text-muted-foreground">Email</div>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
            />
          </div>
          <div className="space-y-1.5">
            <div className="text-sm text-muted-foreground">Password</div>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
            />
            <div className="font-mono text-xs text-muted-foreground">
              Must be at least 8 characters.
            </div>
          </div>
          <Button disabled={isSubmitting || auth.isBootstrapping} type="submit">
            {isSubmitting ? "Creating..." : "Create account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
