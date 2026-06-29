import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCards,
  createCard,
  updateCard,
  deleteCard,
  createAccount,
  getCardSummary,
  getMe,
} from "../api/client";
import { useQuery as useCardDataQuery } from "@tanstack/react-query";
import type { Card } from "../types";
import { Select } from "./ui/Select";
import { Skeleton, SkeletonList } from "./ui/Skeleton";

const getFirstName = (fullName: string): string => {
  if (fullName.includes(",")) {
    return fullName.split(",")[1].trim().split(" ")[0];
  }
  return fullName.split(" ")[0];
};

const ACCOUNT_TYPES = [
  { value: "efectivo", label: "Efectivo" },
  { value: "cuenta_corriente", label: "Cta. Corriente" },
  { value: "caja_ahorro", label: "Caja de Ahorro" },
  { value: "mercadopago", label: "MercadoPago" },
  { value: "tarjeta", label: "Tarjeta" },
];

export default function CardsManager() {
  const queryClient = useQueryClient();
  const [editId, setEditId] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "card" | "account";
    id: number;
    name: string;
  } | null>(null);
  const [duplicateFound, setDuplicateFound] = useState<{
    id: number;
    card_name: string;
    bank: string;
    card_type: string;
  } | null>(null);
  const [errors, setErrors] = useState<{ card_name?: string; bank?: string }>({});
  const [cardName, setCardName] = useState("");
  const [bank, setBank] = useState("");
  const [holder, setHolder] = useState("");
  const [cardType, setCardType] = useState("credito");
  const [accountType, setAccountType] = useState("efectivo");

  const { data: cards = [], isLoading } = useQuery({
    queryKey: ["cards"],
    queryFn: getCards,
  });

  const { data: currentUser } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
  });

  // Card data from expenses (for future extension - show spending by card)
  useCardDataQuery({
    queryKey: ["card-summary"],
    queryFn: getCardSummary,
    enabled: false, // Disabled for now - can be enabled for future features
  });

  const createMut = useMutation({
    mutationFn: createCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      setEditId(null);
      setCardName("");
      setBank("");
      setHolder("");
      setCardType("credito");
    },
    onError: (error: { response?: { status?: number; data?: { detail?: string } } }) => {
      if (error.response?.status === 409) {
        const detail = error.response.data?.detail;
        setDuplicateFound({
          id: (detail as unknown as { existing_id: number })?.existing_id ?? 0,
          card_name:
            (detail as unknown as { existing_card_name?: string })?.existing_card_name ?? "",
          bank: (detail as unknown as { existing_bank?: string })?.existing_bank ?? "",
          card_type:
            (detail as unknown as { existing_card_type?: string })?.existing_card_type ?? "credito",
        });
      }
    },
  });

  const updateMut = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: { card_name?: string; bank?: string; card_type?: string; closing_day?: number | null };
    }) => updateCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      setEditId(null);
      setCardName("");
      setBank("");
      setHolder("");
      setCardType("credito");
    },
  });

  const deleteMut = useMutation({
    mutationFn: deleteCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      setMenuOpen(null);
    },
  });

  const createAccountMut = useMutation({
    mutationFn: (data: { name: string; type: string }) => createAccount(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setEditId(null);
      setCardName("");
      setAccountType("efectivo");
      setBank("");
      setCardType("credito");
    },
  });

  const handleEdit = (card: Card) => {
    setEditId(card.id);
    setCardName(card.card_name);
    setBank(card.bank || "");
    setHolder(card.holder || "");
    setCardType(card.card_type);
    setAccountType("tarjeta");
    setMenuOpen(null);
  };

  const handleCancel = () => {
    setEditId(null);
    setCardName("");
    setBank("");
    setHolder("");
    setCardType("credito");
    setAccountType("tarjeta");
  };

  const handleAdd = () => {
    setEditId(-1);
    setCardName("");
    setBank("");
    setHolder(currentUser ? getFirstName(currentUser.full_name) : "");
    setCardType("credito");
    setAccountType("efectivo");
    setMenuOpen(null);
  };

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
    setErrors({});

    if (accountType === "tarjeta") {
      const data: { card_name: string; bank?: string; holder?: string; card_type?: string } = {
        card_name: cardName.trim(),
        bank: bank.trim(),
        card_type: cardType,
      };
      if (editId && editId > 0) {
        updateMut.mutate({ id: editId, data });
      } else {
        data.holder = holder.trim();
        createMut.mutate(data);
      }
    } else {
      createAccountMut.mutate({ name: cardName.trim(), type: accountType });
    }
  };

  if (isLoading)
    return (
      <div className="px-4 py-2">
        <Skeleton className="h-4 w-20 mb-3" />
        <SkeletonList items={2} />
      </div>
    );

  return (
    <div className="px-4 py-2 space-y-2">
      <h3 className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">
        Tarjetas
      </h3>

      {cards.map((card) => {
        const isEditing = editId === card.id;
        const isMenuOpen = menuOpen === card.id;

        return (
          <div key={card.id} className="relative">
            {isEditing ? (
              <form
                onSubmit={handleSubmit}
                className="p-4 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg space-y-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-base-alt flex items-center justify-center text-sm font-bold">
                    💳
                  </div>
                  <span className="text-xs font-medium text-secondary">
                    {card.card_type === "credito" ? "Crédito" : "Débito"} — {card.bank}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">
                    Tarjeta
                  </label>
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
                    placeholder="Ej: Visa"
                    autoFocus
                  />
                  {errors.card_name && <p className="text-xs text-red-500">{errors.card_name}</p>}
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
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">Tipo</label>
                  <Select
                    value={cardType}
                    onChange={(v) => setCardType(v)}
                    options={[
                      { value: "credito", label: "Crédito" },
                      { value: "debito", label: "Débito" },
                    ]}
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={createMut.isPending || updateMut.isPending}
                    className="flex-1 px-4 py-2 rounded-md bg-[var(--color-primary)] text-[var(--color-on-primary)] text-sm font-medium hover:brightness-110 disabled:opacity-60 transition"
                  >
                    {createMut.isPending || updateMut.isPending ? "Guardando..." : "Guardar"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <div
                className="group relative flex items-center gap-3 p-3 bg-surface border border-border-color rounded-lg hover:border-border-color transition-colors cursor-pointer"
                onClick={() => handleEdit(card)}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold badge-primary">
                  💳
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-sm font-semibold text-primary truncate"
                    title={card.card_name}
                  >
                    {card.card_name}
                  </div>
                  <div className="text-xs text-secondary capitalize">
                    {card.card_type === "credito"
                      ? "Crédito"
                      : card.card_type === "debito"
                        ? "Débito"
                        : card.card_type}{" "}
                    — {card.bank}
                  </div>
                  <div className="text-xs text-tertiary mt-0.5">Titular: {card.holder || "—"}</div>
                </div>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(isMenuOpen ? null : card.id);
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded text-tertiary hover:text-primary hover:bg-base-alt transition-colors"
                  >
                    ···
                  </button>
                  {isMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(null)} />
                      <div className="absolute right-0 top-8 z-50 w-28 bg-surface border border-border-color rounded-lg shadow-lg overflow-hidden">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm({ type: "card", id: card.id, name: card.card_name });
                          }}
                          disabled={deleteMut.isPending}
                          className="w-full px-3 py-2 text-xs text-left text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                        >
                          🗑️ Eliminar
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {editId === -1 && (
        <form
          onSubmit={handleSubmit}
          className="p-4 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg space-y-4"
        >
          <div className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                accountType === "tarjeta" ? "bg-base-alt" : "bg-success/10"
              }`}
            >
              {accountType === "efectivo"
                ? "💵"
                : accountType === "mercadopago"
                  ? "📱"
                  : accountType === "cuenta_corriente"
                    ? "🏦"
                    : accountType === "caja_ahorro"
                      ? "💳"
                      : "💳"}
            </div>
            <span className="text-xs font-medium text-secondary">
              {accountType === "tarjeta"
                ? cardType === "credito"
                  ? "Crédito"
                  : "Débito"
                : ACCOUNT_TYPES.find((t) => t.value === accountType)?.label || accountType}
            </span>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              Tipo de cuenta
            </label>
            <Select
              value={accountType}
              onChange={(v) => setAccountType(v)}
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
                  onChange={(v) => setCardType(v)}
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
              disabled={createMut.isPending || createAccountMut.isPending}
              className="flex-1 gnome-btn-primary"
            >
              {createMut.isPending || createAccountMut.isPending ? "Creando..." : "Crear"}
            </button>
            <button type="button" onClick={handleCancel} className="flex-1 gnome-btn-secondary">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {editId === null && (
        <button
          onClick={handleAdd}
          className="w-full py-2.5 border-2 border-dashed border-border-color rounded-lg text-sm text-secondary hover:border-primary hover:text-primary transition-colors"
        >
          + Agregar
        </button>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-primary mb-2">Confirmar eliminación</h3>
            <p className="text-sm text-secondary mb-6">
              ¿Estás seguro de eliminar{" "}
              <span className="font-medium text-primary">"{deleteConfirm.name}"</span>? Esta acción
              no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  deleteMut.mutate(deleteConfirm.id);
                  setDeleteConfirm(null);
                }}
                disabled={deleteMut.isPending}
                className="flex-1 px-4 py-2 rounded-md bg-[var(--color-danger)] text-white text-sm font-medium hover:brightness-110 disabled:opacity-60 transition"
              >
                {deleteMut.isPending ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateFound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-primary mb-2">Tarjeta existente</h3>
            <p className="text-sm text-secondary mb-6">
              Ya existe una tarjeta con estos datos:{" "}
              <span className="font-medium text-primary">"{duplicateFound.card_name}"</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDuplicateFound(null);
                  setCardName("");
                  setBank("");
                  setCardType("credito");
                  setEditId(null);
                }}
                className="flex-1 px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const cardToEdit = cards.find((c) => c.id === duplicateFound.id);
                  if (cardToEdit) {
                    setEditId(duplicateFound.id);
                    setCardName(cardToEdit.card_name);
                    setBank(cardToEdit.bank || "");
                    setCardType(cardToEdit.card_type);
                  }
                  setDuplicateFound(null);
                }}
                className="flex-1 px-4 py-2 rounded-md bg-[var(--color-primary)] text-[var(--color-on-primary)] text-sm font-medium hover:brightness-110 transition"
              >
                Editar existente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
