import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";

interface SpeedDialProps {
  isInvestments: boolean;
  aiDrawerOpen: boolean;
  newExpenseOpen: boolean;
  onOpenAI: () => void;
  onOpenNewExpense: () => void;
}

/**
 * FABs and Speed Dial — Adwaita floating action buttons
 * GNOME HIG: ".suggested-action highlights a button for affirmative action"
 * GNOME HIG: ".circular" style for icon-only floating buttons
 *
 * Desktop: always show two separate FABs (AI + New Expense)
 * Mobile: always use speed-dial pattern (consistent behavior across all pages)
 */
export default function SpeedDial({
  isInvestments,
  aiDrawerOpen,
  newExpenseOpen,
  onOpenAI,
  onOpenNewExpense,
}: SpeedDialProps) {
  if (isInvestments) return null;

  return (
    <>
      {/* ── Desktop FABs: always two separate buttons ── */}
      {!aiDrawerOpen && (
        <button
          onClick={onOpenAI}
          aria-label="Abrir asistente IA"
          className="fixed bottom-6 right-4 md:right-6 z-50 hidden md:flex items-center justify-center w-11 h-11 bg-primary hover:brightness-110 text-white rounded-md shadow-gnome hover:shadow-gnome-lg scale-100 hover:scale-105 transition-all duration-150"
          title="Abrir asistente IA"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 2l2.5 5 5.5.8-4 3.9.95 5.5L10 14.75l-4.95 2.45.95-5.5-4-3.9 5.5-.8L10 2z"
              fill="currentColor"
            />
          </svg>
        </button>
      )}
      {!newExpenseOpen && (
        <button
          onClick={onOpenNewExpense}
          aria-label="Nuevo gasto"
          className="fixed bottom-6 right-4 md:right-20 z-50 hidden md:flex items-center justify-center w-11 h-11 bg-primary hover:brightness-110 text-white rounded-full shadow-gnome hover:shadow-gnome-lg scale-100 hover:scale-105 transition-all duration-150"
          title="Nuevo gasto"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 4v12M4 10h12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}

      {/* ── Mobile FAB: speed-dial pattern (consistent on all pages) ── */}
      {!newExpenseOpen && !aiDrawerOpen && (
        <MobileSpeedDial onOpenAI={onOpenAI} onOpenNewExpense={onOpenNewExpense} />
      )}
    </>
  );
}

/**
 * Mobile speed-dial — consistent behavior on all pages
 * GNOME HIG: "Each view should only ever include a single button using
 * either the suggested or destructive styles"
 */
function MobileSpeedDial({
  onOpenAI,
  onOpenNewExpense,
}: {
  onOpenAI: () => void;
  onOpenNewExpense: () => void;
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close on navigation
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="md:hidden">
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <button
            onClick={() => {
              setOpen(false);
              onOpenNewExpense();
            }}
            aria-label="Nuevo gasto"
            className="fixed bottom-[calc(6.5rem+var(--browser-bottom-inset,0px))] right-4 z-50 flex items-center gap-2 bg-primary text-white text-sm font-medium px-3 py-2.5 rounded-lg shadow-gnome hover:shadow-gnome-lg transition-all duration-150 scale-100 hover:scale-105"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M10 4v12M4 10h12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Nuevo gasto
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onOpenAI();
            }}
            aria-label="Abrir asistente IA"
            className="fixed bottom-[calc(4rem+var(--browser-bottom-inset,0px))] right-4 z-50 flex items-center gap-2 bg-primary text-white text-sm font-medium px-3 py-2.5 rounded-lg shadow-gnome hover:shadow-gnome-lg transition-all duration-150 scale-100 hover:scale-105"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M10 2l2.5 5 5.5.8-4 3.9.95 5.5L10 14.75l-4.95 2.45.95-5.5-4-3.9 5.5-.8L10 2z"
                fill="currentColor"
              />
            </svg>
            Asistente IA
          </button>
        </>
      )}
      <button
        onClick={() => setOpen(!open)}
        aria-label={open ? "Cerrar menú" : "Abrir menú de acciones"}
        aria-expanded={open}
        className="fixed bottom-[calc(3.5rem+var(--browser-bottom-inset,0px))] right-4 z-50 flex items-center justify-center w-11 h-11 bg-primary hover:brightness-110 text-white rounded-full shadow-gnome hover:shadow-gnome-lg scale-100 hover:scale-105 transition-all duration-150"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className={`transition-transform duration-200 ${open ? "rotate-45" : ""}`}
        >
          <path
            d="M10 4v12M4 10h12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
