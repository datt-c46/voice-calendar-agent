import React from 'react'

export interface CalendarEventProps {
  id: string
  summary: string
  description?: string
  location?: string
  start: { dateTime: string; timeZone?: string }
  end: { dateTime: string; timeZone?: string }
  status?: string
}

function formatIso(isoString?: string): string {
  if (!isoString) return ''
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return isoString
    const formatter = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour12: false
    })
    const parts = formatter.formatToParts(d)
    const getPart = (type: string): string => parts.find((p) => p.type === type)?.value || '00'
    const hours = getPart('hour')
    const mins = getPart('minute')
    const day = getPart('day')
    const month = getPart('month')
    const year = getPart('year')
    return `${hours}:${mins} • ${day}/${month}/${year}`
  } catch {
    return isoString
  }
}

export const EventCard: React.FC<{ event: CalendarEventProps }> = ({ event }) => {
  return (
    <div className="event-card">
      <div className="event-card-icon">📅</div>
      <div className="event-card-content">
        <div className="event-card-title">{event.summary || 'Sự kiện'}</div>
        <div className="event-card-time">
          {event.start?.dateTime && <span>{formatIso(event.start.dateTime)}</span>}
          {event.end?.dateTime && <span> → {formatIso(event.end.dateTime)}</span>}
        </div>
        {event.location && <div className="event-card-desc">📍 {event.location}</div>}
        {event.description && <div className="event-card-desc">📝 {event.description}</div>}
      </div>
    </div>
  )
}
