import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <div
      className={cn(
        "text-[11px] px-2 py-0.5 rounded-full border shrink-0",
        status === "active"
          ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/10"
          : status === "completed"
            ? "border-blue-500/30 text-blue-600 bg-blue-500/10"
            : "border-zinc-500/30 text-text-secondary bg-zinc-500/10",
      )}
    >
      {status}
    </div>
  );
}

interface PanelHeaderProps {
  title?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PanelHeader({ title, children, actions }: PanelHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {title && <div className="text-xs text-text-tertiary">{title}</div>}
      {children}
      <div className="flex-1" />
      {actions}
    </div>
  );
}

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className, hover, onClick }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface-2 px-3 py-2",
        hover && "cursor-pointer hover:bg-surface-2/80",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

interface InfoRowProps {
  items: Array<{ label: string; value: React.ReactNode }>;
}

export function InfoRow({ items }: InfoRowProps) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-secondary">
      {items.map((item, i) => (
        <div key={i} className="truncate">
          <span className="text-text-tertiary">{item.label}:</span>{" "}
          <span className="font-mono">{item.value ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

interface HeaderRowProps {
  id: React.ReactNode;
  status?: React.ReactNode;
  name?: React.ReactNode;
  actions?: React.ReactNode;
}

export function HeaderRow({ id, status, name, actions }: HeaderRowProps) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="font-mono text-xs truncate">{id}</div>
      {status}
      <div className="flex-1" />
      {name && (
        <div className="text-xs text-text-tertiary truncate">{name}</div>
      )}
      {actions}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

export function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 px-3 rounded-none text-sm border transition-colors",
        active
          ? "border-border bg-surface-2 text-text-primary"
          : "border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}
