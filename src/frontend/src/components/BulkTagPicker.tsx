import { useEffect, useMemo, useRef, useState } from "react";

export interface BulkTagOption {
  id: number;
  name: string;
  color: string;
}

interface BulkTagPickerProps {
  triggerRect: DOMRect;
  tags: BulkTagOption[];
  selectedExpenses: { tags?: { id: number; group_name?: string }[] }[];
  onApply: (addIds: number[], removeIds: number[]) => void;
  onClose: () => void;
  isPending: boolean;
}

/**
 * Multi-select tag panel for a bulk selection.
 *
 * Every tag shows three states — all selected expenses have it, some have it,
 * none have it — and the user's changes are staged until "Aplicar". That keeps
 * the number of requests to at most two (add and/or remove) instead of one per
 * toggle, and makes the outcome reviewable before it touches the data.
 */
export default function BulkTagPicker({
  triggerRect,
  tags,
  selectedExpenses,
  onApply,
  onClose,
  isPending,
}: BulkTagPickerProps) {
  const [search, setSearch] = useState("");
  const [desired, setDesired] = useState<Map<number, boolean>>(new Map());
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const total = selectedExpenses.length;

  const counts = useMemo(() => {
    const byTag = new Map<number, number>();
    for (const expense of selectedExpenses) {
      for (const tag of expense.tags ?? []) {
        if (tag.group_name && tag.group_name !== "otros") continue;
        byTag.set(tag.id, (byTag.get(tag.id) ?? 0) + 1);
      }
    }
    return byTag;
  }, [selectedExpenses]);

  const visibleTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((tag) => tag.name.toLowerCase().includes(q));
  }, [tags, search]);

  const isChecked = (tagId: number) => {
    if (desired.has(tagId)) return desired.get(tagId)!;
    return total > 0 && (counts.get(tagId) ?? 0) === total;
  };

  const isIndeterminate = (tagId: number) => {
    if (desired.has(tagId)) return false;
    const count = counts.get(tagId) ?? 0;
    return count > 0 && count < total;
  };

  const toggle = (tagId: number) => {
    setDesired((prev) => {
      const next = new Map(prev);
      next.set(tagId, !isChecked(tagId));
      return next;
    });
  };

  const { addIds, removeIds } = useMemo(() => {
    const add: number[] = [];
    const remove: number[] = [];
    for (const tag of tags) {
      const count = counts.get(tag.id) ?? 0;
      const want = desired.get(tag.id);
      if (want === true && count < total) add.push(tag.id);
      if (want === false && count > 0) remove.push(tag.id);
    }
    return { addIds: add, removeIds: remove };
  }, [tags, counts, desired, total]);

  const changedCount = addIds.length + removeIds.length;

  // Position: above the trigger when there is no room below (the bar lives at
  // the bottom of the viewport), clamped so the panel never leaves the screen.
  const pos = useMemo(() => {
    const width = Math.min(300, window.innerWidth - 16);
    const height = 360;
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const top =
      spaceBelow < height && triggerRect.top > height
        ? triggerRect.top - height - 8
        : triggerRect.bottom + 8;
    const left = Math.max(8, Math.min(triggerRect.left, window.innerWidth - width - 8));
    return { top, left, width };
  }, [triggerRect]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-label="Etiquetas de la selección"
      className="fixed z-[9999] flex max-h-[360px] flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--color-surface)] shadow-lg"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="border-b border-[var(--border-color)] p-2">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar etiqueta…"
          aria-label="Buscar etiqueta"
          className="w-full rounded border border-[var(--border-color)] bg-[var(--color-base-container)] px-2 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/30"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {visibleTags.map((tag) => {
          const count = counts.get(tag.id) ?? 0;
          const checked = isChecked(tag.id);
          const indeterminate = isIndeterminate(tag.id);
          return (
            <label
              key={tag.id}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--color-base-alt)]"
            >
              <input
                type="checkbox"
                checked={checked}
                ref={(el) => {
                  if (el) el.indeterminate = indeterminate;
                }}
                onChange={() => toggle(tag.id)}
                className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
              />
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">
                {count}/{total}
              </span>
            </label>
          );
        })}
        {visibleTags.length === 0 && (
          <p className="px-3 py-3 text-center text-xs text-[var(--text-tertiary)]">
            Sin resultados
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-[var(--border-color)] p-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--color-base-alt)]"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => onApply(addIds, removeIds)}
          disabled={changedCount === 0 || isPending}
          className="rounded-full bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-on-primary)] transition hover:brightness-110 disabled:opacity-50"
        >
          {isPending ? "Aplicando…" : `Aplicar${changedCount > 0 ? ` (${changedCount})` : ""}`}
        </button>
      </div>
    </div>
  );
}
