import { useState } from "react";
import type { Session } from "./types";

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

export function SessionCard({
  session,
  expanded,
  onToggle,
  onDelete,
}: {
  session: Session;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const userMsgs = session.messages.filter((m) => m.role === "user");
  const preview = userMsgs[0]?.text ?? "(sin mensajes)";
  const dateStr = new Date(session.ts).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  return (
    <div
      className={`rounded-md border overflow-hidden relative ${
        expanded
          ? "border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5"
          : "border-[var(--border-color)] bg-[var(--color-base-alt)]"
      }`}
    >
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[var(--color-base-alt)]/80 transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0 pr-8">
          <p className="text-sm text-[var(--text-primary)] truncate">{preview}</p>
          <p className="text-xs text-[var(--text-tertiary)]">
            {dateStr} · {userMsgs.length} preguntas
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteConfirm(true);
            }}
            className="text-[var(--text-tertiary)] hover:text-[var(--color-danger)] text-sm transition-colors"
          >
            <TrashIcon />
          </button>
          <span className="text-[var(--text-tertiary)] text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-[var(--border-color)] bg-[var(--color-surface)]">
          {session.summary && (
            <div className="px-3 py-2 bg-[var(--color-primary)]/8 border-b border-[var(--border-color)]">
              <p className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-1">
                Resumen
              </p>
              <p className="text-xs text-[var(--text-primary)] leading-relaxed">
                {session.summary}
              </p>
            </div>
          )}
          <div className="px-3 py-2 space-y-2 overflow-y-auto flex-1 min-h-0">
            {session.messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] px-2.5 py-2 rounded-md text-xs leading-normal whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-[var(--color-primary)] text-white"
                      : "bg-[var(--color-base-alt)] text-[var(--text-primary)]"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>
          {deleteConfirm && (
            <div className="px-3 py-2 border-t border-[var(--border-color)] flex items-center gap-2">
              <span className="text-xs text-[var(--text-secondary)]">¿Eliminar?</span>
              <button
                onClick={() => {
                  onDelete();
                  setDeleteConfirm(false);
                }}
                className="text-xs px-2 py-1 rounded bg-danger text-white"
              >
                Eliminar
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="text-xs px-2 py-1 rounded bg-[var(--color-base-alt)] text-secondary"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
