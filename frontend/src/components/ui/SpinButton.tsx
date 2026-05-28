import { useState } from 'react'

interface SpinButtonProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label?: string
  className?: string
  disabled?: boolean
}

export function SpinButton({
  value,
  onChange,
  min = 0,
  max = 9999,
  step = 1,
  label,
  className = '',
  disabled = false,
}: SpinButtonProps) {
  const [focused, setFocused] = useState(false)

  const handleDecrement = () => {
    const newVal = value - step
    if (newVal >= min) onChange(newVal)
  }

  const handleIncrement = () => {
    const newVal = value + step
    if (newVal <= max) onChange(newVal)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(e.target.value, 10)
    if (!isNaN(parsed)) {
      if (parsed >= min && parsed <= max) onChange(parsed)
    }
  }

  const handleBlur = () => {
    setFocused(false)
    if (value < min) onChange(min)
    if (value > max) onChange(max)
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {label && (
        <span className="text-xs text-[var(--text-secondary)] font-medium mr-1 select-none">
          {label}
        </span>
      )}
      <div
        className={`
          flex items-center h-8 border rounded-md overflow-hidden transition-all
          ${focused ? 'border-[var(--color-primary)]' : 'border-[var(--border-color)]'}
          ${focused ? '[box-shadow:var(--focus-ring)]' : ''}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          bg-[var(--color-base-container)]
        `}
      >
        <button
          type="button"
          onClick={handleDecrement}
          disabled={disabled || value <= min}
          className="h-full px-2 flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-r border-[var(--border-color)]"
          aria-label="Decrementar"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={handleInputChange}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          disabled={disabled}
          className="w-14 h-full text-center text-sm text-[var(--text-primary)] bg-transparent focus:outline-none font-medium"
        />

        <button
          type="button"
          onClick={handleIncrement}
          disabled={disabled || value >= max}
          className="h-full px-2 flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-l border-[var(--border-color)]"
          aria-label="Incrementar"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}