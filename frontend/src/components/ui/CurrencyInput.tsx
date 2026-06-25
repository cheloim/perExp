import { useState, useEffect } from "react";

export function parseCurrency(s: string): number | null {
  const clean = s.trim();
  if (!clean) return null;
  let normalized: string;
  if (clean.includes(".") && clean.includes(",")) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if (clean.includes(",")) {
    normalized = clean.replace(",", ".");
  } else {
    normalized = clean.replace(/\./g, "");
  }
  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
}

export function formatCurrencyAR(n: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatWhileTyping(s: string): string {
  const clean = s.replace(/[^\d,]/g, "");
  const [intPart, ...rest] = clean.split(",");
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return rest.length > 0 ? `${intFormatted},${rest.join("")}` : intFormatted;
}

export function CurrencyInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  const isEmpty = (v: number | null) => v === null || v === 0;
  const [raw, setRaw] = useState(isEmpty(value) ? "" : formatCurrencyAR(value!));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(isEmpty(value) ? "" : formatCurrencyAR(value!));
  }, [value, focused]);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setFocused(true);
    if (isEmpty(value)) setRaw("");
    setTimeout(() => e.target.select(), 0);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatWhileTyping(e.target.value);
    setRaw(formatted);
    onChange(parseCurrency(formatted));
  };

  const handleBlur = () => {
    setFocused(false);
    const parsed = parseCurrency(raw);
    onChange(parsed);
    setRaw(isEmpty(parsed) ? "" : formatCurrencyAR(parsed!));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      placeholder={placeholder ?? "0,00"}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
    />
  );
}
