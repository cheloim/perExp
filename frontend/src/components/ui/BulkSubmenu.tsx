interface BulkSubmenuProps {
  label: string;
  children: React.ReactNode;
  onClear?: () => void;
}

export function BulkSubmenu({ label, children, onClear }: BulkSubmenuProps) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs text-[var(--text-tertiary)]">{label}</span>
      {children}
      {onClear && (
        <>
          <div className="border-t border-[var(--border-color)]" />
          <button
            onClick={onClear}
            className="w-full px-3 py-2 text-sm text-left text-[var(--text-tertiary)] hover:bg-[var(--color-base-alt)] rounded-md transition-colors"
          >
            Limpiar {label.toLowerCase()}
          </button>
        </>
      )}
    </div>
  );
}
