import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectGroup {
  label: string;
  options: MultiSelectOption[];
}

interface MultiSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  /** Standalone options rendered before the groups (e.g. "Sin categoría"). */
  options?: MultiSelectOption[];
  groups?: MultiSelectGroup[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
}

const DROPDOWN_HEIGHT = 320;

/**
 * Checkbox-style multi-select with the same Adwaita chrome as `Select`.
 *
 * Picking an option does NOT close the list: the whole point is choosing
 * several in a row. It is a listbox — not a menu — so screen readers announce
 * each option's selected state.
 */
export function MultiSelect({
  values,
  onChange,
  options = [],
  groups = [],
  placeholder = "",
  className = "",
  disabled = false,
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownPos, setDropdownPos] = useState<DropdownPosition | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allOptions = useMemo(
    () => [...options, ...groups.flatMap((group) => group.options)],
    [options, groups],
  );

  const selectedLabels = values
    .map((value) => allOptions.find((option) => option.value === value)?.label)
    .filter((label): label is string => Boolean(label));

  const displayValue =
    values.length === 0
      ? placeholder
      : values.length === 1
        ? (selectedLabels[0] ?? placeholder)
        : `${values.length} categorías`;

  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return groups;
    return groups
      .map((group) => {
        const groupMatches = group.label.toLowerCase().includes(term);
        return {
          ...group,
          options: groupMatches
            ? group.options
            : group.options.filter((option) => option.label.toLowerCase().includes(term)),
        };
      })
      .filter((group) => group.options.length > 0);
  }, [groups, search]);

  const filteredStandalone = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => option.label.toLowerCase().includes(term));
  }, [options, search]);

  const flatOptions = useMemo(
    () => [...filteredStandalone, ...filteredGroups.flatMap((group) => group.options)],
    [filteredStandalone, filteredGroups],
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch("");
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < DROPDOWN_HEIGHT && rect.top > DROPDOWN_HEIGHT;
    setDropdownPos({
      top: openAbove ? rect.top - DROPDOWN_HEIGHT - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [search]);

  const toggle = useCallback(
    (value: string) => {
      onChange(
        values.includes(value)
          ? values.filter((selected) => selected !== value)
          : [...values, value],
      );
    },
    [onChange, values],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setSearch("");
    setHighlightedIndex(-1);
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!isOpen) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") {
          event.preventDefault();
          setIsOpen(true);
          setHighlightedIndex(0);
        }
        return;
      }
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setHighlightedIndex((prev) => (prev < flatOptions.length - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
          event.preventDefault();
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : flatOptions.length - 1));
          break;
        case "Enter":
        case " ":
          if (highlightedIndex >= 0 && highlightedIndex < flatOptions.length) {
            event.preventDefault();
            toggle(flatOptions[highlightedIndex].value);
          }
          break;
        case "Escape":
          event.preventDefault();
          close();
          break;
      }
    },
    [isOpen, flatOptions, highlightedIndex, toggle, close],
  );

  const optionButton = (option: MultiSelectOption, index: number) => {
    const selected = values.includes(option.value);
    return (
      <button
        key={option.value}
        type="button"
        role="option"
        aria-selected={selected}
        data-option
        onClick={() => toggle(option.value)}
        onMouseEnter={() => setHighlightedIndex(index)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition ${
          highlightedIndex === index ? "bg-[var(--color-base-alt)]" : ""
        } ${selected ? "text-[var(--text-primary)] font-medium" : "text-[var(--text-secondary)]"}`}
      >
        <span
          aria-hidden="true"
          className={`flex items-center justify-center w-4 h-4 rounded border flex-shrink-0 ${
            selected
              ? "bg-[var(--color-primary-strong)] border-[var(--color-primary-strong)] text-[var(--color-on-primary-strong)]"
              : "border-[var(--border-color)]"
          }`}
        >
          {selected && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
        </span>
        <span className="truncate">{option.label}</span>
      </button>
    );
  };

  let flatIndex = 0;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition flex items-center justify-between gap-2 ${
          disabled
            ? "opacity-50 cursor-not-allowed"
            : "cursor-pointer hover:border-[var(--color-primary)]"
        }`}
      >
        <span
          className={`truncate text-left ${values.length === 0 ? "text-[var(--text-tertiary)]" : ""}`}
        >
          {displayValue}
        </span>
        <svg
          className={`w-4 h-4 text-[var(--text-secondary)] transition-transform flex-shrink-0 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && dropdownPos && (
        <div
          className="fixed z-[9999] bg-[var(--color-surface)] border border-[var(--border-color)] rounded-md shadow-lg overflow-hidden max-h-80 flex flex-col"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          <div className="p-2 border-b border-[var(--border-color)]">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Buscar categorías"
              placeholder="Buscar…"
              className="w-full text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition placeholder:text-[var(--text-tertiary)]"
            />
          </div>

          <div
            role="listbox"
            aria-multiselectable="true"
            aria-label={placeholder}
            className="overflow-y-auto flex-1"
          >
            {filteredStandalone.map((option) => optionButton(option, flatIndex++))}

            {filteredGroups.map((group) => (
              <div
                key={group.label}
                role="group"
                aria-label={group.label === "—" ? undefined : group.label}
              >
                {group.label !== "—" && (
                  <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                    {group.label}
                  </p>
                )}
                {group.options.map((option) => optionButton(option, flatIndex++))}
              </div>
            ))}

            {flatOptions.length === 0 && (
              <p className="px-3 py-3 text-sm text-[var(--text-tertiary)]">Sin resultados</p>
            )}
          </div>

          {values.length > 0 && (
            <div className="p-2 border-t border-[var(--border-color)]">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full text-xs text-center px-2 py-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition-colors"
              >
                Limpiar selección
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
