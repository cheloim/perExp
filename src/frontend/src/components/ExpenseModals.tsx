import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCategories,
  createCategory,
  suggestCategory,
  getTags,
  createTag,
  extractExpenseFromImage,
} from "../api/client";
import type { Expense, ExpenseCreate, ExpenseImageDraft } from "../types";
import { Select } from "./ui/Select";
import Dialog from "./ui/Dialog";
import Field from "./ui/Field";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatMoney } from "../utils/format";

// Helper function to get today's date in DD-MM-YYYY format
export function todayDDMMYYYY() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const y = now.getFullYear();
  return `${d}-${m}-${y}`;
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
  installment_mode: "none",
  account_id: null,
  card_id: null,
  tag_ids: [],
};

// DatePicker component with calendar

// ExpenseModal - Full modal for expense transactions with payment method selector
interface ExpenseModalProps {
  initial?: Expense | null;
  onClose: () => void;
  onSave: (data: ExpenseCreate) => void | Promise<void>;
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
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: getCategories,
  });
  const { data: tags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: getTags,
  });

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeGuardRef.current();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const [aiSuggested, setAiSuggested] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const isInstallmentsOnly = mode === "installments-only";

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
        tag_ids: initial.tags?.filter((t) => t.group_name !== "categoria").map((t) => t.id) ?? [],
      };
    }
    return { ...EMPTY_FORM };
  });
  const formRef = useRef(form);
  const closeGuardRef = useRef<() => void>(onClose);
  const updateForm = (updater: ExpenseCreate | ((current: ExpenseCreate) => ExpenseCreate)) => {
    const nextForm = typeof updater === "function" ? updater(formRef.current) : updater;
    formRef.current = nextForm;
    setForm(nextForm);
  };

  const [cuotasEnabled, setCuotasEnabled] = useState(
    isInstallmentsOnly || !!(initial?.installment_total && initial.installment_total > 1),
  );
  const [showAdvanced, setShowAdvanced] = useState(
    !!initial?.notes || !!(initial?.installment_total && initial.installment_total > 1),
  );

  // Track dirty state for unsaved changes warning (GNOME HIG: confirmation before destructive actions)
  const [isDirty, setIsDirty] = useState(false);
  const set = <K extends keyof ExpenseCreate>(key: K, value: ExpenseCreate[K]) => {
    updateForm((f) => ({ ...f, [key]: value }));
    setIsDirty(true);
    setSubmitError("");
  };

  const [imageStatus, setImageStatus] = useState<"idle" | "analyzing" | "ok" | "error">("idle");
  const [imageDraft, setImageDraft] = useState<ExpenseImageDraft | null>(null);
  const [drafts, setDrafts] = useState<ExpenseImageDraft[]>([]);
  const [draftIndex, setDraftIndex] = useState(0);
  const [draftStatuses, setDraftStatuses] = useState<("pending" | "saved" | "skipped")[]>([]);
  const [amountKind, setAmountKind] = useState<"none" | "total" | "installment">("none");
  const [imageError, setImageError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [queueFinished, setQueueFinished] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const scanIdRef = useRef(0);
  const imageAbortControllerRef = useRef<AbortController | null>(null);

  const isEditing = !!initial;
  const isQueueActive = drafts.length > 1;
  const pendingDrafts = draftStatuses.filter((status) => status === "pending").length;
  const savedDrafts = draftStatuses.filter((status) => status === "saved").length;
  const skippedDrafts = draftStatuses.filter((status) => status === "skipped").length;

  const clearImagePreview = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
  };

  useEffect(
    () => () => {
      scanIdRef.current += 1;
      imageAbortControllerRef.current?.abort();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const applyImageDraft = (draft: ExpenseImageDraft) => {
    const [year, month, day] = (draft.date ?? "").split("-");
    const date = year && month && day ? `${day}-${month}-${year}` : todayDDMMYYYY();
    updateForm((current) => ({
      ...current,
      amount: draft.amount,
      description: draft.description,
      date,
      currency: draft.currency,
      category_id: null,
    }));
    setAiSuggested(false);
    const inferredKind =
      draft.amount_kind === "installment" || draft.amount_kind === "total"
        ? draft.amount_kind
        : draft.installment_total && draft.installment_total >= 2
          ? draft.installment_number && draft.installment_number > 1
            ? "installment"
            : "total"
          : "none";
    setAmountKind(inferredKind);
    if (draft.installment_total && draft.installment_total >= 2) {
      setCuotasEnabled(true);
      setShowAdvanced(true);
      updateForm((current) => ({
        ...current,
        installment_number: draft.installment_number ?? 1,
        installment_total: draft.installment_total ?? null,
        installment_group_id: crypto.randomUUID(),
      }));
    } else {
      setCuotasEnabled(false);
      updateForm((current) => ({
        ...current,
        installment_number: null,
        installment_total: null,
        installment_group_id: null,
      }));
    }
    setIsDirty(true);
    setConfirmReplace(false);
    setSubmitError("");
  };

  const applyQueueDraft = (index: number) => {
    const draft = drafts[index];
    if (!draft) return;
    setDraftIndex(index);
    setImageDraft(draft);
    applyImageDraft(draft);
  };

  const handleImageFile = async (file?: File) => {
    if (!file) return;
    imageAbortControllerRef.current?.abort();
    const scanId = ++scanIdRef.current;
    const controller = new AbortController();
    imageAbortControllerRef.current = controller;
    const formAtStart = formRef.current;
    const wasEmptyAtStart = !formAtStart.description.trim() && formAtStart.amount === 0;
    clearImagePreview();
    if (typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    }
    setImageStatus("analyzing");
    setImageDraft(null);
    setDrafts([]);
    setDraftStatuses([]);
    setDraftIndex(0);
    setQueueFinished(false);
    setAmountKind("none");
    setImageError("");
    setSubmitError("");
    try {
      const result = await extractExpenseFromImage(file, undefined, controller.signal);
      if (controller.signal.aborted || scanId !== scanIdRef.current) return;
      if (result.status !== "ok" || !result.drafts?.length) {
        setImageStatus("error");
        setImageError(result.message);
        return;
      }
      const detected = result.drafts;
      setDrafts(detected);
      setDraftStatuses(detected.map(() => "pending"));
      setDraftIndex(0);
      setImageDraft(detected[0]);
      setImageStatus("ok");
      const currentForm = formRef.current;
      const isEmptyNow = !currentForm.description.trim() && currentForm.amount === 0;
      if (wasEmptyAtStart && isEmptyNow) {
        applyImageDraft(detected[0]);
      } else {
        setConfirmReplace(true);
      }
    } catch {
      if (controller.signal.aborted || scanId !== scanIdRef.current) return;
      setImageStatus("error");
      setImageError("No pude analizar la imagen. Probá con otra foto más nítida.");
    } finally {
      if (scanId === scanIdRef.current) imageAbortControllerRef.current = null;
    }
  };

  const removeImage = () => {
    scanIdRef.current += 1;
    imageAbortControllerRef.current?.abort();
    imageAbortControllerRef.current = null;
    clearImagePreview();
    setImageDraft(null);
    setDrafts([]);
    setDraftStatuses([]);
    setDraftIndex(0);
    setQueueFinished(false);
    setAmountKind("none");
    setImageError("");
    setImageStatus("idle");
    setConfirmReplace(false);
    setSubmitError("");
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  // Warn before closing browser tab with unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Local keyword matching — instant, no API cost
  const keywordMatch = (desc: string): number | null => {
    const lower = desc.toLowerCase();
    const leafIds = new Set(
      categories.filter((c) => !categories.some((ch) => ch.parent_id === c.id)).map((c) => c.id),
    );
    for (const cat of categories) {
      if (!leafIds.has(cat.id) || !cat.keywords) continue;
      for (const kw of cat.keywords.split(",")) {
        if (kw.trim() && lower.includes(kw.trim().toLowerCase())) return cat.id;
      }
    }
    return null;
  };

  // Real-time keyword pre-fill as user types
  useEffect(() => {
    const desc = initial?.description ?? form.description;
    if (!desc || desc.length < 3 || initial?.category_id || form.category_id) return;
    const match = keywordMatch(desc);
    if (match) {
      updateForm((f) => ({ ...f, category_id: match }));
      setAiSuggested(false);
    }
  }, [form.description]); // eslint-disable-line react-hooks/exhaustive-deps

  // One-shot LLM pre-fill on mount (upgrade keyword match if possible)
  useEffect(() => {
    const desc = initial?.description ?? form.description;
    if (!desc || desc.length < 3 || initial?.category_id) return;
    suggestCategory({ description: desc, amount: form.amount || undefined })
      .then((res) => {
        if (res?.category_id) {
          updateForm((f) => ({ ...f, category_id: res.category_id }));
          setAiSuggested(true);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate installment group ID on mount for installments-only mode
  useEffect(() => {
    if (isInstallmentsOnly && !form.installment_group_id) {
      updateForm((prev) => ({
        ...prev,
        installment_group_id: crypto.randomUUID(),
        installment_number: prev.installment_number ?? 1,
        installment_total: prev.installment_total ?? 12,
      }));
    }
  }, [isInstallmentsOnly, form.installment_group_id]);

  const installmentTotal = form.installment_total ?? 0;
  const installmentNumber = form.installment_number ?? 1;
  const installmentsActive = cuotasEnabled && installmentTotal >= 2;
  const isCurrentInstallment =
    installmentsActive && (installmentNumber > 1 || amountKind === "installment");
  const installmentsValid =
    !cuotasEnabled ||
    (installmentTotal >= 2 &&
      installmentTotal <= 60 &&
      installmentNumber >= 1 &&
      installmentNumber <= installmentTotal);
  const perInstallment = installmentsActive ? form.amount / installmentTotal : 0;

  const isValid =
    form.description.trim().length > 0 &&
    form.amount > 0 &&
    form.date.trim().length > 0 &&
    installmentsValid;

  const toggleCuotas = (enabled: boolean) => {
    setCuotasEnabled(enabled);
    setSubmitError("");
    if (enabled) {
      setShowAdvanced(true);
      setAmountKind("total");
      const gid = form.installment_group_id || crypto.randomUUID();
      updateForm((prev) => ({
        ...prev,
        installment_number: 1,
        installment_total: 12,
        installment_group_id: gid,
      }));
      setIsDirty(true);
    } else {
      setAmountKind("none");
      updateForm((prev) => ({
        ...prev,
        installment_number: null,
        installment_total: null,
        installment_group_id: null,
      }));
      setIsDirty(true);
    }
  };

  const [newTagName, setNewTagName] = useState("");

  const visibleTags = useMemo(() => tags.filter((t) => t.group_name !== "categoria"), [tags]);

  const selectedTags = visibleTags.filter((t) => form.tag_ids?.includes(t.id));
  const availableTags = visibleTags.filter((t) => !form.tag_ids?.includes(t.id));
  const filteredNewTag =
    newTagName.trim() &&
    !tags.some((t) => t.name.toLowerCase() === newTagName.trim().toLowerCase());

  const toggleTag = (id: number) => {
    const tag = visibleTags.find((t) => t.id === id);
    if (!tag) return;

    const isExclusive = tag.group_name === "cuenta";

    updateForm((prev) => {
      const current = prev.tag_ids ?? [];
      if (current.includes(id)) {
        return { ...prev, tag_ids: current.filter((x) => x !== id) };
      }
      if (isExclusive) {
        const sameGroupIds = visibleTags
          .filter((t) => t.group_name === tag.group_name && t.id !== id)
          .map((t) => t.id);
        const filtered = current.filter((x) => !sameGroupIds.includes(x));
        return { ...prev, tag_ids: [...filtered, id] };
      }
      return { ...prev, tag_ids: [...current, id] };
    });
  };

  const handleCreateInlineTag = async () => {
    if (!newTagName.trim()) return;
    try {
      const created = await createTag({
        name: newTagName.trim(),
        color: "#6366f1",
        group_name: "otros",
      });
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      updateForm((prev) => ({
        ...prev,
        tag_ids: [...(prev.tag_ids ?? []), created.id],
      }));
      setNewTagName("");
    } catch {}
  };

  const advanceQueue = (status: "saved" | "skipped") => {
    const nextStatuses = [...draftStatuses];
    nextStatuses[draftIndex] = status;
    setDraftStatuses(nextStatuses);
    const nextIndex = nextStatuses.findIndex((value) => value === "pending");
    if (nextIndex === -1) {
      setQueueFinished(true);
      return;
    }
    setDraftIndex(nextIndex);
    setImageDraft(drafts[nextIndex]);
    applyImageDraft(drafts[nextIndex]);
  };

  const handleSkip = () => {
    if (!isQueueActive || queueFinished) return;
    advanceQueue("skipped");
  };

  const handleSubmit = async () => {
    if (!isValid || isSaving || isSubmitting || queueFinished) return;
    const payload: ExpenseCreate = {
      ...form,
      amount: Math.abs(form.amount),
      tag_ids: form.tag_ids,
      installment_mode:
        !isEditing && installmentsActive ? (isCurrentInstallment ? "current" : "total") : "none",
    };
    setSubmitError("");
    setIsSubmitting(true);
    try {
      await onSave(payload);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "No pude guardar el gasto.");
      setIsSubmitting(false);
      return;
    }
    setIsSubmitting(false);
    if (!isQueueActive) {
      onClose();
      return;
    }
    advanceQueue("saved");
  };

  const requestClose = () => {
    if (isQueueActive && pendingDrafts > 0 && !queueFinished) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    closeGuardRef.current = requestClose;
  });

  const footer = queueFinished ? (
    <div className="space-y-2">
      <p role="status" className="text-sm font-medium text-[var(--text-primary)]">
        ✅ {savedDrafts} {savedDrafts === 1 ? "gasto guardado" : "gastos guardados"}
        {skippedDrafts > 0
          ? ` · ${skippedDrafts} ${skippedDrafts === 1 ? "omitido" : "omitidos"}`
          : ""}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="w-full px-4 py-2 rounded-md bg-[var(--color-primary)] text-white text-sm font-medium hover:brightness-110 transition"
      >
        Cerrar
      </button>
    </div>
  ) : (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={requestClose}
        className="flex-1 px-4 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
      >
        Cancelar
      </button>
      {isQueueActive && draftStatuses[draftIndex] === "pending" && (
        <button
          type="button"
          onClick={handleSkip}
          className="px-3 py-2 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
        >
          Omitir
        </button>
      )}
      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!isValid || isSaving || isSubmitting}
        className="flex-1 px-4 py-2 rounded-md bg-[var(--color-primary)] text-white text-sm font-medium hover:brightness-110 disabled:opacity-60 transition"
      >
        {isSaving || isSubmitting
          ? "Guardando..."
          : isQueueActive && pendingDrafts > 1
            ? "Guardar y siguiente"
            : "Guardar"}
      </button>
    </div>
  );

  return (
    <Dialog
      isOpen
      onClose={requestClose}
      title={initial ? "Editar gasto" : "Nuevo gasto"}
      closeLabel="Cerrar diálogo"
      size="md"
      footer={footer}
    >
      <div className="space-y-2.5">
        {(submitError || saveError) && (
          <div
            role="alert"
            className="flex items-start gap-2 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger"
          >
            <span className="mt-0.5" aria-hidden="true">
              ✕
            </span>
            <span>{submitError || saveError}</span>
          </div>
        )}

        {!initial && !isInstallmentsOnly && (
          <section className="rounded-md border border-[var(--border-color)] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={imageStatus === "analyzing"}
                className="px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--color-base-alt)] disabled:opacity-60 transition"
              >
                🧾 Escanear comprobante
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                aria-label="Escanear comprobante"
                className="sr-only"
                onChange={(event) => {
                  void handleImageFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </div>
            <p className="text-xs text-[var(--text-tertiary)]">
              Ticket, transferencia o notificación del banco
            </p>

            {previewUrl && (
              <div className="flex items-center gap-3">
                <img
                  src={previewUrl}
                  alt="Vista previa del comprobante"
                  className="h-16 w-16 rounded-md object-cover border border-[var(--border-color)]"
                />
                <button
                  type="button"
                  onClick={removeImage}
                  className="text-xs text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
                >
                  Quitar
                </button>
              </div>
            )}

            {imageStatus === "analyzing" && (
              <p role="status" aria-live="polite" className="text-xs text-[var(--text-secondary)]">
                Analizando comprobante…
              </p>
            )}
            {imageStatus === "error" && (
              <p role="alert" className="text-xs text-danger">
                {imageError}
              </p>
            )}
            {imageStatus === "ok" && imageDraft && (
              <div role="status" aria-live="polite" className="space-y-1 text-xs">
                {isQueueActive ? (
                  <>
                    <p className="font-medium text-[var(--text-primary)]">
                      Detecté {drafts.length} gastos. Revisalos antes de guardar.
                    </p>
                    <p className="text-[var(--text-secondary)]">
                      Gasto {draftIndex + 1} de {drafts.length}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {drafts.map((draft, index) => (
                        <button
                          key={`${draft.description}-${index}`}
                          type="button"
                          onClick={() => applyQueueDraft(index)}
                          disabled={draftStatuses[index] === "saved"}
                          className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                            index === draftIndex
                              ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                              : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
                          } disabled:opacity-60`}
                        >
                          {index + 1}. {draft.description} ·{" "}
                          {formatMoney(draft.amount, draft.currency)}
                          {draftStatuses[index] === "saved"
                            ? " ✓"
                            : draftStatuses[index] === "skipped"
                              ? " —"
                              : ""}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-[var(--text-primary)]">
                      Comprobante detectado: {formatMoney(imageDraft.amount, imageDraft.currency)}
                    </p>
                    <p className="text-[var(--text-secondary)]">Revisalo antes de guardar.</p>
                  </>
                )}
                {imageDraft.confidence !== "high" && (
                  <p className="font-medium text-amber-700 dark:text-amber-300">
                    Revisá el total detectado.
                  </p>
                )}
                <p className="text-[var(--text-tertiary)]">
                  {imageDraft.source_type.replace(/_/g, " ")}
                  {imageDraft.card_hint ? ` · ${imageDraft.card_hint}` : ""}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Fecha */}
        <Field label="Fecha" required>
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
        </Field>

        {/* Monto + Moneda */}
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <Field label="Monto" required>
              <input
                type="number"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => set("amount", parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              />
            </Field>
          </div>
          <div>
            <Field label="Moneda">
              <Select
                value={form.currency ?? "ARS"}
                onChange={(v) => set("currency", v)}
                ariaLabel="Moneda"
                options={[
                  { value: "ARS", label: "ARS ($)" },
                  { value: "USD", label: "USD (U$S)" },
                ]}
              />
            </Field>
          </div>
        </div>

        {/* Descripción + Categoría */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Field label="Descripción" required>
              <input
                type="text"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Ej: Supermercado Coto"
                className="w-full px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              />
            </Field>
          </div>
          <div>
            <Field label="Categoría" help={aiSuggested ? "Sugerida por IA" : undefined}>
              <Select
                value={form.category_id ? String(form.category_id) : ""}
                ariaLabel="Categoría"
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
                            options: orphans.map((c) => ({
                              value: String(c.id),
                              label: c.name,
                            })),
                          },
                        ]
                      : []),
                  ];
                })()}
                placeholder="Sin categoría"
              />
            </Field>
          </div>
        </div>

        {/* Cuenta (single-select) */}
        <div role="group" aria-labelledby="expense-account-label">
          <span
            id="expense-account-label"
            className="text-xs font-medium text-[var(--text-secondary)]"
          >
            Cuenta
          </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {tags
              .filter((t) => t.group_name === "cuenta")
              .map((tag) => {
                const selected = form.tag_ids?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition ${
                      selected
                        ? "text-white"
                        : "border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
                    }`}
                    style={selected ? { backgroundColor: tag.color } : undefined}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: selected ? "#fff" : tag.color }}
                    />
                    {tag.name}
                    {selected && <span className="ml-0.5 opacity-70">✕</span>}
                  </button>
                );
              })}
            {tags.filter((t) => t.group_name === "cuenta").length === 0 && (
              <span className="text-xs text-[var(--text-tertiary)] italic">Sin cuentas</span>
            )}
          </div>
        </div>

        {/* Etiquetas (multi-select + create) */}
        <div role="group" aria-labelledby="expense-tags-label">
          <span
            id="expense-tags-label"
            className="text-xs font-medium text-[var(--text-secondary)]"
          >
            Etiquetas
          </span>
          {(() => {
            const selectedOtros = selectedTags.filter((t) => t.group_name === "otros");
            return selectedOtros.length > 0 ? (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {selectedOtros.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className="ml-0.5 hover:opacity-70"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            ) : null;
          })()}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filteredNewTag) handleCreateInlineTag();
                }
              }}
              placeholder="Buscar o crear etiqueta..."
              aria-label="Buscar o crear etiqueta"
              className="flex-1 px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>
          {(() => {
            const otrosAvailable = availableTags.filter((t) => t.group_name === "otros");
            return otrosAvailable.length > 0 || filteredNewTag ? (
              <div className="mt-1.5">
                <div className="flex flex-wrap gap-1">
                  {otrosAvailable.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition"
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                    </button>
                  ))}
                  {filteredNewTag && (
                    <button
                      type="button"
                      onClick={handleCreateInlineTag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-dashed border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition"
                    >
                      + Crear "{newTagName.trim()}"
                    </button>
                  )}
                </div>
              </div>
            ) : null;
          })()}
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
            <div className="border border-[var(--border-color)] rounded-md p-2.5 space-y-2">
              {isEditing ? (
                initial?.installment_total && initial.installment_total > 1 ? (
                  <p className="text-xs text-[var(--text-secondary)]">
                    Cuota {initial.installment_number ?? 1} de {initial.installment_total}. Editás
                    solo esta cuota; las futuras se gestionan desde Cuotas.
                  </p>
                ) : (
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Para cuotificar una compra nueva, creá el gasto desde “Nuevo gasto”.
                  </p>
                )
              ) : (
                <>
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
                    <>
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <Field label="Cuota N°">
                            <input
                              type="number"
                              min={1}
                              max={installmentTotal || 60}
                              value={form.installment_number ?? 1}
                              onChange={(e) => {
                                const next = parseInt(e.target.value) || 1;
                                set("installment_number", next);
                                setAmountKind(next > 1 ? "installment" : "total");
                              }}
                              className="w-full px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition text-center"
                            />
                          </Field>
                        </div>
                        <span className="text-[var(--text-tertiary)] mt-6" aria-hidden="true">
                          de
                        </span>
                        <div className="flex-1">
                          <Field
                            label="Total cuotas"
                            error={installmentTotal < 2 ? "Ingresá al menos 2 cuotas." : undefined}
                          >
                            <input
                              type="number"
                              min={2}
                              max={60}
                              value={form.installment_total ?? 12}
                              onChange={(e) =>
                                set("installment_total", parseInt(e.target.value) || 2)
                              }
                              className="w-full px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition text-center"
                            />
                          </Field>
                        </div>
                      </div>
                      {installmentsActive && (
                        <p className="text-xs text-[var(--text-secondary)]">
                          {isCurrentInstallment
                            ? `Estás registrando la cuota ${installmentNumber} de ${installmentTotal}; se programan las restantes.`
                            : "El monto total se divide en las cuotas indicadas."}
                        </p>
                      )}
                      {installmentsActive && form.amount > 0 && (
                        <p className="text-xs text-[var(--text-tertiary)]">
                          {isCurrentInstallment
                            ? `Cuota de ${formatMoney(form.amount, form.currency)}; se programan ${Math.max(installmentTotal - installmentNumber, 0)} cuotas.`
                            : `${installmentTotal} cuotas de ${formatMoney(perInstallment, form.currency)}.`}
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            <Field label="Notas">
              <textarea
                value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
                className="w-full px-3 py-1.5 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition resize-none"
                rows={1}
              />
            </Field>
          </div>
        )}

        <ConfirmDialog
          isOpen={confirmReplace}
          title="¿Reemplazar los datos actuales?"
          message="El comprobante va a reemplazar el monto, la descripción, la fecha y la moneda actuales."
          confirmLabel="Reemplazar"
          cancelLabel="Mantener datos"
          onConfirm={() => {
            if (imageDraft) {
              setDraftIndex(0);
              applyImageDraft(imageDraft);
            }
          }}
          onCancel={() => {
            setConfirmReplace(false);
            setDrafts([]);
            setDraftStatuses([]);
            setImageDraft(null);
            setImageStatus("idle");
          }}
          variant="primary"
        />
        <ConfirmDialog
          isOpen={confirmDiscard}
          title="¿Descartar los gastos sin guardar?"
          message={`Quedan ${pendingDrafts} ${pendingDrafts === 1 ? "gasto" : "gastos"} sin guardar del comprobante.`}
          confirmLabel="Descartar"
          cancelLabel="Seguir revisando"
          onConfirm={onClose}
          onCancel={() => setConfirmDiscard(false)}
          variant="danger"
        />
      </div>
    </Dialog>
  );
}
