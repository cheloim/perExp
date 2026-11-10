import { useEffect, useRef, useState } from "react";
import {
  MAX_SAVED_VIEWS,
  MAX_VIEW_NAME,
  addSavedView,
  buildSavedView,
  persistSavedViews,
  readSavedViews,
  removeSavedView,
  type SavedView,
} from "../../utils/savedViews";

interface SavedViewsMenuProps {
  /** The filter set currently applied, serialized into the URL. */
  searchParams: URLSearchParams;
  onApply: (params: URLSearchParams) => void;
}

/**
 * Local-first named filter sets. The stored value is the same search string
 * the URL already uses, so applying one is just a navigation.
 */
export function SavedViewsMenu({ searchParams, onApply }: SavedViewsMenuProps) {
  const [views, setViews] = useState<SavedView[]>(readSavedViews);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = searchParams.toString();
  const atLimit = views.length >= MAX_SAVED_VIEWS;
  const canSave = current.length > 0 && name.trim().length > 0 && !atLimit;

  const save = () => {
    const view = buildSavedView(name, current);
    if (!view) {
      setError("Poné un nombre a la vista.");
      return;
    }
    const next = addSavedView(views, view);
    setViews(next);
    persistSavedViews(next);
    setName("");
    setError(null);
  };

  const apply = (view: SavedView) => {
    onApply(new URLSearchParams(view.params));
    setOpen(false);
  };

  const remove = (id: string) => {
    const next = removeSavedView(views, id);
    setViews(next);
    persistSavedViews(next);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Vistas guardadas"
        className="filter-control w-auto shrink-0 justify-center px-3"
      >
        <span className="flex items-center gap-1.5">
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
          >
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
          </svg>
          <span className="hidden sm:inline">Vistas</span>
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Vistas guardadas"
          className="absolute right-0 z-50 mt-1 w-[280px] rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)] p-3 shadow-gnome-lg"
        >
          {views.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)]">
              Todavía no guardaste ninguna vista.
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {views.map((view) => (
                <li key={view.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => apply(view)}
                    className="flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--color-base-alt)]"
                  >
                    {view.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(view.id)}
                    aria-label={`Eliminar vista ${view.name}`}
                    className="rounded px-1.5 py-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--color-base-alt)] hover:text-danger"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 border-t border-[var(--border-color)] pt-3">
            <label
              htmlFor="saved-view-name"
              className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]"
            >
              Guardar vista actual
            </label>
            <div className="flex gap-1.5">
              <input
                id="saved-view-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
                aria-label="Nombre de la vista"
                placeholder="Ej. Suscripciones"
                maxLength={MAX_VIEW_NAME}
                disabled={atLimit || current.length === 0}
                className="filter-input text-xs disabled:opacity-50"
              />
              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                className="gnome-btn-primary-strong min-h-0 shrink-0 px-2 py-1.5 text-xs disabled:opacity-40"
              >
                Guardar
              </button>
            </div>
            {atLimit && (
              <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                Máximo {MAX_SAVED_VIEWS} vistas. Borrá una para guardar otra.
              </p>
            )}
            {current.length === 0 && (
              <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                Aplicá algún filtro antes de guardar.
              </p>
            )}
            {error && <p className="mt-1 text-[10px] text-danger">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
