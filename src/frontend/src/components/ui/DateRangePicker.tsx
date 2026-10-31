import { useEffect, useRef, useState } from "react";
import { DayPicker, type DateRange as DayPickerRange } from "react-day-picker";
import { es } from "date-fns/locale";
import { formatDateDMY } from "../../utils/format";
import {
  DATE_RANGE_PRESETS,
  parseDateRangePreset,
  presetLabel,
  toISODate,
  type DateRangePreset,
} from "../../utils/dateRange";
import "react-day-picker/style.css";

export interface DateRangeValue {
  preset?: DateRangePreset;
  from?: string;
  to?: string;
}

interface DateRangePickerProps {
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  /** `month=YYYY-MM` arriving from the category dashboard. */
  month?: string;
  onChange: (range: DateRangeValue) => void;
}

function parseISOValue(value?: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function monthLabel(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);
  if (!year || !monthIndex) return month;
  return new Date(year, monthIndex - 1, 1).toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
  });
}

function rangeLabel({
  preset,
  from,
  to,
  month,
}: Pick<DateRangePickerProps, "preset" | "from" | "to" | "month">): string {
  if (preset) return presetLabel(preset);
  if (month) return monthLabel(month);
  if (!from && !to) return "Fecha";
  if (from && to) return `${formatDateDMY(from)} – ${formatDateDMY(to)}`;
  return from ? `Desde ${formatDateDMY(from)}` : `Hasta ${formatDateDMY(to!)}`;
}

/**
 * Grafana-style quick ranges plus a custom calendar.
 *
 * Presets are calendar-month aligned and stay relative (“3m” is still the last
 * three months tomorrow); the custom picker writes concrete dates.
 */
export function DateRangePicker({ preset, from, to, month, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState<{ from?: string; to?: string }>({ from, to });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const openPicker = () => {
    setDraft({ from, to });
    setCustom(Boolean(from || to) && !preset && !month);
    setOpen(true);
  };

  const pickPreset = (next: string) => {
    const resolved = parseDateRangePreset(next);
    if (!resolved) return;
    onChange({ preset: resolved });
    setOpen(false);
  };

  const applyCustom = () => {
    if (!draft.from && !draft.to) return;
    onChange({ from: draft.from, to: draft.to });
    setOpen(false);
  };

  const handleRange = (range: DayPickerRange | undefined) => {
    setDraft({
      from: range?.from ? toISODate(range.from) : undefined,
      to: range?.to ? toISODate(range.to) : undefined,
    });
  };

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full text-left text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition flex items-center justify-between gap-2 hover:border-[var(--color-primary)]"
      >
        <span
          className={`truncate ${!preset && !from && !to && !month ? "text-[var(--text-tertiary)]" : ""}`}
        >
          {rangeLabel({ preset, from, to, month })}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="flex-shrink-0 text-[var(--text-secondary)]"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Rango de fechas"
          className="absolute left-0 z-50 mt-1 w-[calc(100vw-2rem)] max-w-[340px] rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)] p-3 shadow-gnome-lg"
        >
          <div role="group" aria-label="Rangos rápidos" className="grid grid-cols-3 gap-1.5">
            {DATE_RANGE_PRESETS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => pickPreset(option)}
                aria-pressed={preset === option}
                className={`text-xs px-2 py-1.5 rounded-md border transition-colors ${
                  preset === option
                    ? "border-[var(--color-primary)] bg-[var(--color-primary-strong)]/15 text-[var(--accent-color)] font-medium"
                    : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
                }`}
              >
                {option}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustom(true)}
              aria-pressed={custom}
              className={`text-xs px-2 py-1.5 rounded-md border transition-colors ${
                custom
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-strong)]/15 text-[var(--accent-color)] font-medium"
                  : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
              }`}
            >
              Custom
            </button>
          </div>

          {custom && (
            <div className="mt-3 border-t border-[var(--border-color)] pt-2">
              <DayPicker
                mode="range"
                selected={{
                  from: parseISOValue(draft.from),
                  to: parseISOValue(draft.to),
                }}
                onSelect={handleRange}
                numberOfMonths={1}
                locale={es}
                weekStartsOn={1}
                className="text-[var(--text-primary)]"
              />
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-[var(--border-color)] pt-2">
            <button
              type="button"
              onClick={() => {
                onChange({});
                setOpen(false);
              }}
              className="text-xs px-2 py-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition-colors"
            >
              Limpiar
            </button>
            <button
              type="button"
              onClick={applyCustom}
              disabled={!draft.from && !draft.to}
              className="gnome-btn-primary text-xs disabled:opacity-40"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
