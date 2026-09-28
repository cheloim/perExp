/**
 * Skeleton loading placeholder — Adwaita spinner pattern
 * GNOME HIG Spinners: "for indeterminate progress"
 * Use these to show layout shape while data loads.
 */

interface SkeletonProps {
  className?: string;
  /** Border radius variant */
  variant?: "default" | "circle" | "text";
}

export default function Skeleton({ className = "", variant = "default" }: SkeletonProps) {
  const radius = variant === "circle" ? "rounded-full" : variant === "text" ? "rounded" : "rounded-lg";

  return (
    <div
      className={`bg-[var(--color-base-alt)] animate-pulse ${radius} ${className}`}
      aria-hidden="true"
    />
  );
}

/** Pre-built skeleton for a card with title + content lines */
export function SkeletonCard({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`card p-4 space-y-3 ${className}`} aria-label="Cargando...">
      <Skeleton className="h-4 w-1/3" variant="text" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" variant="text" />
      ))}
    </div>
  );
}

/** Pre-built skeleton for a table row */
export function SkeletonRow({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 py-3 ${className}`} aria-hidden="true">
      <Skeleton className="w-8 h-8" variant="circle" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-2/3" variant="text" />
        <Skeleton className="h-2.5 w-1/3" variant="text" />
      </div>
      <Skeleton className="h-4 w-16" variant="text" />
    </div>
  );
}

/** Pre-built skeleton for a chart area */
export function SkeletonChart({ height = "h-48", className = "" }: { height?: string; className?: string }) {
  return (
    <div className={`card p-4 ${className}`} aria-label="Cargando gráfico...">
      <Skeleton className="h-4 w-1/4 mb-4" variant="text" />
      <Skeleton className={height} />
    </div>
  );
}
