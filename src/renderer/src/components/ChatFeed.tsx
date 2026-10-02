import React, { useEffect, useRef } from 'react'
import { EventCard, CalendarEventProps } from './EventCard'

export interface ChatMessage {
  id: string
  sender: 'user' | 'assistant'
  text: string
  intent?: string
  timestamp: string
  events?: CalendarEventProps[]
}

interface ChatFeedProps {
  messages: ChatMessage[]
  isProcessing: boolean
}

export const ChatFeed: React.FC<ChatFeedProps> = ({ messages, isProcessing }) => {
  const feedEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isProcessing])

  return (
    <div className="chat-feed">
      {messages.map((msg) => (
        <div key={msg.id} className={`chat-message ${msg.sender}`}>
          <div className="message-bubble">
            {msg.text}

            {msg.events && msg.events.length > 0 && (
              <div className="event-card-container">
                {msg.events.map((evt, idx) => (
                  <EventCard key={evt.id || `evt-${idx}`} event={evt} />
                ))}
              </div>
            )}
          </div>

          <div className="message-meta">
            {msg.intent && <span className="intent-tag">{msg.intent}</span>}
            <span>{msg.timestamp}</span>
          </div>
        </div>
      ))}

      {isProcessing && (
        <div className="chat-message assistant">
          <div className="message-bubble" style={{ color: 'var(--text-muted)' }}>
            Đang phân tích và xử lý lịch trình...
          </div>
        </div>
      )}

      <div ref={feedEndRef} />
    </div>
  )
}
