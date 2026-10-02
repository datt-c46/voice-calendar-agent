export const APP_TIMEZONE = 'Asia/Bangkok'

export interface CalendarEventDateTime {
  dateTime: string // ISO 8601 string
  timeZone?: string
}

export interface CalendarEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: CalendarEventDateTime
  end: CalendarEventDateTime
  status?: 'confirmed' | 'tentative' | 'cancelled'
  htmlLink?: string
}

export interface CreateEventInput {
  summary: string
  description?: string
  location?: string
  startDateTime: string // ISO 8601
  endDateTime: string // ISO 8601
  timeZone?: string
}

export interface UpdateEventInput {
  summary?: string
  description?: string
  location?: string
  startDateTime?: string
  endDateTime?: string
  timeZone?: string
}

export interface EventQuery {
  timeMin?: string
  timeMax?: string
  query?: string
  maxResults?: number
}

export interface CalendarStatus {
  mode: 'mock' | 'google'
  connected: boolean
  userEmail?: string
  eventCount?: number
  timeZone: string
}

export interface ICalendarService {
  initialize(): Promise<void>
  getServiceStatus(): Promise<CalendarStatus>
  listEvents(query?: EventQuery): Promise<CalendarEvent[]>
  getEvent(eventId: string): Promise<CalendarEvent | null>
  createEvent(input: CreateEventInput): Promise<CalendarEvent>
  updateEvent(eventId: string, patch: UpdateEventInput): Promise<CalendarEvent>
  deleteEvent(eventId: string): Promise<boolean>
}
