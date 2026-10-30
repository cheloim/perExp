import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptCategorizationReview,
  bulkAcceptCategorizationReviews,
  getAdminUsers,
  getCategorizationReview,
  getCategorizationReviews,
  getTaskStatus,
  investigateCategorizationReview,
  rejectCategorizationReview,
  scanCategorizationReviews,
} from "../../api/client";
import type { CategorizationReview, CategorizationReviewDetail, ReviewFilters } from "../../types";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import EmptyState from "../../components/ui/EmptyState";
import ReviewEvidence from "./ReviewEvidence";
import { showToast } from "../../utils/toast";
import { downloadCsv } from "../../utils/csv";

/**
 * Internal review of miscategorization findings (issue #466).
 *
 * Admin-only and read-forward by design: the filters only choose what is
 * displayed. Nothing here re-scans history or reopens an already resolved
 * review; generating findings is still the daily job or the forward-only scan.
 */

const JOB_NAME = "categorization-review-scan-daily";
const PER_PAGE = 50;

const SIGNAL_OPTIONS = [
  { value: "keyword_conflict", label: "Conflicto de keywords" },
  { value: "category_keyword_miss", label: "Keyword miss" },
  { value: "history_conflict", label: "Historial del comercio" },
  { value: "amount_outlier", label: "Monto atípico" },
  { value: "llm_second_opinion", label: "Segunda opinión LLM" },
];

const STATUS_OPTIONS = [
  { value: "pending", label: "Pendientes" },
  { value: "accepted", label: "Aceptadas" },
  { value: "rejected", label: "Rechazadas" },
  { value: "investigated", label: "Investigadas" },
  { value: "all", label: "Todas" },
];

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((option) => [option.value, option.label]),
);

const CSV_HEADERS = [
  "fecha",
  "comercio",
  "monto",
  "moneda",
  "categoria_actual",
  "categoria_sugerida",
  "score",
  "fuente",
  "estado",
  "motivo",
];

function errorInfo(error: unknown): { status?: number; detail: string } {
  const axiosError = error as {
    response?: { status?: number; data?: { detail?: string } };
    message?: string;
  };
  return {
    status: axiosError.response?.status,
    detail: axiosError.response?.data?.detail ?? axiosError.message ?? "Error inesperado",
  };
}

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return "—";
  return amount.toLocaleString("es-AR", {
    style: "currency",
    currency: currency || "ARS",
  });
}

function formatDate(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}

export default function CategorizationReviewTab() {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState("pending");
  const [userId, setUserId] = useState("");
  const [minScore, setMinScore] = useState("0.5");
  const [maxScore, setMaxScore] = useState("");
  const [signal, setSignal] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CategorizationReview | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [threshold, setThreshold] = useState("0.8");
  const [scanUserId, setScanUserId] = useState("");
  const [useLlm, setUseLlm] = useState(true);

  const filters: ReviewFilters = useMemo(
    () => ({
      status,
      user_id: userId ? Number(userId) : undefined,
      min_score: minScore ? Number(minScore) : undefined,
      max_score: maxScore ? Number(maxScore) : undefined,
      signal: signal || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      search: search || undefined,
      page,
      per_page: PER_PAGE,
    }),
    [status, userId, minScore, maxScore, signal, dateFrom, dateTo, search, page],
  );

  const reviewsQuery = useQuery({
    queryKey: ["categorization-reviews", filters],
    queryFn: () => getCategorizationReviews(filters),
  });

  const detailQuery = useQuery({
    queryKey: ["categorization-review", expandedId],
    queryFn: () => getCategorizationReview(expandedId as number),
    enabled: expandedId !== null,
  });

  const usersQuery = useQuery({
    queryKey: ["admin-users", "categorization"],
    queryFn: () => getAdminUsers({ per_page: 200 }),
  });

  const tasksQuery = useQuery({
    queryKey: ["admin-task-status"],
    queryFn: getTaskStatus,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["categorization-reviews"] });
    queryClient.invalidateQueries({ queryKey: ["categorization-review"] });
  };

  const handleActionError = (error: unknown) => {
    const { status: code, detail } = errorInfo(error);
    if (code === 409) {
      showToast("La revisión quedó obsoleta: el gasto cambió de categoría.", "error");
      refresh();
      return;
    }
    showToast(detail, "error");
  };

  const acceptMut = useMutation({
    mutationFn: ({ id, categoryId }: { id: number; categoryId?: number }) =>
      acceptCategorizationReview(id, categoryId),
    onSuccess: () => {
      showToast("Categoría aplicada", "success");
      refresh();
    },
    onError: handleActionError,
  });

  const rejectMut = useMutation({
    mutationFn: (id: number) => rejectCategorizationReview(id),
    onSuccess: () => {
      showToast("Revisión rechazada", "success");
      refresh();
    },
    onError: handleActionError,
  });

  const investigateMut = useMutation({
    mutationFn: (id: number) => investigateCategorizationReview(id),
    onSuccess: () => {
      showToast("Revisión marcada como investigada", "success");
      refresh();
    },
    onError: handleActionError,
  });

  const bulkMut = useMutation({
    mutationFn: () =>
      bulkAcceptCategorizationReviews({
        min_score: Number(threshold),
        user_id: userId ? Number(userId) : undefined,
      }),
    onSuccess: (result) => {
      const skipped = result.skipped_stale + result.skipped_missing_category;
      showToast(
        `Aceptadas ${result.accepted} de ${result.candidates}` +
          (skipped ? ` · ${skipped} quedaron sin aplicar` : ""),
        result.accepted > 0 ? "success" : "info",
      );
      setBulkOpen(false);
      refresh();
    },
    onError: handleActionError,
  });

  const scanMut = useMutation({
    mutationFn: () => scanCategorizationReviews({ user_id: Number(scanUserId), use_llm: useLlm }),
    onSuccess: (result: { scanned: number; candidates: number; persisted: number }) => {
      showToast(
        `Escaneados ${result.scanned} gastos · ${result.candidates} candidatos · ${result.persisted} guardadas`,
        "success",
      );
      refresh();
      queryClient.invalidateQueries({ queryKey: ["admin-task-status"] });
    },
    onError: handleActionError,
  });

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await getCategorizationReviews({ ...filters, page: 1, per_page: 200 });
      downloadCsv(
        `categorization-reviews-${new Date().toISOString().slice(0, 10)}.csv`,
        CSV_HEADERS,
        data.items.map((review) => [
          formatDate(review.date),
          review.description,
          review.amount,
          review.currency,
          review.current_category_name,
          review.suggested_category_name,
          review.score,
          review.source,
          review.status,
          review.reason,
        ]),
      );
    } catch (error) {
      showToast(errorInfo(error).detail, "error");
    } finally {
      setExporting(false);
    }
  };

  const resetPage = () => setPage(1);

  const data = reviewsQuery.data;
  const summary = data?.summary;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const users = (usersQuery.data?.users ?? []) as {
    id: number;
    full_name: string;
    email: string;
  }[];
  const job = (tasksQuery.data?.tasks ?? []).find(
    (task: { name: string }) => task.name === JOB_NAME,
  ) as { last_run?: string; last_status?: string } | undefined;
  const precision = summary?.manual_precision ?? null;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Pendientes</p>
            <p className="text-lg font-semibold text-[var(--text-primary)]">
              {summary?.by_status?.pending ?? 0}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Aceptadas</p>
            <p className="text-lg font-semibold text-[var(--text-primary)]">
              {summary?.by_status?.accepted ?? 0}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Rechazadas</p>
            <p className="text-lg font-semibold text-[var(--text-primary)]">
              {summary?.by_status?.rejected ?? 0}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-tertiary)]">Precisión manual</p>
            <p className="text-lg font-semibold text-[var(--text-primary)]">
              {precision === null ? "—" : precision.toFixed(2)}
            </p>
          </div>
          <div className="min-w-[200px]">
            <p className="text-xs text-[var(--text-tertiary)]">Última corrida del job diario</p>
            <p className="text-sm text-[var(--text-primary)]">
              {job?.last_run ?? "Sin datos"}
              {job?.last_status ? ` · ${job.last_status}` : ""}
            </p>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Un escaneo manual no actualiza esta fecha.
            </p>
          </div>
        </div>

        {Object.keys(summary?.by_signal ?? {}).length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-tertiary)]">Señales:</span>
            {Object.entries(summary?.by_signal ?? {})
              .sort(([, a], [, b]) => b - a)
              .map(([name, count]) => (
                <span
                  key={name}
                  className="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
                >
                  {SIGNAL_OPTIONS.find((option) => option.value === name)?.label ?? name}: {count}
                </span>
              ))}
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--text-secondary)]">
            Estado
            <select
              aria-label="Filtrar por estado"
              className="input text-xs mt-1 block"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                resetPage();
              }}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-[var(--text-secondary)]">
            Usuario
            <select
              aria-label="Filtrar por usuario"
              className="input text-xs mt-1 block"
              value={userId}
              onChange={(event) => {
                setUserId(event.target.value);
                resetPage();
              }}
            >
              <option value="">Todos</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-[var(--text-secondary)]">
            Score mínimo
            <input
              aria-label="Score mínimo"
              type="number"
              min="0"
              max="1"
              step="0.05"
              className="input text-xs mt-1 block w-20"
              value={minScore}
              onChange={(event) => {
                setMinScore(event.target.value);
                resetPage();
              }}
            />
          </label>

          <label className="text-xs text-[var(--text-secondary)]">
            Score máximo
            <input
              aria-label="Score máximo"
              type="number"
              min="0"
              max="1"
              step="0.05"
              className="input text-xs mt-1 block w-20"
              value={maxScore}
              onChange={(event) => {
                setMaxScore(event.target.value);
                resetPage();
              }}
            />
          </label>

          <label className="text-xs text-[var(--text-secondary)]">
            Señal
            <select
              aria-label="Filtrar por señal"
              className="input text-xs mt-1 block"
              value={signal}
              onChange={(event) => {
                setSignal(event.target.value);
                resetPage();
              }}
            >
              <option value="">Todas</option>
              {SIGNAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-[var(--text-secondary)]">
            Gasto desde
            <input
              aria-label="Fecha desde"
              type="date"
              className="input text-xs mt-1 block"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                resetPage();
              }}
            />
          </label>

          <label className="text-xs text-[var(--text-secondary)]">
            Gasto hasta
            <input
              aria-label="Fecha hasta"
              type="date"
              className="input text-xs mt-1 block"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                resetPage();
              }}
            />
          </label>

          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchInput.trim());
              resetPage();
            }}
          >
            <label className="text-xs text-[var(--text-secondary)]">
              Comercio
              <input
                aria-label="Buscar comercio"
                type="search"
                placeholder="Buscar en la lista"
                className="input text-xs mt-1 block"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </label>
            <button type="submit" className="gnome-btn-secondary-round text-xs">
              Buscar
            </button>
          </form>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border-color)] pt-3">
          <label className="text-xs text-[var(--text-secondary)]">
            Aceptar en masa desde score
            <input
              aria-label="Umbral de aceptación masiva"
              type="number"
              min="0.5"
              max="1"
              step="0.05"
              className="input text-xs mt-1 block w-20"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="gnome-btn-secondary-round text-xs"
            onClick={() => setBulkOpen(true)}
          >
            Aceptar ≥ umbral
          </button>
          <button
            type="button"
            className="gnome-btn-secondary-round text-xs disabled:opacity-50"
            onClick={handleExport}
            disabled={exporting}
          >
            Exportar CSV
          </button>

          <div className="ml-auto flex items-end gap-2">
            <label className="text-xs text-[var(--text-secondary)]">
              Escanear usuario
              <select
                aria-label="Usuario a escanear"
                className="input text-xs mt-1 block"
                value={scanUserId}
                onChange={(event) => setScanUserId(event.target.value)}
              >
                <option value="">Seleccionar…</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={useLlm}
                onChange={(event) => setUseLlm(event.target.checked)}
              />
              Usar LLM
            </label>
            <button
              type="button"
              className="gnome-btn-primary-round text-xs disabled:opacity-50"
              onClick={() => scanMut.mutate()}
              disabled={!scanUserId || scanMut.isPending}
            >
              {scanMut.isPending ? "Escaneando…" : "Escanear ahora"}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)]">
          El escaneo es forward-only: revisa los gastos creados en la ventana reciente del job. No
          reprocesa histórico.
        </p>
      </div>

      <div className="card p-0 overflow-x-auto">
        {reviewsQuery.isLoading ? (
          <p className="p-4 text-sm text-[var(--text-secondary)]">Cargando revisiones…</p>
        ) : total === 0 ? (
          <EmptyState
            icon="search"
            title="No hay revisiones para estos filtros"
            description="Si el detector nunca corrió para este usuario, revisá que la flag categorization_review_enabled esté activa."
          />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-color)] text-left text-[var(--text-tertiary)]">
                <th className="p-2">Fecha</th>
                <th className="p-2">Comercio</th>
                <th className="p-2">Monto</th>
                <th className="p-2">Categoría</th>
                <th className="p-2">Score</th>
                <th className="p-2">Estado</th>
                <th className="p-2">Acciones</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((review) => (
                <ReviewRow
                  key={review.id}
                  review={review}
                  expanded={expandedId === review.id}
                  detail={expandedId === review.id ? detailQuery.data : undefined}
                  detailLoading={expandedId === review.id && detailQuery.isLoading}
                  onToggle={() => setExpandedId(expandedId === review.id ? null : review.id)}
                  onExpand={() => setExpandedId(review.id)}
                  onAccept={() => acceptMut.mutate({ id: review.id })}
                  onAcceptWithCategory={(categoryId) =>
                    acceptMut.mutate({ id: review.id, categoryId })
                  }
                  onReject={() => setRejectTarget(review)}
                  onInvestigate={() => investigateMut.mutate(review.id)}
                  busy={acceptMut.isPending || rejectMut.isPending || investigateMut.isPending}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
        <span>
          {total} revisiones · página {data?.page ?? page}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="gnome-btn-secondary-round text-xs disabled:opacity-50"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
          >
            Anterior
          </button>
          <button
            type="button"
            className="gnome-btn-secondary-round text-xs disabled:opacity-50"
            onClick={() => setPage((current) => current + 1)}
            disabled={page * PER_PAGE >= total}
          >
            Siguiente
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={rejectTarget !== null}
        title="Rechazar revisión"
        message="Se marca como falso positivo del detector. El gasto conserva su categoría."
        confirmLabel="Rechazar"
        onCancel={() => setRejectTarget(null)}
        onConfirm={() => {
          if (rejectTarget) rejectMut.mutate(rejectTarget.id);
          setRejectTarget(null);
        }}
      />

      <ConfirmDialog
        isOpen={bulkOpen}
        title="Aceptar en masa"
        message={
          `Se aplicará la categoría sugerida a las revisiones pendientes con score ≥ ${threshold}` +
          (userId ? " del usuario seleccionado" : " de todos los usuarios") +
          ", hasta 50 por vez. Las aceptadas en masa no cuentan para la precisión manual."
        }
        confirmLabel="Aceptar"
        variant="primary"
        onCancel={() => setBulkOpen(false)}
        onConfirm={() => bulkMut.mutate()}
      />
    </div>
  );
}

interface ReviewRowProps {
  review: CategorizationReview;
  expanded: boolean;
  detail?: CategorizationReviewDetail;
  detailLoading: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onAccept: () => void;
  onAcceptWithCategory: (categoryId: number) => void;
  onReject: () => void;
  onInvestigate: () => void;
  busy: boolean;
}

function ReviewRow({
  review,
  expanded,
  detail,
  detailLoading,
  onToggle,
  onExpand,
  onAccept,
  onAcceptWithCategory,
  onReject,
  onInvestigate,
  busy,
}: ReviewRowProps) {
  const pending = review.status === "pending";
  const needsCategory = review.suggested_category_id === null;

  return (
    <>
      <tr className="border-b border-[var(--border-color)] align-top">
        <td className="p-2 whitespace-nowrap">{formatDate(review.date)}</td>
        <td className="p-2">{review.description ?? "—"}</td>
        <td className="p-2 whitespace-nowrap">{formatAmount(review.amount, review.currency)}</td>
        <td className="p-2">
          {review.current_category_name ?? "—"}
          {" → "}
          {review.suggested_category_name ?? "sin sugerencia"}
        </td>
        <td className="p-2">{review.score.toFixed(2)}</td>
        <td className="p-2">{STATUS_LABELS[review.status] ?? review.status}</td>
        <td className="p-2">
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="gnome-btn-primary-round text-[11px] disabled:opacity-50"
              disabled={!pending || busy}
              onClick={needsCategory ? onExpand : onAccept}
              aria-label={`Aceptar ${review.description ?? review.id}`}
            >
              {needsCategory ? "Elegir…" : "Aceptar"}
            </button>
            <button
              type="button"
              className="gnome-btn-secondary-round text-[11px] disabled:opacity-50"
              disabled={!pending || busy}
              onClick={onReject}
              aria-label={`Rechazar ${review.description ?? review.id}`}
            >
              Rechazar
            </button>
            <button
              type="button"
              className="gnome-btn-secondary-round text-[11px] disabled:opacity-50"
              disabled={!pending || busy}
              onClick={onInvestigate}
              aria-label={`Investigar ${review.description ?? review.id}`}
            >
              Investigar
            </button>
          </div>
        </td>
        <td className="p-2">
          <button
            type="button"
            className="gnome-btn-secondary-round text-[11px]"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`Ver evidencia ${review.id}`}
          >
            {expanded ? "Ocultar" : "Ver"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <td colSpan={8} className="p-3">
            {detailLoading || !detail ? (
              <p className="text-xs text-[var(--text-secondary)]">Cargando evidencia…</p>
            ) : (
              <ReviewEvidence review={detail} onAcceptWithCategory={onAcceptWithCategory} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}
