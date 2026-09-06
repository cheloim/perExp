import { useState, useEffect, Suspense, lazy } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExpenseModal } from "../components/ExpenseModals";
import { createExpense } from "../api/client";
import { hapticLight, hideBackButton } from "../services/telegramWebApp";
import type { ExpenseCreate } from "../types";

type Tab = "summary" | "budget" | "upcoming";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "summary", label: "Resumen", icon: "🏠" },
  { id: "budget", label: "Presupuesto", icon: "📊" },
  { id: "upcoming", label: "Próximos", icon: "📅" },
];

const QuickSummary = lazy(() => import("../pages/quick/QuickSummary"));
const QuickBudget = lazy(() => import("../pages/quick/QuickBudget"));
const QuickUpcoming = lazy(() => import("../pages/quick/QuickUpcoming"));

function TabContent({ tab }: { tab: Tab }) {
  switch (tab) {
    case "summary":
      return <QuickSummary />;
    case "budget":
      return <QuickBudget />;
    case "upcoming":
      return <QuickUpcoming />;
  }
}

export default function QuickViewLayout({ onSwitchToFull }: { onSwitchToFull: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>("summary");
  const [newExpenseOpen, setNewExpenseOpen] = useState(false);
  const queryClient = useQueryClient();

  const createMut = useMutation({
    mutationFn: (data: ExpenseCreate) => createExpense(data),
    onSuccess: () => {
      setNewExpenseOpen(false);
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  useEffect(() => {
    hideBackButton();
  }, []);

  const handleTabChange = (tab: Tab) => {
    hapticLight();
    setActiveTab(tab);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--color-base)]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[var(--color-base)] border-b border-[var(--border-color)]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white text-sm font-bold">
              N
            </div>
            <span className="text-sm font-semibold text-[var(--text-primary)]">Oikonomia</span>
          </div>
          <button
            onClick={onSwitchToFull}
            className="text-xs font-medium px-3 py-1.5 rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition-colors"
          >
            Plataforma completa
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-safe">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20 text-[var(--text-secondary)] text-sm">
              Cargando...
            </div>
          }
        >
          <TabContent tab={activeTab} />
        </Suspense>
      </main>

      {/* FAB */}
      <button
        onClick={() => setNewExpenseOpen(true)}
        className="fixed bottom-20 right-4 z-50 w-14 h-14 rounded-full bg-[var(--color-primary)] text-white shadow-lg flex items-center justify-center text-2xl font-light active:scale-95 transition-transform"
        aria-label="Agregar gasto"
      >
        +
      </button>

      {/* Bottom pills */}
      <nav className="sticky bottom-0 z-40 bg-[var(--color-base)] border-t border-[var(--border-color)] pb-safe">
        <div className="flex items-center justify-around px-2 py-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
              }`}
            >
              <span className="text-base">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Expense modal */}
      {newExpenseOpen && (
        <ExpenseModal
          onClose={() => setNewExpenseOpen(false)}
          onSave={(data) => createMut.mutate(data)}
          saveError={createMut.error?.message ?? null}
          isSaving={createMut.isPending}
        />
      )}
    </div>
  );
}
