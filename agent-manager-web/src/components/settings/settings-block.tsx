import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SettingsBlock(props: {
readonly title: ReactNode;
readonly description?: ReactNode;
readonly action?: ReactNode;
readonly children: ReactNode;
readonly className?: string;
}) {
return (
<div className={cn("px-4 py-4 space-y-3", props.className)}>
<div className="flex items-start justify-between gap-3">
<div className="min-w-0">
<div className="text-sm font-semibold text-text-primary truncate">
{props.title}
</div>
{props.description ? (
<div className="mt-1 text-xs text-text-tertiary">
{props.description}
</div>
) : null}
</div>
{props.action ? <div className="shrink-0">{props.action}</div> : null}
</div>
<div>{props.children}</div>
</div>
);
}

