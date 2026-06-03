import { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'

interface SelectOption {
  value: string
  label: string
}

interface SelectOptionGroup {
  label: string
  options: SelectOption[]
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options?: SelectOption[]
  groups?: SelectOptionGroup[]
  placeholder?: string
  className?: string
  disabled?: boolean
  direction?: 'down' | 'up'
}

export function Select({
  value,
  onChange,
  options = [],
  groups = [],
  placeholder = '',
  className = '',
  disabled = false,
  direction = 'down',
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [portalPos, setPortalPos] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPortalPos({
        top: rect.top + window.scrollY,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      })
    }
  }, [isOpen])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const allOptions = [...options, ...groups.flatMap(g => g.options)]
  const selectedOption = allOptions.find(o => o.value === value)
  const displayValue = selectedOption?.label || (value && !selectedOption ? value : placeholder) || ''

  const filteredOptions = search
    ? allOptions.filter(o =>
        o.label.toLowerCase().includes(search.toLowerCase()) ||
        o.value.toLowerCase().includes(search.toLowerCase())
      )
    : allOptions

  const handleSelect = (val: string) => {
    onChange(val)
    setIsOpen(false)
    setSearch('')
  }

  const handleCustomValue = () => {
    if (search.trim()) {
      onChange(search.trim())
      setIsOpen(false)
      setSearch('')
    }
  }

  const dropdownContent = isOpen && portalPos && (
    <div
      className={`bg-[var(--color-surface)] border border-[var(--border-color)] rounded-md shadow-lg overflow-hidden max-h-60 flex flex-col`}
      style={{
        position: 'fixed',
        top: direction === 'up' ? portalPos.top : portalPos.top + portalPos.height,
        left: portalPos.left,
        width: portalPos.width,
        zIndex: 99999,
        transform: direction === 'up' ? 'translateY(-8px)' : 'none',
      }}
    >
      <div className="p-2 border-b border-[var(--border-color)]">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar o escribir..."
          className="w-full text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition placeholder:text-[var(--text-tertiary)]"
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleCustomValue()
            }
          }}
        />
      </div>

      <div className="overflow-y-auto flex-1">
        {placeholder && (
          <button
            type="button"
            onClick={() => handleSelect('')}
            className="w-full px-3 py-2 text-left text-sm text-[var(--text-tertiary)] hover:bg-[var(--color-base-alt)] transition"
          >
            {placeholder}
          </button>
        )}

        {search.trim() && !filteredOptions.some(o => o.label.toLowerCase() === search.toLowerCase()) && (
          <button
            type="button"
            onClick={handleCustomValue}
            className="w-full px-3 py-2 text-left text-sm text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition font-medium border-b border-[var(--border-color)]"
          >
            Usar: "{search.trim()}"
          </button>
        )}

        {filteredOptions.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleSelect(option.value)}
            className={`w-full px-3 py-2 text-left text-sm transition ${
              value === option.value
                ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium'
                : 'text-[var(--text-primary)] hover:bg-[var(--color-base-alt)]'
            }`}
          >
            {option.label}
          </button>
        ))}

        {groups.map(group => {
          const groupFiltered = group.options.filter(o =>
            !search ||
            o.label.toLowerCase().includes(search.toLowerCase()) ||
            o.value.toLowerCase().includes(search.toLowerCase())
          )
          if (groupFiltered.length === 0) return null
          return (
            <div key={group.label}>
              <div className="px-3 py-1.5 text-xs font-medium text-[var(--text-tertiary)] bg-[var(--color-base-alt)] border-t border-[var(--border-color)]">
                {group.label}
              </div>
              {groupFiltered.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`w-full px-3 py-2 text-left text-sm transition ${
                    value === option.value
                      ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium'
                      : 'text-[var(--text-primary)] hover:bg-[var(--color-base-alt)]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )
        })}

        {filteredOptions.length === 0 && !search && (
          <div className="px-3 py-4 text-center text-sm text-[var(--text-tertiary)]">
            Sin opciones disponibles
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition flex items-center justify-between ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-[var(--color-primary)]'
        }`}
      >
        <span className={value ? '' : 'text-[var(--text-tertiary)]'}>{displayValue}</span>
        <svg
          className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && portalPos && ReactDOM.createPortal(dropdownContent, document.body)}
    </div>
  )
}