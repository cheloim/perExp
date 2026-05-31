import React from 'react'

export interface TextSegment {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  positive?: boolean
  negative?: boolean
  primary?: boolean
}

function parseSegments(line: string): TextSegment[] {
  const segments: TextSegment[] = []
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let lastIndex = 0

  const matches = line.matchAll(regex)
  for (const match of matches) {
    if (match.index === undefined) continue
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index) })
    }
    const m = match[0]
    if (m.startsWith('**') && m.endsWith('**')) {
      segments.push({ text: m.slice(2, -2), bold: true })
    } else if (m.startsWith('*') && m.endsWith('*')) {
      segments.push({ text: m.slice(1, -1), italic: true })
    } else if (m.startsWith('`') && m.endsWith('`')) {
      segments.push({ text: m.slice(1, -1), code: true })
    }
    lastIndex = match.index + m.length
  }

  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex) })
  }

  if (segments.length === 0) {
    segments.push({ text: line })
  }

  return segments
}

function renderSegment(seg: TextSegment, idx: number): React.ReactNode {
  let className = ''
  if (seg.bold) className += 'font-semibold text-[var(--text-primary)] '
  if (seg.italic) className += 'italic '
  if (seg.code) className += 'font-mono text-[var(--color-primary)] bg-[var(--color-base-alt)] px-1 rounded '
  if (seg.positive) className += 'text-[var(--gnome-green-5)] '
  if (seg.negative) className += 'text-[var(--gnome-red-3)] '
  if (seg.primary) className += 'text-[var(--color-primary)] '

  if (seg.bold) className += 'text-[var(--text-primary)]'
  else className += 'text-[var(--text-secondary)]'

  const classNameFinal = className.trim() || 'text-[var(--text-secondary)]'
  return (
    <span key={idx} className={classNameFinal}>
      {seg.text}
    </span>
  )
}

function processLine(line: string, lineIdx: number): React.ReactNode {
  const trimmed = line.trim()

  if (!trimmed) return <br key={lineIdx} />

  if (trimmed.startsWith('↑') || trimmed.startsWith('+') || trimmed.startsWith('📈')) {
    return (
      <p key={lineIdx} className="text-[var(--gnome-green-5)] font-medium mb-1">
        {line}
      </p>
    )
  }
  if (trimmed.startsWith('↓') || trimmed.startsWith('-') || trimmed.startsWith('📉')) {
    return (
      <p key={lineIdx} className="text-[var(--gnome-red-3)] font-medium mb-1">
        {line}
      </p>
    )
  }
  if (trimmed.startsWith('💡') || trimmed.startsWith('✅')) {
    return (
      <p key={lineIdx} className="text-[var(--color-primary)] font-medium mb-1">
        {line}
      </p>
    )
  }
  if (trimmed.startsWith('⚠') || trimmed.startsWith('🚨')) {
    return (
      <p key={lineIdx} className="text-[var(--gnome-yellow-4)] font-medium mb-1">
        {line}
      </p>
    )
  }

  if (trimmed.startsWith('## ') || trimmed.startsWith('### ') || trimmed.startsWith('#### ')) {
    const level = trimmed.startsWith('#### ') ? 4 : trimmed.startsWith('### ') ? 3 : trimmed.startsWith('## ') ? 2 : 1
    const text = trimmed.replace(/^#{1,4}\s*/, '')
    return (
      <p key={lineIdx} className={`font-semibold text-[var(--text-primary)] mb-2 ${level === 1 ? 'text-lg' : level === 2 ? 'text-base' : 'text-sm'}`}>
        {text}
      </p>
    )
  }

  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    const text = trimmed.slice(2)
    const segments = parseSegments(text)
    return (
      <p key={lineIdx} className="mb-1 pl-3">
        <span className="text-[var(--text-tertiary)] mr-1">•</span>
        {segments.map((seg, i) => renderSegment(seg, i))}
      </p>
    )
  }

  if (trimmed.match(/^\d+\.\s/)) {
    const text = trimmed.replace(/^\d+\.\s/, '')
    const segments = parseSegments(text)
    return (
      <p key={lineIdx} className="mb-1 pl-3">
        <span className="text-[var(--text-tertiary)] mr-1">{trimmed.match(/^\d+/)?.[0]}.</span>
        {segments.map((seg, i) => renderSegment(seg, i))}
      </p>
    )
  }

  const boldMatch = trimmed.match(/^(.+?):(.*)$/)
  if (boldMatch && !trimmed.includes('**')) {
    return (
      <p key={lineIdx} className="mb-1">
        <span className="font-semibold text-[var(--text-primary)]">{boldMatch[1]}:</span>
        <span className="text-[var(--text-secondary)]">{boldMatch[2]}</span>
      </p>
    )
  }

  const usdMatch = line.match(/(u?s\$\d+[\d.,]*)/g)
  if (usdMatch) {
    const parts = line.split(/(\s*u?s\$\d+[\d.,]*\s*)/g)
    return (
      <p key={lineIdx} className="text-[var(--text-secondary)] mb-1">
        {parts.map((part, i) => {
          if (part.match(/u?s\$\d+[\d.,]*/)) {
            return <span key={i} className="font-mono text-[var(--color-primary)]">{part}</span>
          }
          const segs = parseSegments(part)
          return segs.map((seg, j) => renderSegment(seg, j))
        })}
      </p>
    )
  }

  const arsMoneyMatch = line.match(/(\$\d+[\d.,]*)/g)
  if (arsMoneyMatch) {
    const parts = line.split(/(\$\d+[\d.,]*)/g)
    return (
      <p key={lineIdx} className="text-[var(--text-secondary)] mb-1">
        {parts.map((part, i) => {
          if (part.match(/\$\d+[\d.,]*/)) {
            return <span key={i} className="font-mono">{part}</span>
          }
          const segs = parseSegments(part)
          return segs.map((seg, j) => renderSegment(seg, j))
        })}
      </p>
    )
  }

  const pctMatch = line.match(/(\d+[,.]?\d*%)/)
  if (pctMatch) {
    const parts = line.split(/(\d+[,.]?\d*%)/g)
    return (
      <p key={lineIdx} className="text-[var(--text-secondary)] mb-1">
        {parts.map((part, i) => {
          if (part.match(/\d+[,.]?\d*%/)) {
            const isPositive = !part.startsWith('-')
            return <span key={i} className={isPositive ? 'text-[var(--gnome-green-5)]' : 'text-[var(--gnome-red-3)]'}>{part}</span>
          }
          const segs = parseSegments(part)
          return segs.map((seg, j) => renderSegment(seg, j))
        })}
      </p>
    )
  }

  const tickerMatch = line.match(/\b([A-Z]{2,5})\b/g)
  if (tickerMatch && tickerMatch.length > 0) {
    const parts = line.split(/(\b[A-Z]{2,5}\b)/g)
    return (
      <p key={lineIdx} className="text-[var(--text-secondary)] mb-1">
        {parts.map((part, i) => {
          if (tickerMatch.includes(part)) {
            return <span key={i} className="font-mono text-[var(--color-primary)] font-medium">{part}</span>
          }
          const segs = parseSegments(part)
          return segs.map((seg, j) => renderSegment(seg, j))
        })}
      </p>
    )
  }

  const mdBoldMatch = trimmed.match(/\*\*/g)
  if (mdBoldMatch) {
    const parts = line.split(/(\*\*.+?\*\*|\*[^*]+\*)/g)
    return (
      <p key={lineIdx} className="text-[var(--text-secondary)] mb-1">
        {parts.map((part, i) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} className="font-semibold text-[var(--text-primary)]">{part.slice(2, -2)}</strong>
          }
          if (part.startsWith('*') && part.endsWith('*')) {
            return <em key={i} className="italic">{part.slice(1, -1)}</em>
          }
          return part
        })}
      </p>
    )
  }

  return <p key={lineIdx} className="text-[var(--text-secondary)] mb-1">{line}</p>
}

export function formatMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  return lines.map((line, lineIdx) => processLine(line, lineIdx))
}

export function formatAIResponse(text: string): React.ReactNode {
  return formatMarkdown(text)
}