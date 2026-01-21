import { useRef } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { ScrollArea } from "./scroll-area";

export type PickerItem = {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly meta?: ReactNode;
};

export type PickerPopoverProps = {
  readonly valueId: string;
  readonly valueLabel?: string;
  readonly placeholder: string;
  readonly queryPlaceholder: string;
  readonly query: string;
  readonly onQueryChange: (next: string) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly items: readonly PickerItem[];
  readonly recentItems?: readonly PickerItem[];
  readonly recentSectionLabel?: string;
  readonly manualOption?: {
    readonly label: string;
    readonly onSelect: () => void;
  };
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly hasMore: boolean;
  readonly onLoadMore: () => void;
  readonly onSelect: (id: string) => void;
  readonly emptyLabel: string;
  readonly disabled?: boolean;
  readonly footer?: ReactNode;
  readonly sectionLabel?: string;
  readonly showSearch?: boolean;
  readonly showFooter?: boolean;
  readonly triggerProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  readonly contentClassName?: string;
};

export function PickerPopover(props: PickerPopoverProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const showSearch = props.showSearch ?? true;
  const showFooter = props.showFooter ?? true;
  const showRecents =
    showSearch &&
    props.recentItems &&
    props.recentItems.length > 0 &&
    props.query.trim() === "";

  const {
    className: triggerClassName,
    disabled,
    ...restTriggerProps
  } = props.triggerProps ?? {};

  const triggerDisabled = Boolean(props.disabled || disabled);

  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-left min-w-0 max-w-full",
            "bg-transparent text-text-primary transition-colors hover:bg-surface-3",
            "disabled:opacity-60 disabled:cursor-not-allowed",
            triggerClassName,
          )}
          disabled={triggerDisabled}
          {...restTriggerProps}
        >
          <span
            className="min-w-0 flex-1 truncate"
            title={props.valueLabel || props.placeholder}
          >
            {props.valueLabel || props.placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-text-tertiary" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn(
          "w-[360px] p-0 bg-[var(--color-popover)] divide-y",
          props.contentClassName,
        )}
        onOpenAutoFocus={(event) => {
          if (!showSearch) return;
          event.preventDefault();
          queueMicrotask(() => inputRef.current?.focus());
        }}
      >
        {showSearch ? (
          <div className="p-1">
            <Input
              ref={inputRef}
              value={props.query}
              onChange={(e) => props.onQueryChange(e.target.value)}
              placeholder={props.queryPlaceholder}
              className="h-8 bg-transparent"
            />
          </div>
        ) : null}

        <ScrollArea className={showFooter ? "h-[280px]" : ""}>
          <div className="p-2 space-y-2">
            {showRecents ? (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-text-tertiary px-2">
                  {props.recentSectionLabel ?? "Recent"}
                </div>
                <div className="flex flex-col">
                  {props.recentItems?.map((item) => (
                    <PickerRow
                      key={item.id}
                      item={item}
                      selected={item.id === props.valueId}
                      onSelect={() => props.onSelect(item.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {props.items.length > 0 ? (
              <div className="flex flex-col gap-2">
                {!props.sectionLabel ? null : (
                  <div className="text-[11px] text-text-tertiary px-2">
                    {props.sectionLabel ?? "All items"}
                  </div>
                )}
                <div className="flex flex-col">
                  {props.items.map((item) => (
                    <PickerRow
                      key={item.id}
                      item={item}
                      selected={item.id === props.valueId}
                      onSelect={() => props.onSelect(item.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {props.manualOption ? (
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start text-xs"
                onClick={props.manualOption.onSelect}
              >
                {props.manualOption.label}
              </Button>
            ) : null}

            {props.loading ? (
              <div className="text-xs text-text-tertiary">Loading…</div>
            ) : null}

            {props.error ? (
              <div className="text-xs text-destructive">{props.error}</div>
            ) : null}

            {!props.loading &&
            !props.error &&
            props.items.length === 0 &&
            !showRecents ? (
              <div className="text-xs text-text-tertiary">
                {props.emptyLabel}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function PickerRow(props: {
  readonly item: PickerItem;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "w-full px-2 py-2 text-left transition-colors",
        props.selected
          ? "bg-surface-2 text-text-primary"
          : "text-text-secondary hover:bg-surface-2",
      )}
      onClick={props.onSelect}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="text-sm truncate">{props.item.title}</div>
        </div>
        <div className="flex-1" />
        {props.item.meta}
      </div>
    </button>
  );
}
