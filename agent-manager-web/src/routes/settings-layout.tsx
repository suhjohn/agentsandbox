import { Outlet, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "../lib/auth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Keyboard, Package, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export function SettingsLayout() {
const auth = useAuth();

if (!auth.user) {
return (
<Card>
<CardHeader>
<CardTitle>You need to log in to view settings.</CardTitle>
</CardHeader>
<CardContent>
<div className="text-sm text-text-secondary">
Please sign in on {auth.baseUrl}.
</div>
</CardContent>
</Card>
);
}

return (
<div className="h-dvh w-full flex flex-col bg-surface-1">
<div className="flex flex-1 min-h-0">
<aside className="w-56 shrink-0 border-r bg-surface-1 p-2">
<nav className="flex flex-col gap-1">
<Link
to="/"
className={cn(
"px-3 py-2 text-sm text-text-secondary hover:bg-surface-2 flex items-center gap-2",
)}
>
<ArrowLeft className="h-4 w-4" />
Back to app
</Link>
<Link
to="/settings/general"
className={cn(
"px-3 py-2 text-sm text-text-secondary hover:bg-surface-2 flex items-center gap-2",
)}
activeProps={{ className: "bg-surface-2 text-text-primary" }}
>
<Settings className="h-4 w-4" />
General
</Link>
<Link
to="/settings/images"
className={cn(
"px-3 py-2 text-sm text-text-secondary hover:bg-surface-2 flex items-center gap-2",
)}
activeProps={{ className: "bg-surface-2 text-text-primary" }}
>
<Package className="h-4 w-4" />
Images
</Link>
<Link
to="/settings/keybindings"
className={cn(
"px-3 py-2 text-sm text-text-secondary hover:bg-surface-2 flex items-center gap-2",
)}
activeProps={{ className: "bg-surface-2 text-text-primary" }}
>
<Keyboard className="h-4 w-4" />
Keybindings
</Link>
</nav>
</aside>

<main className="flex-1 min-w-0 overflow-y-auto p-4">
<Outlet />
</main>
</div>
</div>
);
}
