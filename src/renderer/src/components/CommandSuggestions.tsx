import React, { useCallback, useEffect, useRef, useState } from 'react'

interface CommandSuggestionsProps {
  onSelectSuggestion: (text: string) => void
  disabled?: boolean
}

const SUGGESTIONS: { text: string; lang?: string }[] = [
  { text: 'Ngày mai tôi có lịch gì?' },
  { text: 'Chiều mai lúc 3 giờ họp với A' },
  { text: 'Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ' },
  { text: 'Xóa cuộc họp lúc 3 giờ chiều ngày mai' },
  { text: 'What do I have tomorrow?', lang: 'en' }
]

/** Pixels per wheel "line" when the device reports lines instead of pixels. */
const WHEEL_LINE_PX = 16

export const CommandSuggestions: React.FC<CommandSuggestionsProps> = ({
  onSelectSuggestion,
  disabled
}) => {
  const listRef = useRef<HTMLDivElement>(null)
  // Which edges of the sideways-scrolling row hide more chips (drives the edge fades in main.css).
  const [more, setMore] = useState({ start: false, end: false })

  const updateEdges = useCallback((): void => {
    const el = listRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const start = max > 1 && el.scrollLeft > 1
    const end = max > 1 && el.scrollLeft < max - 1
    setMore((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  // ResizeObserver also reports the initial size, so this sets the first state too.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const observer = new ResizeObserver(updateEdges)
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateEdges])

  // A plain mouse wheel only scrolls vertically: turn it into sideways scrolling while the row overflows.
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (e.shiftKey || el.scrollWidth <= el.clientWidth) return
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    el.scrollLeft += e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaY
  }

  return (
    <section className="suggestions-container" aria-label="Câu lệnh mẫu">
      <h2 className="panel-title">Câu lệnh mẫu</h2>
      <div
        ref={listRef}
        className={`suggestion-list${more.start ? ' has-more-start' : ''}${more.end ? ' has-more-end' : ''}`}
        onScroll={updateEdges}
        onWheel={handleWheel}
      >
        {SUGGESTIONS.map(({ text, lang }) => (
          <button
            key={text}
            className="suggestion-chip"
            disabled={disabled}
            lang={lang}
            onClick={() => onSelectSuggestion(text)}
            title={text}
            type="button"
          >
            {text}
          </button>
        ))}
      </div>
    </section>
  )
}
