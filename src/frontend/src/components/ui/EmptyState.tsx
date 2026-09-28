import SymbolicIcon from "../SymbolicIcon";
import type { IconName } from "../SymbolicIcon";

interface EmptyStateProps {
  /** Symbolic icon name (GNOME HIG: symbolic style for secondary empty states) */
  icon?: IconName;
  /** Illustration variant — for main app views when empty (GNOME HIG: AdwStatusPage) */
  variant?: "symbolic" | "illustration";
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

/**
 * Empty state — Adwaita StatusPage (Placeholder Pages) pattern
 * GNOME HIG: "illustration style for main view when empty;
 * symbolic style for secondary empty spaces"
 *
 * Use variant="illustration" for the main view's first empty state.
 * Use variant="symbolic" (default) for secondary empty spaces.
 */
export default function EmptyState({
  icon,
  variant = "symbolic",
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  const isIllustration = variant === "illustration";

  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-8 ${className}`}
      aria-label={title}
    >
      {icon && (
        <div
          className={`mb-3 flex items-center justify-center ${
            isIllustration
              ? "w-16 h-16 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
              : "text-[var(--text-tertiary)]"
          }`}
        >
          <SymbolicIcon name={icon} size={isIllustration ? 32 : 24} />
        </div>
      )}
      <p
        className={`font-medium ${
          isIllustration
            ? "text-base text-[var(--text-primary)]"
            : "text-sm text-[var(--text-secondary)]"
        }`}
      >
        {title}
      </p>
      {description && (
        <p className="text-xs text-[var(--text-tertiary)] mt-1 max-w-xs">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className={`mt-3 font-semibold transition-colors ${
            isIllustration
              ? "gnome-btn-primary-round text-sm px-4 py-2"
              : "text-xs text-[var(--color-primary)] hover:underline"
          }`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
