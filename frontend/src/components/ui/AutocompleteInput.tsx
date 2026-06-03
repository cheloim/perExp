import { useState, useRef, useEffect } from 'react'

interface AutocompleteInputProps {
  value: string
  onChange: (value: string) => void
  onSelect: (value: string) => void
  options: string[]
  placeholder?: string
}

export function AutocompleteInput({ value, onChange, onSelect, options, placeholder }: AutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredOptions = search
    ? options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
    : options

  const handleSelect = (val: string) => {
    onSelect(val)
    setIsOpen(false)
    setSearch('')
  }

  return (
    <div ref={ref} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={isOpen ? search : value}
        onChange={e => {
          setSearch(e.target.value)
          onChange(e.target.value)
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          setTimeout(() => {
            if (!ref.current?.contains(document.activeElement)) {
              setIsOpen(false)
              setSearch('')
            }
          }, 150)
        }}
        placeholder={placeholder || 'Escribir o seleccionar...'}
        className="w-full px-3 py-2 text-sm text-[var(--text-primary)] bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition placeholder:text-[var(--text-tertiary)]"
      />

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-md shadow-lg max-h-40 overflow-y-auto">
          {filteredOptions.length === 0 && !search ? (
            <div className="px-3 py-2 text-sm text-[var(--text-tertiary)]">
              No hay valores disponibles
            </div>
          ) : filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-[var(--text-tertiary)]">
              Sin resultados
            </div>
          ) : (
            filteredOptions.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => handleSelect(option)}
                className="w-full px-3 py-2 text-sm text-left text-[var(--text-primary)] hover:bg-[var(--color-base-alt)] transition-colors"
              >
                {option}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}