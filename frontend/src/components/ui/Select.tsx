import { useState, useRef, useEffect, useCallback, useMemo } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectOptionGroup[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  direction?: "down" | "up";
  allowCustomValue?: boolean;
}

export function Select({
  value,
  onChange,
  options = [],
  groups = [],
  placeholder = "",
  className = "",
  disabled = false,
  direction = "down",
  allowCustomValue = true,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const allOptions = [...options, ...groups.flatMap((g) => g.options)];
  const selectedOption = [...options, ...groups.flatMap((g) => g.options)].find(
    (o) => o.value === value,
  );
  const displayValue =
    selectedOption?.label || (value && !selectedOption ? value : placeholder) || "";

  const filteredOptions = search
    ? allOptions.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          o.value.toLowerCase().includes(search.toLowerCase()),
      )
    : allOptions;

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      setIsOpen(false);
      setSearch("");
      setHighlightedIndex(-1);
    },
    [onChange],
  );

  const handleCustomValue = useCallback(() => {
    if (search.trim()) {
      onChange(search.trim());
      setIsOpen(false);
      setSearch("");
      setHighlightedIndex(-1);
    }
  }, [onChange, search]);

  const flatOptions = useMemo(() => {
    const result: { value: string; label: string }[] = [];
    if (placeholder) result.push({ value: "", label: placeholder });
    // Add standalone options (filtered)
    filteredOptions.forEach((o) => result.push(o));
    // Add group options (only when groups exist, since they're not in filteredOptions)
    if (groups.length > 0) {
      groups.forEach((group) => {
        const groupMatches = !search || group.label.toLowerCase().includes(search.toLowerCase());
        const groupFiltered = group.options.filter(
          (o) =>
            groupMatches ||
            o.label.toLowerCase().includes(search.toLowerCase()) ||
            o.value.toLowerCase().includes(search.toLowerCase()),
        );
        groupFiltered.forEach((o) => result.push(o));
      });
    }
    return result;
  }, [filteredOptions, groups, search, placeholder]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
          e.preventDefault();
          setIsOpen(true);
          setHighlightedIndex(0);
        }
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((prev) => (prev < flatOptions.length - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : flatOptions.length - 1));
          break;
        case "Enter":
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < flatOptions.length) {
            handleSelect(flatOptions[highlightedIndex].value);
          } else if (search.trim() && allowCustomValue) {
            handleCustomValue();
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          setSearch("");
          setHighlightedIndex(-1);
          break;
      }
    },
    [
      isOpen,
      highlightedIndex,
      flatOptions,
      search,
      allowCustomValue,
      handleCustomValue,
      handleSelect,
    ],
  );

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [search]);

  useEffect(() => {
    if (listRef.current && highlightedIndex >= 0) {
      const items = listRef.current.querySelectorAll("[data-option]");
      items[highlightedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        className={`w-full text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition flex items-center justify-between ${
          disabled
            ? "opacity-50 cursor-not-allowed"
            : "cursor-pointer hover:border-[var(--color-primary)]"
        }`}
      >
        <span className={value ? "" : "text-[var(--text-tertiary)]"}>{displayValue}</span>
        <svg
          className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          className={`absolute z-50 w-full bg-[var(--color-surface)] border border-[var(--border-color)] rounded-md shadow-lg overflow-hidden max-h-60 flex flex-col ${
            direction === "up" ? "bottom-full mb-1" : "mt-1 top-full"
          }`}
        >
          <div className="p-2 border-b border-[var(--border-color)]">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar o escribir..."
              className="w-full text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition placeholder:text-[var(--text-tertiary)]"
              onKeyDown={handleKeyDown}
            />
          </div>

          <div ref={listRef} className="overflow-y-auto flex-1">
            {placeholder && (
              <button
                type="button"
                data-option
                onClick={() => handleSelect("")}
                className={`w-full px-3 py-2 text-left text-sm transition ${
                  highlightedIndex === 0
                    ? "bg-[var(--color-base-alt)]"
                    : "text-[var(--text-tertiary)] hover:bg-[var(--color-base-alt)]"
                }`}
              >
                {placeholder}
              </button>
            )}

            {allowCustomValue &&
              search.trim() &&
              !allOptions.some((o) => o.label.toLowerCase() === search.toLowerCase()) && (
                <button
                  type="button"
                  data-option
                  onClick={handleCustomValue}
                  className="w-full px-3 py-2 text-left text-sm text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition font-medium border-b border-[var(--border-color)]"
                >
                  Usar: "{search.trim()}"
                </button>
              )}

            {/* Render standalone options (always, before groups) */}
            {options.length > 0 &&
              options.map((option) => {
                const flatIdx = flatOptions.findIndex((o) => o.value === option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    data-option
                    onClick={() => handleSelect(option.value)}
                    className={`w-full px-3 py-2 text-left text-sm transition ${
                      highlightedIndex === flatIdx
                        ? "bg-[var(--color-base-alt)]"
                        : value === option.value
                        ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                        : "text-[var(--text-primary)] hover:bg-[var(--color-base-alt)]"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}

            {/* Render grouped options with headers */}
            {groups.length > 0 &&
              groups.map((group) => {
                const groupMatches =
                  !search || group.label.toLowerCase().includes(search.toLowerCase());
                const groupFiltered = group.options.filter(
                  (o) =>
                    groupMatches ||
                    o.label.toLowerCase().includes(search.toLowerCase()) ||
                    o.value.toLowerCase().includes(search.toLowerCase()),
                );
                if (groupFiltered.length === 0) return null;
                return (
                  <div key={group.label}>
                    <div className="px-3 py-1.5 text-xs font-medium text-[var(--text-tertiary)] bg-[var(--color-base-alt)] border-t border-[var(--border-color)]">
                      {group.label}
                    </div>
                    {groupFiltered.map((option) => {
                      const flatIdx = flatOptions.findIndex((o) => o.value === option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          data-option
                          onClick={() => handleSelect(option.value)}
                          className={`w-full px-3 py-2 text-left text-sm transition ${
                            highlightedIndex === flatIdx
                              ? "bg-[var(--color-base-alt)]"
                              : value === option.value
                              ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                              : "text-[var(--text-primary)] hover:bg-[var(--color-base-alt)]"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                );
              })}

            {filteredOptions.length === 0 && groups.length === 0 && !search && (
              <div className="px-3 py-4 text-center text-sm text-[var(--text-tertiary)]">
                Sin opciones disponibles
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
