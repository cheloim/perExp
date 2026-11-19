import type { ReactNode } from "react";
import EmptyState from "./EmptyState";
import { SkeletonCard } from "./Skeleton";

interface QueryErrorBannerProps {
  message?: string;
  onRetry?: () => void;
}

/** Inline error that keeps the previous data visible. */
export function QueryErrorBanner({
  message = "No pudimos actualizar estos datos.",
  onRetry,
}: QueryErrorBannerProps) {
  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-4 py-3"
    >
      <p className="text-sm text-[var(--text-primary)]">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-semibold text-[var(--color-primary)] hover:underline"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}

interface QueryStateProps {
  isLoading?: boolean;
  isError?: boolean;
  /** True when the query already has data to keep on screen. */
  hasData?: boolean;
  onRetry?: () => void;
  errorMessage?: string;
  skeleton?: ReactNode;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: { label: string; onClick: () => void };
  children: ReactNode;
}

/**
 * The four states a read query can be in, visually distinct:
 * loading (skeleton), error (retry), empty (message) and success.
 *
 * A number is never rendered as zero while the query is unresolved: callers
 * pass `isLoading` and the skeleton wins until the first payload arrives.
 */
export default function QueryState({
  isLoading = false,
  isError = false,
  hasData = false,
  onRetry,
  errorMessage,
  skeleton,
  isEmpty = false,
  emptyTitle = "No hay datos todavía",
  emptyDescription,
  emptyAction,
  children,
}: QueryStateProps) {
  const message =
    errorMessage ??
    (hasData ? "No pudimos actualizar estos datos." : "No pudimos cargar estos datos.");

  if (isLoading && !hasData) {
    return <>{skeleton ?? <SkeletonCard lines={4} />}</>;
  }

  if (isError && !hasData) {
    return (
      <div className="card p-6" role="alert">
        <p className="font-medium text-primary">{message}</p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          Revisá tu conexión y volvé a intentar.
        </p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="gnome-btn-primary mt-4 text-sm">
            Reintentar
          </button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className="card"
      />
    );
  }

  return (
    <>
      {isError && <QueryErrorBanner message={message} onRetry={onRetry} />}
      {children}
    </>
  );
}
