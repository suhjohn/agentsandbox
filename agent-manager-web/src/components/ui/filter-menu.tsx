import * as React from "react";
import { Check, ListFilter, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export type FilterMenuSelectOption<TValue extends string> = {
  readonly value: TValue;
  readonly label: string;
  readonly disabled?: boolean;
};

export type FilterMenuItem<TId extends string> =
  | {
      readonly id: TId;
      readonly label: string;
      readonly kind: "select";
      readonly value: string;
      readonly options: readonly FilterMenuSelectOption<string>[];
      readonly onChange: (value: string) => void;
      readonly isActive?: boolean;
      readonly renderValue?: (value: string) => string;
      readonly searchable?: boolean;
      readonly multiSelect?: boolean;
    }
  | {
      readonly id: TId;
      readonly label: string;
      readonly kind: "text";
      readonly value: string;
      readonly placeholder?: string;
      readonly onChange: (value: string) => void;
      readonly isActive?: boolean;
    };

function isItemActive(item: FilterMenuItem<string>): boolean {
  if (typeof item.isActive === "boolean") return item.isActive;
  if (item.kind === "text") return item.value.trim().length > 0;
  return item.value !== "all" && item.value !== "none" && item.value !== "";
}

function parseSelectedValues(value: string): Set<string> {
  if (!value.trim()) return new Set();
  return new Set(value.split(",").map((v) => v.trim()).filter(Boolean));
}

function defaultRenderSelectValue(
  item: Extract<FilterMenuItem<string>, { kind: "select" }>,
): string {
  const resetValue = item.options[0]?.value ?? "";
  if (item.multiSelect) {
    if (item.value === resetValue) return "";
    const selected = parseSelectedValues(item.value);
    if (selected.size === 0) return "";
    const labels = item.options
      .filter((o) => selected.has(o.value))
      .map((o) => o.label);
    return labels.length > 0 ? labels.join(", ") : item.value;
  }
  const selected = item.options.find((o) => o.value === item.value);
  return selected?.label ?? item.value;
}

function toggleValue(current: string, toggled: string): string {
  const selected = parseSelectedValues(current);
  if (selected.has(toggled)) {
    selected.delete(toggled);
  } else {
    selected.add(toggled);
  }
  return Array.from(selected).join(",");
}

export type FilterMenuProps<TId extends string> = {
  readonly items: readonly FilterMenuItem<TId>[];
  readonly onClearAll?: () => void;
  readonly className?: string;
  readonly align?: "start" | "center" | "end";
};

export function FilterMenu<TId extends string>({
  items,
  onClearAll,
  className,
  align = "start",
}: FilterMenuProps<TId>) {
  const [open, setOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<TId | null>(
    (items[0]?.id as TId | undefined) ?? null,
  );
  const [selectSearch, setSelectSearch] = React.useState("");

  React.useEffect(() => {
    if (!selectedId && items[0]?.id) setSelectedId(items[0].id as TId);
    if (selectedId && !items.some((i) => i.id === selectedId)) {
      setSelectedId((items[0]?.id as TId | undefined) ?? null);
    }
  }, [items, selectedId]);

  React.useEffect(() => {
    if (!open) setSelectSearch("");
  }, [open]);

  const activeCount = React.useMemo(() => {
    let count = 0;
    for (const item of items) {
      if (isItemActive(item as FilterMenuItem<string>)) count += 1;
    }
    return count;
  }, [items]);

  const selectedItem = React.useMemo(() => {
    if (!selectedId) return null;
    return items.find((i) => i.id === selectedId) ?? null;
  }, [items, selectedId]);

  const showClear = activeCount > 0 && typeof onClearAll === "function";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="icon"
          size="icon"
          className={cn(
            activeCount > 0 ? "bg-accent/15 text-accent" : "",
            className,
          )}
          title={activeCount > 0 ? `Filters (${activeCount})` : "Filters"}
          aria-label="Filters"
        >
          <ListFilter className="h-4 w-4" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align={align}
        sideOffset={6}
        className="w-[540px] p-0 overflow-hidden bg-[var(--color-popover)]"
      >
        <div className="flex h-[360px]">
          <div className="w-[200px] shrink-0 border-r border-border bg-surface-2/40 flex flex-col">
            <div className="flex-1 overflow-auto px-1 py-1">
              {items.map((item) => {
                const isSelected = item.id === selectedId;
                const active = isItemActive(item as FilterMenuItem<string>);
                const summary =
                  item.kind === "select"
                    ? (item.renderValue?.(item.value) ??
                      defaultRenderSelectValue(item))
                    : item.value.trim().length > 0
                      ? item.value.trim()
                      : "";

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "w-full flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm",
                      isSelected
                        ? "bg-surface-2 text-text-primary"
                        : "text-text-secondary hover:bg-surface-4",
                    )}
                    onMouseEnter={() => {
                      setSelectedId(item.id);
                      setSelectSearch("");
                    }}
                  >
                    <div className="min-w-0">
                      <div className="truncate">{item.label}</div>
                      {active && summary ? (
                        <div className="text-[11px] text-text-tertiary truncate">
                          {summary}
                        </div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-xs text-text-tertiary">
                      {active ? "•" : " "}
                    </div>
                  </button>
                );
              })}
            </div>

            {showClear ? (
              <div className="border-t border-border p-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 w-full justify-between"
                  onClick={() => onClearAll()}
                  title="Clear all filters"
                >
                  <span>Clear all</span>
                  <X className="h-4 w-4 text-text-tertiary" />
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            {selectedItem?.kind === "select" && selectedItem.searchable ? (
              <div className="border-b border-border px-2 py-1.5">
                <Input
                  key={selectedId}
                  value={selectSearch}
                  onChange={(e) => setSelectSearch(e.target.value)}
                  placeholder={`Search ${selectedItem.label.toLowerCase()}…`}
                  className="h-7 text-xs bg-transparent border-none shadow-none focus-visible:ring-0 px-1"
                  autoFocus
                />
              </div>
            ) : null}

            <div className="flex-1 overflow-auto p-2">
              {selectedItem?.kind === "select" ? (
                <SelectOptions item={selectedItem} selectSearch={selectSearch} />
              ) : selectedItem?.kind === "text" ? (
                <div className="space-y-2">
                  <Input
                    value={selectedItem.value}
                    onChange={(e) => selectedItem.onChange(e.target.value)}
                    placeholder={selectedItem.placeholder}
                    className="h-9"
                  />
                  <div className="text-xs text-text-tertiary">
                    Updates immediately.
                  </div>
                </div>
              ) : (
                <div className="text-sm text-text-secondary">
                  Select a filter.
                </div>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SelectOptions({
  item,
  selectSearch,
}: {
  readonly item: Extract<FilterMenuItem<string>, { kind: "select" }>;
  readonly selectSearch: string;
}) {
  const resetValue = item.options[0]?.value ?? "";

  const selectedValues = React.useMemo(
    () => (item.multiSelect ? parseSelectedValues(item.value) : null),
    [item.multiSelect, item.value],
  );

  const isResetActive = item.multiSelect
    ? selectedValues!.size === 0 || item.value === resetValue
    : item.value === resetValue;

  const filteredOptions = React.useMemo(() => {
    if (!item.searchable || selectSearch.trim().length === 0) return item.options;
    const q = selectSearch.trim().toLowerCase();
    return item.options.filter(
      (o, i) => i === 0 || o.label.toLowerCase().includes(q),
    );
  }, [item.options, item.searchable, selectSearch]);

  return (
    <div className="flex flex-col">
      {filteredOptions.map((option) => {
        const isReset = option.value === resetValue;
        const isChecked = isReset
          ? isResetActive
          : item.multiSelect
            ? selectedValues!.has(option.value)
            : option.value === item.value;

        const handleClick = () => {
          if (!item.multiSelect) {
            item.onChange(option.value);
            return;
          }
          if (isReset) {
            item.onChange(resetValue);
            return;
          }
          const next = toggleValue(item.value === resetValue ? "" : item.value, option.value);
          item.onChange(next || resetValue);
        };

        return (
          <button
            key={option.value}
            type="button"
            className={cn(
              "flex items-center gap-2 w-full rounded px-2 py-1.5 text-sm text-left transition-colors",
              isChecked
                ? "text-text-primary"
                : "text-text-secondary hover:bg-surface-4",
              option.disabled && "opacity-50 pointer-events-none",
            )}
            disabled={option.disabled}
            onClick={handleClick}
          >
            <Check
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                isChecked ? "text-text-tertiary" : "invisible",
              )}
            />
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
