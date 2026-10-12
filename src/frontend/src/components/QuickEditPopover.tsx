import { useState, useRef, useEffect, useCallback, useMemo } from "react";

interface QuickEditOption {
  value: string;
  label: string;
  color?: string;
}

interface QuickEditGroup {
  label: string;
  options: QuickEditOption[];
}

interface QuickEditPopoverProps {
  /** Static options (rendered before groups) */
  options?: QuickEditOption[];
  /** Grouped options with headers */
  groups?: QuickEditGroup[];
  /** Currently selected value */
  value?: string | null;
  /** Called when user selects an option */
  onSelect: (value: string) => void;
  /** Called when popover should close */
  onClose: () => void;
  /** Bounding rect of the trigger element */
  triggerRect: DOMRect;
  /** Placeholder for search input */
  searchPlaceholder?: string;
  /** Placeholder option shown at top (e.g. "Sin categoría") */
  clearLabel?: string;
}

export default function QuickEditPopover({
  options = [],
  groups = [],
  value,
  onSelect,
  onClose,
  triggerRect,
  searchPlaceholder = "Buscar...",
  clearLabel,
}: QuickEditPopoverProps) {
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Position: below trigger, flip above if no space
  const pos = useMemo(() => {
    const dropdownHeight = 240;
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const top =
      spaceBelow < dropdownHeight && triggerRect.top > dropdownHeight
        ? triggerRect.top - dropdownHeight - 4
        : triggerRect.bottom + 4;
    return {
      top,
      left: Math.min(triggerRect.left, window.innerWidth - 220),
    };
  }, [triggerRect]);

  // Focus search on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const allOptions = useMemo(() => {
    const result: QuickEditOption[] = [];
    if (clearLabel) result.push({ value: "__clear__", label: clearLabel });
    const q = search.toLowerCase();
    const matchOpt = (o: QuickEditOption) =>
      !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q);
    options.filter(matchOpt).forEach((o) => result.push(o));
    for (const g of groups) {
      const groupMatch = !q || g.label.toLowerCase().includes(q);
      g.options.filter((o) => groupMatch || matchOpt(o)).forEach((o) => result.push(o));
    }
    return result;
  }, [options, groups, search, clearLabel]);

  const handleSelect = useCallback(
    (val: string) => {
      onSelect(val);
    },
    [onSelect],
  );

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [search]);

  useEffect(() => {
    if (listRef.current && highlightedIndex >= 0) {
      const items = listRef.current.querySelectorAll("[data-option]");
      items[highlightedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((p) => (p < allOptions.length - 1 ? p + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((p) => (p > 0 ? p - 1 : allOptions.length - 1));
          break;
        case "Enter":
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < allOptions.length) {
            handleSelect(allOptions[highlightedIndex].value);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [highlightedIndex, allOptions, handleSelect, onClose],
  );

  return (
    <div
      ref={ref}
      className="fixed z-[9999] bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-lg overflow-hidden flex flex-col"
      style={{ top: pos.top, left: pos.left, width: 220, maxHeight: 260 }}
      onKeyDown={handleKeyDown}
    >
      <div className="p-2 border-b border-[var(--border-color)]">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/30 placeholder:text-[var(--text-tertiary)]"
        />
      </div>
      <div ref={listRef} className="overflow-y-auto flex-1 py-1">
        {allOptions.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            data-option
            onClick={() => handleSelect(opt.value)}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition ${
              highlightedIndex === i
                ? "bg-[var(--color-base-alt)]"
                : value === opt.value
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                  : "text-[var(--text-primary)] hover:bg-[var(--color-base-alt)]"
            }`}
          >
            {opt.color && (
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: opt.color }}
              />
            )}
            <span className="truncate">{opt.label}</span>
          </button>
        ))}
        {allOptions.length === 0 && (
          <div className="px-3 py-3 text-center text-xs text-[var(--text-tertiary)]">
            Sin resultados
          </div>
        )}
      </div>
    </div>
  );
}
