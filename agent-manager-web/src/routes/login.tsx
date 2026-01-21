import { useNavigate } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Github, Globe } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setIsSubmitting(true);
    try {
      await auth.login({ email, password });
      await navigate({ to: "/" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setLocalError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onGithubLogin = async () => {
    setLocalError(null);
    try {
      await auth.loginWithGithub();
      await navigate({ to: "/" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "GitHub login failed";
      setLocalError(message);
    }
  };

  return (
    <div className="h-dvh grid place-items-center px-6">
      <Card className="w-full max-w-md rounded-2xl border border-border bg-surface-1">
        <CardHeader className="items-center gap-2">
          <div className="h-10 w-10 grid place-items-center rounded-xl border border-border bg-surface-2 text-text-secondary">
            <Globe className="h-5 w-5" />
          </div>
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <div className="text-sm text-text-secondary">
            Sign in to continue to Agent Manager
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-center gap-2"
            disabled={auth.isBootstrapping}
            onClick={() => void onGithubLogin()}
          >
            <Github className="h-4 w-4" />
            Continue with GitHub
          </Button>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <div className="text-xs text-text-tertiary">OR</div>
            <Separator className="flex-1" />
          </div>

          <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
            {localError ? (
              <div className="rounded-none border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {localError}
              </div>
            ) : null}
            <div className="space-y-1.5">
              <div className="text-sm text-text-secondary">Email address</div>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="Enter your email"
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-text-secondary">Password</div>
                <button
                  type="button"
                  className="text-xs text-text-tertiary cursor-not-allowed opacity-60"
                  disabled
                >
                  Forgot password?
                </button>
              </div>
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="Enter your password"
                autoComplete="current-password"
              />
            </div>
            <Button
              className="w-full"
              disabled={isSubmitting || auth.isBootstrapping}
              type="submit"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <div className="text-center text-sm text-text-secondary">
            Don&apos;t have an account?{" "}
            <Link to="/register" className="underline">
              Sign up
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
