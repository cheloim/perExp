import { useState } from "react";
import type { CategorizationReviewDetail, ReviewSignal } from "../../types";

const SIGNAL_LABELS: Record<string, string> = {
  keyword_conflict: "Conflicto de palabras clave",
  category_keyword_miss: "El comercio no coincide con su categoría",
  history_conflict: "Historial del comercio",
  amount_outlier: "Monto atípico para la categoría",
  llm_second_opinion: "Segunda opinión del LLM",
};

const SIGNAL_DETAIL_LABELS: Record<string, string> = {
  tier: "Coincidencia",
  matched_keyword: "Keyword",
  suggested_category_id: "Categoría sugerida",
  support: "Gastos de soporte",
  share: "Proporción",
  majority_category_id: "Categoría mayoritaria",
  mad_z: "Z robusto",
  category_median: "Mediana de la categoría",
  coverage: "Cobertura",
  expense_count: "Gastos analizados",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function SignalDetails({ signal }: { signal: ReviewSignal }) {
  const entries = Object.entries(signal).filter(
    ([key, value]) => key !== "weight" && value !== null && value !== undefined,
  );
  if (entries.length === 0) return null;

  return (
    <ul className="mt-1 space-y-0.5">
      {entries.map(([key, value]) => (
        <li key={key} className="text-xs text-[var(--text-tertiary)]">
          <span className="font-medium">{SIGNAL_DETAIL_LABELS[key] ?? key}:</span>{" "}
          {formatValue(value)}
        </li>
      ))}
    </ul>
  );
}

interface ReviewEvidenceProps {
  review: CategorizationReviewDetail;
  onAcceptWithCategory: (categoryId: number) => void;
}

/**
 * Full evidence behind a detector finding: signals with their weights, the
 * merchant key, the LLM second opinion and the category picker for findings
 * the detector could not resolve by itself.
 */
export default function ReviewEvidence({ review, onAcceptWithCategory }: ReviewEvidenceProps) {
  const [categoryId, setCategoryId] = useState("");
  const evidence = review.evidence ?? {};
  const signals = Object.entries(evidence.signals ?? {});
  const hasEvidence =
    signals.length > 0 || evidence.llm !== undefined || evidence.merchant_key !== undefined;

  if (!hasEvidence) {
    return <p className="text-xs text-[var(--text-tertiary)]">Sin evidencia registrada.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-[var(--text-secondary)]">Categoría actual</p>
          <p className="text-sm text-[var(--text-primary)]">
            {evidence.current_category?.name ?? review.current_category_name ?? "—"}
          </p>
          {evidence.current_category?.keywords && (
            <p className="text-xs text-[var(--text-tertiary)]">
              Keywords: {evidence.current_category.keywords}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold text-[var(--text-secondary)]">Clave de comercio</p>
          <p className="text-sm text-[var(--text-primary)] break-all">
            {evidence.merchant_key || "—"}
          </p>
        </div>
      </div>

      {signals.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">Señales</p>
          <ul className="space-y-1.5" aria-label="Señales del detector">
            {signals.map(([name, signal]) => (
              <li key={name} className="text-sm text-[var(--text-primary)]">
                <span className="font-medium">{SIGNAL_LABELS[name] ?? name}</span>{" "}
                <span className="text-xs text-[var(--text-tertiary)]">(peso {signal.weight})</span>
                <SignalDetails signal={signal} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-[var(--text-secondary)]">
          Segunda opinión del LLM
        </p>
        {evidence.llm ? (
          <p className="text-xs text-[var(--text-tertiary)]">
            {evidence.llm.is_mismatch ? "Confirma el desvío" : "Dice que está bien"} · confianza{" "}
            {evidence.llm.confidence}
            {evidence.llm.reason ? ` · ${evidence.llm.reason}` : ""}
          </p>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">Sin segunda opinión (solo reglas).</p>
        )}
      </div>

      {review.suggested_category_id === null && (
        <div className="flex flex-wrap items-end gap-2" aria-label="Elegir categoría">
          <label className="text-xs text-[var(--text-secondary)]">
            Elegí la categoría correcta
            <select
              aria-label="Categoría de destino"
              className="input text-xs mt-1 block"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Seleccionar…</option>
              {review.available_categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="gnome-btn-primary-round text-xs"
            disabled={!categoryId}
            onClick={() => onAcceptWithCategory(Number(categoryId))}
          >
            Aplicar categoría
          </button>
        </div>
      )}
    </div>
  );
}
