import { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'

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
  const [portalPos, setPortalPos] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  useEffect(() => {
    if (isOpen && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setPortalPos({
        top: rect.top + window.scrollY,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      })
      inputRef.current.focus()
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

  const filteredOptions = search
    ? options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
    : options

  const handleSelect = (val: string) => {
    onSelect(val)
    setIsOpen(false)
    setSearch('')
  }

  const dropdownContent = isOpen && portalPos && (
    <div
      className="bg-[var(--color-surface)] border border-[var(--border-color)] rounded-md shadow-lg max-h-40 overflow-y-auto"
      style={{
        position: 'fixed',
        top: portalPos.top + portalPos.height,
        left: portalPos.left,
        width: portalPos.width,
        zIndex: 99999,
      }}
    >
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
  )

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

      {isOpen && portalPos && ReactDOM.createPortal(dropdownContent, document.body)}
    </div>
  )
}