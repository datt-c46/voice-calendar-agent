import React from 'react'
import type { CalendarEventDTO } from '../../../shared/ipc'
import { formatEventDate, formatEventTime, lastAllDayDate } from '../utils/eventFormat'

export type CalendarEventProps = CalendarEventDTO

export const EventCard: React.FC<{ event: CalendarEventProps }> = ({ event }) => {
  const startDate = event.allDay ? event.start?.date : undefined
  const lastDate = startDate ? lastAllDayDate(startDate, event.end?.date) : null

  return (
    <div className="event-card">
      <div className="event-card-icon">{event.provider === 'google' ? '📅' : '🗓️'}</div>
      <div className="event-card-content">
        <div className="event-card-title">{event.summary || 'Sự kiện'}</div>
        <div className="event-card-time">
          {startDate ? (
            <span>
              Cả ngày • {formatEventDate(startDate)}
              {lastDate && ` → ${formatEventDate(lastDate)}`}
            </span>
          ) : (
            <>
              {event.start?.dateTime && (
                <span>{formatEventTime(event.start.dateTime, event.start.timeZone)}</span>
              )}
              {event.end?.dateTime && (
                <span> → {formatEventTime(event.end.dateTime, event.end.timeZone)}</span>
              )}
            </>
          )}
        </div>
        {event.location && <div className="event-card-desc">📍 {event.location}</div>}
        {event.description && <div className="event-card-desc">📝 {event.description}</div>}
      </div>
    </div>
  )
}
