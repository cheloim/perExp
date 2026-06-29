import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createCard, createAccount } from "../api/client";
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

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const createCardMut = useMutation({
    mutationFn: createCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      onClose();
    },
  });

  const createAccountMut = useMutation({
    mutationFn: (data: { name: string; type: string }) => createAccount(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
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
      });
    } else {
      createAccountMut.mutate({ name: cardName.trim(), type: accountType });
    }
  };

  const pending = createCardMut.isPending || createAccountMut.isPending;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-modal-backdrop">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative card w-full max-w-sm max-h-[90vh] overflow-auto p-6 space-y-4 animate-modal-content">
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
                  onChange={setCardType}
                  options={[
                    { value: "credito", label: "Crédito" },
                    { value: "debito", label: "Débito" },
                  ]}
                />
              </div>
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
