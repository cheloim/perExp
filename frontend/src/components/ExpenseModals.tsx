import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCategories, getAccounts, getCards, createCategory } from "../api/client";
import type { Expense, ExpenseCreate, Card } from "../types";
import { Select } from "./ui/Select";
import CardAccountModal from "./CardAccountModal";
import { useFocusTrap } from "../hooks/useFocusTrap";

// Helper function to get today's date in DD-MM-YYYY format
export function todayDDMMYYYY() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const y = now.getFullYear();
  return `${d}-${m}-${y}`;
}

// Cache last used payment info for quick repeat
function getLastUsedPayment(): {
  card_id: number | null;
  account_id: number | null;
  payMethod: "card" | "cash";
} {
  try {
    const data = JSON.parse(localStorage.getItem("expense_last_payment") || "{}");
    return {
      card_id: data.card_id || null,
      account_id: data.account_id || null,
      payMethod: data.payMethod || "card",
    };
  } catch {
    return { card_id: null, account_id: null, payMethod: "card" };
  }
}

// Empty form template
export const EMPTY_FORM: ExpenseCreate = {
  date: todayDDMMYYYY(),
  description: "",
  amount: 0,
  currency: "ARS",
  category_id: null,
  notes: "",
  transaction_id: "",
  installment_number: null,
  installment_total: null,
  installment_group_id: null,
  account_id: null,
  card_id: null,
};

// DatePicker component with calendar

// ExpenseModal - Full modal for expense transactions with payment method selector
interface ExpenseModalProps {
  initial?: Expense | null;
  onClose: () => void;
  onSave: (data: ExpenseCreate) => void;
  saveError?: string | null;
  isSaving?: boolean;
  mode?: "installments-only";
}

export function ExpenseModal({
  initial,
  onClose,
  onSave,
  saveError,
  isSaving,
  mode,
}: ExpenseModalProps) {
  const queryClient = useQueryClient();
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: getCategories });
  const { data: cards = [] } = useQuery({ queryKey: ["cards"], queryFn: getCards });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const isCash = (cardId: number | null | undefined) => !cardId;
  const lastPayment = getLastUsedPayment();
  const isInstallmentsOnly = mode === "installments-only";

  const [payMethod, setPayMethod] = useState<"card" | "cash">(
    isInstallmentsOnly
      ? "card"
      : initial
        ? isCash(initial.card_id)
          ? "cash"
          : "card"
        : lastPayment.payMethod,
  );
  const [showCardModal, setShowCardModal] = useState(false);

  const [form, setForm] = useState<ExpenseCreate>(() => {
    if (initial) {
      return {
        date: initial.date,
        description: initial.description,
        amount: Math.abs(initial.amount),
        currency: initial.currency || "ARS",
        category_id: initial.category_id,
        notes: initial.notes ?? "",
        transaction_id: initial.transaction_id ?? "",
        installment_number: initial.installment_number ?? null,
        installment_total: initial.installment_total ?? null,
        installment_group_id: initial.installment_group_id ?? null,
        account_id: initial.account_id ?? null,
        card_id: initial.card_id ?? null,
      };
    }
    const last = getLastUsedPayment();
    return { ...EMPTY_FORM, ...last };
  });

  const [cuotasEnabled, setCuotasEnabled] = useState(
    isInstallmentsOnly || !!(initial?.installment_total && initial.installment_total > 1),
  );

  // Generate installment group ID on mount for installments-only mode
  useEffect(() => {
    if (isInstallmentsOnly && !form.installment_group_id) {
      setForm((prev) => ({
        ...prev,
        installment_group_id: crypto.randomUUID(),
        installment_number: prev.installment_number ?? 1,
        installment_total: prev.installment_total ?? 1,
      }));
    }
  }, [isInstallmentsOnly, form.installment_group_id]);

  const isValid =
    form.description.trim().length > 0 && form.amount > 0 && form.date.trim().length > 0;

  const toggleCuotas = (enabled: boolean) => {
    setCuotasEnabled(enabled);
    if (enabled) {
      const gid = form.installment_group_id || crypto.randomUUID();
      setForm((prev) => ({
        ...prev,
        installment_number: 1,
        installment_total: 1,
        installment_group_id: gid,
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        installment_number: null,
        installment_total: null,
        installment_group_id: null,
      }));
    }
  };

  const set = (field: keyof ExpenseCreate, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const switchPayMethod = (method: "card" | "cash") => {
    setPayMethod(method);
    if (method === "cash") {
      setForm((prev) => ({ ...prev, card_id: null, account_id: null }));
    } else {
      setForm((prev) => ({ ...prev, account_id: null }));
    }
  };

  // Cascading selectors: bank → card
  const availableBanks = [...new Set(cards.map((c) => c.bank).filter(Boolean))].sort();

  const selectedCard = cards.find((c) => c.id === form.card_id);
  const selectedBank = selectedCard?.bank ?? "";
  const availableCards = cards.filter((c) => !selectedBank || c.bank === selectedBank);

  const handleBankChange = (_b: string) => {
    setForm((prev) => ({ ...prev, card_id: null }));
  };

  const handleCardSelect = (c: Card) => {
    setForm((prev) => ({
      ...prev,
      card_id: c.id,
    }));
  };

  const trapRef = useFocusTrap(true);

  const [showAdvanced, setShowAdvanced] = useState(
    !!initial?.notes || !!(initial?.installment_total && initial.installment_total > 1),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-backdrop bg-black/60"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={initial ? "Editar gasto" : "Nuevo gasto"}
        className="relative card w-full max-w-md max-h-[90vh] overflow-auto p-5 space-y-2.5 animate-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {initial ? "Editar gasto" : "Nuevo gasto"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="text-[var(--text-tertiary)] hover:text-[var(--color-primary)]"
          >
            ✕
          </button>
        </div>

        {!initial && cards.length === 0 && accounts.length === 0 && (
          <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 text-xs text-warning">
            <span className="mt-0.5">⚠</span>
            <div className="flex-1">
              <p>No tenés tarjetas ni cuentas creadas. Creá una para registrar gastos.</p>
              <button
                onClick={() => setShowCardModal(true)}
                className="mt-1 text-xs font-semibold underline hover:no-underline"
              >
                Crear tarjeta o cuenta
              </button>
            </div>
          </div>
        )}

        {saveError && (
          <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger">
            <span className="mt-0.5">✕</span>
            <span>{saveError}</span>
          </div>
        )}

        {/* Payment method toggle */}
        {!isInstallmentsOnly && (
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
              Medio de pago
            </label>
            <div className="flex rounded-md border border-[var(--border-color)] overflow-hidden">
              <button
                type="button"
                onClick={() => switchPayMethod("card")}
                className={`flex-1 px-3 py-1.5 text-sm font-medium transition ${
                  payMethod === "card"
                    ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                    : "bg-[var(--color-base-container)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
                }`}
              >
                💳 Tarjeta
              </button>
              <button
                type="button"
                onClick={() => switchPayMethod("cash")}
                className={`flex-1 px-3 py-1.5 text-sm font-medium transition ${
                  payMethod === "cash"
                    ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                    : "bg-[var(--color-base-container)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
                }`}
              >
                💵 Efectivo / Transferencia
              </button>
            </div>
          </div>
        )}

        {/* Fecha */}
        <div>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Fecha <span className="text-danger">*</span>
          </label>
          <input
            type="date"
            value={(() => {
              // Convert DD-MM-YYYY to YYYY-MM-DD for native date input
              const parts = form.date.split("-");
              if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
              return form.date;
            })()}
            onChange={(e) => {
              // Convert YYYY-MM-DD back to DD-MM-YYYY
              const parts = e.target.value.split("-");
              if (parts.length === 3) set("date", `${parts[2]}-${parts[1]}-${parts[0]}`);
              else set("date", e.target.value);
            }}
            className="w-full px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
          />
        </div>

        {/* Monto + Moneda */}
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              Monto <span className="text-danger">*</span>
            </label>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => set("amount", parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)]">Moneda</label>
            <Select
              value={form.currency ?? "ARS"}
              onChange={(v) => set("currency", v)}
              options={[
                { value: "ARS", label: "ARS $" },
                { value: "USD", label: "USD $" },
              ]}
            />
          </div>
        </div>

        {/* Descripción + Categoría */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              Descripción <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Ej: Supermercado Coto"
              className="w-full px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)]">Categoría</label>
            <Select
              value={form.category_id ? String(form.category_id) : ""}
              onChange={async (v) => {
                if (!v) {
                  set("category_id", null);
                  return;
                }
                const parsed = parseInt(v);
                if (!isNaN(parsed)) {
                  set("category_id", parsed);
                } else {
                  try {
                    const newCat = await createCategory({
                      name: v,
                      color: "#6366f1",
                      keywords: "",
                      parent_id: null,
                    });
                    queryClient.invalidateQueries({ queryKey: ["categories"] });
                    set("category_id", newCat.id);
                  } catch {
                    // Duplicate name or other error
                  }
                }
              }}
              groups={(() => {
                const parentIds = new Set(
                  categories.filter((c) => c.parent_id).map((c) => c.parent_id!),
                );
                const parents = categories.filter((c) => !c.parent_id && parentIds.has(c.id));
                const orphans = categories.filter((c) => !c.parent_id && !parentIds.has(c.id));
                return [
                  ...parents.map((parent) => ({
                    label: parent.name,
                    options: categories
                      .filter((c) => c.parent_id === parent.id)
                      .map((c) => ({ value: String(c.id), label: c.name })),
                  })),
                  ...(orphans.length > 0
                    ? [
                        {
                          label: "—",
                          options: orphans.map((c) => ({ value: String(c.id), label: c.name })),
                        },
                      ]
                    : []),
                ];
              })()}
              placeholder="Sin categoría"
            />
          </div>
        </div>

        {/* Banco → Tarjeta */}
        <div
          className={`transition-opacity ${
            payMethod === "cash" ? "opacity-40 pointer-events-none" : ""
          }`}
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)]">Banco</label>
              <Select
                value={selectedBank}
                onChange={(v) => handleBankChange(v)}
                options={availableBanks.map((b) => ({ value: b, label: b }))}
                placeholder="— Banco —"
                disabled={payMethod === "cash"}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)]">Tarjeta</label>
              <Select
                value={String(form.card_id || "")}
                onChange={(v) => {
                  const selected = availableCards.find((c) => String(c.id) === v);
                  if (selected) handleCardSelect(selected);
                }}
                options={availableCards.map((c) => ({ value: String(c.id), label: c.card_name }))}
                placeholder="— Tarjeta —"
                disabled={payMethod === "cash"}
              />
            </div>
          </div>
        </div>

        {/* Account selector for cash/transfer */}
        <div className={`${payMethod === "card" ? "opacity-40 pointer-events-none" : ""}`}>
          {payMethod === "cash" && accounts.filter((a) => a.type !== "credito").length === 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 mb-2">
              <span className="mt-0.5">⚠️</span>
              <div className="flex-1">
                <p>No tenés cuentas creadas para efectivo/transferencia.</p>
                <button
                  onClick={() => setShowCardModal(true)}
                  className="mt-1 text-xs font-semibold underline hover:text-amber-800"
                >
                  Crear cuenta
                </button>
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              Cuenta de origen
            </label>
            <Select
              value={String(form.account_id || "")}
              onChange={(v) => set("account_id", v ? Number(v) : null)}
              options={accounts
                .filter((a) => a.type !== "credito")
                .map((a) => ({
                  value: String(a.id),
                  label: a.name,
                }))}
              placeholder="Seleccionar cuenta"
              disabled={payMethod === "card"}
            />
          </div>
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--color-primary)] transition flex items-center gap-1"
        >
          <span>{showAdvanced ? "▾" : "▸"}</span>
          Más opciones
        </button>

        {/* Advanced section: Cuotas + Notas */}
        {showAdvanced && (
          <div className="space-y-2.5 pt-1 border-t border-[var(--border-color)]">
            {payMethod === "card" && (
              <div className="border border-[var(--border-color)] rounded-md p-2.5 space-y-2">
                {!isInstallmentsOnly && (
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cuotasEnabled}
                      onChange={(e) => toggleCuotas(e.target.checked)}
                      className="accent-[var(--color-primary)]"
                    />
                    <span className="text-sm font-medium text-[var(--text-secondary)]">
                      Compra en cuotas
                    </span>
                  </label>
                )}
                {(cuotasEnabled || isInstallmentsOnly) && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="text-xs font-medium text-[var(--text-secondary)]">
                        Cuota N°
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={form.installment_number ?? 1}
                        onChange={(e) => set("installment_number", parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition text-center"
                      />
                    </div>
                    <span className="text-[var(--text-tertiary)] mt-4">de</span>
                    <div className="flex-1">
                      <label className="text-xs font-medium text-[var(--text-secondary)]">
                        Total cuotas
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={form.installment_total ?? 1}
                        onChange={(e) => set("installment_total", parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition text-center"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)]">Notas</label>
              <textarea
                value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
                className="w-full px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition resize-none"
                rows={1}
              />
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              if (!initial) {
                localStorage.setItem(
                  "expense_last_payment",
                  JSON.stringify({
                    card_id: form.card_id,
                    account_id: form.account_id,
                    payMethod,
                  }),
                );
              }
              onSave({ ...form, amount: Math.abs(form.amount) });
            }}
            disabled={!isValid || isSaving}
            className="flex-1 px-4 py-2 rounded-md bg-[var(--color-primary)] text-white text-sm font-medium hover:brightness-110 disabled:opacity-60 transition"
          >
            {isSaving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
      {showCardModal && <CardAccountModal onClose={() => setShowCardModal(false)} />}
    </div>
  );
}
