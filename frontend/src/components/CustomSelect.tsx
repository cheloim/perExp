import { useState, useRef, useEffect } from 'react'

interface SelectOption {
  value: string | number
  label: string
}

interface CustomSelectProps {
  value: string | number | null
  onChange: (value: string | number | null) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
}

export function CustomSelect({ value, onChange, options, placeholder = 'Seleccionar...', className = '' }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Find selected option
  const selectedOption = options.find(opt => opt.value === value)

  const handleSelect = (optionValue: string | number | null) => {
    onChange(optionValue)
    setIsOpen(false)
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 rounded-md border border-[var(--border-color)] text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition text-left flex items-center justify-between"
      >
        <span className={selectedOption ? '' : 'text-[var(--text-tertiary)]'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <svg
          className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-md shadow-lg max-h-60 overflow-auto p-1">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              className={`w-full px-3 py-2 text-sm text-left transition-colors rounded-md ${
                option.value === value
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--text-primary)] hover:bg-[var(--color-base-alt)]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
