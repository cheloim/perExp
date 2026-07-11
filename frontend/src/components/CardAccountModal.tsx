import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCard, createAccount, getAccounts, getCards, updateCard } from "../api/client";
import type { Account } from "../types";
import { Select } from "./ui/Select";

const ACCOUNT_TYPES = [
  { value: "efectivo", label: "Efectivo" },
  { value: "cuenta_corriente", label: "Cta. Corriente" },
  { value: "caja_ahorro", label: "Caja de Ahorro" },
  { value: "mercadopago", label: "MercadoPago" },
  { value: "tarjeta", label: "Tarjeta" },
];

interface CardAccountModalProps {
  onClose: () => void;
}

export default function CardAccountModal({ onClose }: CardAccountModalProps) {
  const queryClient = useQueryClient();

  const [accountType, setAccountType] = useState("tarjeta");
  const [cardName, setCardName] = useState("");
  const [bank, setBank] = useState("");
  const [cardType, setCardType] = useState("credito");
  const [errors, setErrors] = useState<{ card_name?: string; bank?: string }>({});
  const [linkedAccountId, setLinkedAccountId] = useState<number | null>(null);
  const [linkedCardId, setLinkedCardId] = useState<number | null>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  });

  const { data: cards = [] } = useQuery({
    queryKey: ["cards"],
    queryFn: getCards,
  });

  // Available caja_ahorro accounts for linking to a new debit card
  const availableAccounts = accounts.filter((a) => a.type === "caja_ahorro" && !a.linked_card_id);

  // Available debit cards for linking to a new caja_ahorro account
  const availableDebitCards = cards.filter((c) => c.card_type === "debito" && !c.linked_account_id);

  const updateCardLinkMut = useMutation({
    mutationFn: ({ cardId, accountId }: { cardId: number; accountId: number | null }) =>
      updateCard(cardId, { linked_account_id: accountId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const createCardMut = useMutation({
    mutationFn: createCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      onClose();
    },
  });

  const createAccountMut = useMutation({
    mutationFn: (data: { name: string; type: string }) => createAccount(data),
    onSuccess: (created: Account) => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      // Link debit card if one was selected
      if (linkedCardId) {
        updateCardLinkMut.mutate({ cardId: linkedCardId, accountId: created.id });
      }
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: { card_name?: string; bank?: string } = {};
    if (accountType === "tarjeta") {
      if (!cardName.trim()) newErrors.card_name = "El nombre de la tarjeta es obligatorio";
      if (!bank.trim()) newErrors.bank = "El banco es obligatorio";
    } else {
      if (!cardName.trim()) newErrors.card_name = "El nombre es obligatorio";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (accountType === "tarjeta") {
      createCardMut.mutate({
        card_name: cardName.trim(),
        bank: bank.trim(),
        card_type: cardType,
        linked_account_id: cardType === "debito" ? linkedAccountId : null,
      });
    } else {
      createAccountMut.mutate({ name: cardName.trim(), type: accountType });
    }
  };

  const pending = createCardMut.isPending || createAccountMut.isPending;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-modal-backdrop bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative card w-full max-w-sm max-h-[90vh] overflow-auto p-6 space-y-4 animate-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Crear tarjeta o cuenta
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--color-primary)]"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              Tipo de cuenta
            </label>
            <Select
              value={accountType}
              onChange={setAccountType}
              options={ACCOUNT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </div>

          {accountType === "tarjeta" && (
            <div className="space-y-3 pt-2 border-t border-[var(--border-color)]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  Crédito / Débito
                </label>
                <Select
                  value={cardType}
                  onChange={(v) => {
                    setCardType(v);
                    if (v !== "debito") setLinkedAccountId(null);
                  }}
                  options={[
                    { value: "credito", label: "Crédito" },
                    { value: "debito", label: "Débito" },
                  ]}
                />
              </div>
              {cardType === "debito" && availableAccounts.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">
                    Vincular a cuenta
                  </label>
                  <Select
                    value={String(linkedAccountId || "")}
                    onChange={(v) => setLinkedAccountId(v ? Number(v) : null)}
                    options={[
                      { value: "", label: "Sin vinculación" },
                      ...availableAccounts.map((a) => ({
                        value: String(a.id),
                        label: a.name,
                      })),
                    ]}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Banco</label>
                <input
                  type="text"
                  value={bank}
                  onChange={(e) => {
                    setBank(e.target.value);
                    setErrors((prev) => ({ ...prev, bank: undefined }));
                  }}
                  className={`w-full px-3 py-2 rounded-md border text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 transition ${
                    errors.bank
                      ? "border-red-500 focus:ring-red-300 focus:border-red-500"
                      : "border-[var(--border-color)] focus:border-primary"
                  }`}
                  placeholder="Ej: Galicia"
                />
                {errors.bank && <p className="text-xs text-red-500">{errors.bank}</p>}
              </div>
            </div>
          )}

          {accountType === "caja_ahorro" && availableDebitCards.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-[var(--border-color)]">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                Vincular tarjeta débito
              </label>
              <Select
                value={String(linkedCardId || "")}
                onChange={(v) => setLinkedCardId(v ? Number(v) : null)}
                options={[
                  { value: "", label: "Sin vinculación" },
                  ...availableDebitCards.map((c) => ({
                    value: String(c.id),
                    label: `${c.card_name} (${c.bank})`,
                  })),
                ]}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Tarjeta</label>
            <input
              type="text"
              value={cardName}
              onChange={(e) => {
                setCardName(e.target.value);
                setErrors((prev) => ({ ...prev, card_name: undefined }));
              }}
              className={`w-full px-3 py-2 rounded-md border text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 transition ${
                errors.card_name
                  ? "border-red-500 focus:ring-red-300 focus:border-red-500"
                  : "border-[var(--border-color)] focus:border-primary"
              }`}
              placeholder={accountType === "tarjeta" ? "Ej: Visa Galicia" : "Ej: Mi Cuenta"}
              autoFocus
            />
            {errors.card_name && <p className="text-xs text-red-500">{errors.card_name}</p>}
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={pending}
              className="flex-1 px-4 py-2 rounded-md bg-[var(--color-primary)] text-[var(--color-on-primary)] text-sm font-medium hover:brightness-110 disabled:opacity-60 transition"
            >
              {pending ? "Creando..." : "Crear"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
