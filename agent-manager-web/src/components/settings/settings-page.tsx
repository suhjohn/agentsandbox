import type { ReactNode } from "react";

export function SettingsPage(props: {
readonly title: ReactNode;
readonly description?: ReactNode;
readonly action?: ReactNode;
readonly children: ReactNode;
}) {
return (
<div className="w-full flex justify-center pt-16">
<div className="max-w-5xl space-y-4 w-full">
<div className="flex items-start justify-between gap-3">
<div className="min-w-0">
<div className="text-base font-semibold truncate">
{props.title}
</div>
{props.description ? (
<div className="mt-1 text-sm text-text-secondary">
{props.description}
</div>
) : null}
</div>
{props.action ? <div className="shrink-0">{props.action}</div> : null}
</div>
{props.children}
</div>
</div>
);
}
