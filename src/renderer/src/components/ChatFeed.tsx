import React, { useEffect, useRef } from 'react'
import { intentLabel } from '../utils/intentLabel'
import { EventCard, CalendarEventProps } from './EventCard'

export interface ChatMessage {
  id: string
  sender: 'user' | 'assistant'
  text: string
  intent?: string
  timestamp: string
  events?: CalendarEventProps[]
  /** Delete/update waiting for confirmation (backend pendingAction.id). */
  pendingActionId?: string
  /** The pending action was confirmed, rejected or answered by voice/text. */
  actionResolved?: boolean
}

interface ChatFeedProps {
  messages: ChatMessage[]
  isProcessing: boolean
  onConfirmAction?: (actionId: string) => void
  onRejectAction?: (actionId: string) => void
}

/** Within this distance (px) of the bottom the feed counts as "showing the newest message". */
const STICK_THRESHOLD = 48

export const ChatFeed: React.FC<ChatFeedProps> = ({
  messages,
  isProcessing,
  onConfirmAction,
  onRejectAction
}) => {
  const feedRef = useRef<HTMLElement>(null)
  /** The user is at the newest message (not reading older ones): keep it in view when the feed resizes. */
  const stickRef = useRef(true)
  /** Our own smooth scroll to the end is running: its intermediate positions are not the user leaving the end. */
  const autoScrollRef = useRef(false)

  // A new message (or the "processing" placeholder): bring it into view, smoothly unless reduced motion is asked.
  useEffect(() => {
    const el = feedRef.current
    if (!el) return
    stickRef.current = true
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 1) return // already there: no scroll events
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.scrollTop = el.scrollHeight
      return
    }
    autoScrollRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, isProcessing])

  // The window shrinks or the dock grows (details, warnings): stay on the newest message if the user was there.
  useEffect(() => {
    const el = feedRef.current
    if (!el) return
    const atEnd = (): boolean => el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
    const onScroll = (): void => {
      if (!autoScrollRef.current) stickRef.current = atEnd()
    }
    const onScrollEnd = (): void => {
      autoScrollRef.current = false
      stickRef.current = atEnd()
    }
    const observer = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('scrollend', onScrollEnd)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('scrollend', onScrollEnd)
      observer.disconnect()
    }
  }, [])

  return (
    <main ref={feedRef} className="chat-feed" aria-label="Hội thoại">
      <div className="chat-log" role="log" aria-live="polite">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.sender}`}>
            <span className="sr-only">{msg.sender === 'user' ? 'Bạn:' : 'Trợ lý:'}</span>
            <div className="message-bubble">
              {msg.text}

              {msg.events && msg.events.length > 0 && (
                <div className="event-card-container">
                  {msg.events.map((evt, idx) => (
                    <EventCard key={evt.id || `evt-${idx}`} event={evt} />
                  ))}
                </div>
              )}

              {msg.pendingActionId && !msg.actionResolved && (
                <div className="pending-actions">
                  <button
                    className="pending-btn confirm"
                    disabled={isProcessing}
                    onClick={() => onConfirmAction?.(msg.pendingActionId as string)}
                    type="button"
                  >
                    Xác nhận
                  </button>
                  <button
                    className="pending-btn reject"
                    disabled={isProcessing}
                    onClick={() => onRejectAction?.(msg.pendingActionId as string)}
                    type="button"
                  >
                    Hủy
                  </button>
                </div>
              )}
            </div>

            <div className="message-meta">
              {msg.intent && (
                <>
                  <span className="intent-tag" data-intent={msg.intent} title={msg.intent}>
                    {intentLabel(msg.intent)}
                  </span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span>{msg.timestamp}</span>
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="chat-message assistant">
            <div className="message-bubble is-pending">Đang phân tích và xử lý lịch trình…</div>
          </div>
        )}
      </div>
    </main>
  )
}
