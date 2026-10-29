interface BulkActionBarProps {
  count: number;
  summary: string;
  pending: boolean;
  onCategory: (rect: DOMRect) => void;
  onCuenta: (rect: DOMRect) => void;
  onTags: (rect: DOMRect) => void;
  onExport: () => void;
  onDelete: () => void;
  onClear: () => void;
}

/**
 * Non-blocking selection toolbar.
 *
 * It floats above the content instead of dimming it: the list stays visible,
 * scrollable and clickable while the user keeps selecting rows. On mobile it
 * sits above the bottom nav and the speed-dial button, so neither is covered.
 */
export default function BulkActionBar({
  count,
  summary,
  pending,
  onCategory,
  onCuenta,
  onTags,
  onExport,
  onDelete,
  onClear,
}: BulkActionBarProps) {
  const fromEvent = (fn: (rect: DOMRect) => void) => (e: React.MouseEvent<HTMLButtonElement>) =>
    fn(e.currentTarget.getBoundingClientRect());

  return (
    <div
      role="region"
      aria-label="Acciones para los gastos seleccionados"
      className="fixed inset-x-0 bottom-[calc(7rem+var(--browser-bottom-inset,0px))] z-40 px-2 md:inset-x-auto md:bottom-6 md:left-1/2 md:-translate-x-1/2 md:px-0"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)] px-3 py-2 shadow-gnome-lg md:w-auto md:max-w-none md:flex-row md:items-center md:gap-4 md:rounded-full md:py-1.5 md:pr-2 md:pl-4">
        <div className="flex min-w-0 items-center justify-between gap-3 md:justify-start">
          <div className="min-w-0" role="status">
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {count} gasto{count !== 1 ? "s" : ""} seleccionado{count !== 1 ? "s" : ""}
            </p>
            <p className="truncate text-xs text-[var(--text-tertiary)]">{summary}</p>
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label="Limpiar selección"
            title="Limpiar selección (Esc)"
            className="shrink-0 rounded-md p-1.5 text-[var(--text-tertiary)] transition hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)] md:order-last"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M2 2l8 8M10 2l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none md:ml-auto md:overflow-visible">
          <button
            type="button"
            onClick={fromEvent(onCategory)}
            disabled={pending}
            className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-base-alt)] disabled:opacity-50"
          >
            Categoría
          </button>
          <button
            type="button"
            onClick={fromEvent(onCuenta)}
            disabled={pending}
            className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-base-alt)] disabled:opacity-50"
          >
            Cuenta
          </button>
          <button
            type="button"
            onClick={fromEvent(onTags)}
            disabled={pending}
            className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-base-alt)] disabled:opacity-50"
          >
            Etiquetas
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={pending}
            className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-base-alt)] disabled:opacity-50"
          >
            Exportar
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-[var(--color-danger,#e01b24)] transition hover:bg-[var(--color-danger,#e01b24)]/10 disabled:opacity-50"
          >
            Eliminar
          </button>
          {pending && (
            <span className="shrink-0 px-2 text-xs text-[var(--text-tertiary)]">Aplicando…</span>
          )}
        </div>
      </div>
    </div>
  );
}
