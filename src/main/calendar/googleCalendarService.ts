import { google, calendar_v3 } from 'googleapis'
import { DateTime } from 'luxon'
import { OAuthManager } from '../auth/oauthManager'
import {
  APP_TIMEZONE,
  CalendarEvent,
  CalendarStatus,
  CreateEventInput,
  EventQuery,
  ICalendarService,
  UpdateEventInput
} from './types'

export class GoogleCalendarService implements ICalendarService {
  private oauthManager: OAuthManager
  private defaultTimeZone = APP_TIMEZONE

  constructor(oauthManager: OAuthManager) {
    this.oauthManager = oauthManager
  }

  private async getCalendarClient(): Promise<calendar_v3.Calendar> {
    const auth = await this.oauthManager.getAuthenticatedClient()
    if (!auth) {
      throw new Error('Chưa đăng nhập Google Calendar hoặc phiên đăng nhập đã hết hạn.')
    }
    return google.calendar({ version: 'v3', auth })
  }

  public async initialize(): Promise<void> {
    // Initialized on-demand
  }

  public async getServiceStatus(): Promise<CalendarStatus> {
    const authStatus = await this.oauthManager.getAuthStatus()
    return {
      mode: 'google',
      connected: authStatus.isAuthenticated,
      userEmail: authStatus.userEmail || undefined,
      timeZone: this.defaultTimeZone
    }
  }

  public async listEvents(query?: EventQuery): Promise<CalendarEvent[]> {
    const calendar = await this.getCalendarClient()

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: query?.timeMin || undefined,
      timeMax: query?.timeMax || undefined,
      q: query?.query || undefined,
      maxResults: query?.maxResults || 50,
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: this.defaultTimeZone
    })

    const items = res.data.items || []
    return items.map((item) => this.mapToCalendarEvent(item))
  }

  public async getEvent(eventId: string): Promise<CalendarEvent | null> {
    const calendar = await this.getCalendarClient()
    try {
      const res = await calendar.events.get({
        calendarId: 'primary',
        eventId,
        timeZone: this.defaultTimeZone
      })
      return this.mapToCalendarEvent(res.data)
    } catch (err: unknown) {
      if ((err as { code?: number })?.code === 404) {
        return null
      }
      throw err
    }
  }

  public async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    const calendar = await this.getCalendarClient()

    const requestBody: calendar_v3.Schema$Event = {
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: {
        dateTime: this.formatToBangkokRfc3339(input.startDateTime),
        timeZone: input.timeZone || this.defaultTimeZone
      },
      end: {
        dateTime: this.formatToBangkokRfc3339(input.endDateTime),
        timeZone: input.timeZone || this.defaultTimeZone
      }
    }

    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody
    })

    return this.mapToCalendarEvent(res.data)
  }

  public async updateEvent(eventId: string, patch: UpdateEventInput): Promise<CalendarEvent> {
    const calendar = await this.getCalendarClient()

    const patchBody: calendar_v3.Schema$Event = {}

    if (patch.summary !== undefined) patchBody.summary = patch.summary
    if (patch.description !== undefined) patchBody.description = patch.description
    if (patch.location !== undefined) patchBody.location = patch.location

    if (patch.startDateTime) {
      patchBody.start = {
        dateTime: this.formatToBangkokRfc3339(patch.startDateTime),
        timeZone: patch.timeZone || this.defaultTimeZone
      }
    }

    if (patch.endDateTime) {
      patchBody.end = {
        dateTime: this.formatToBangkokRfc3339(patch.endDateTime),
        timeZone: patch.timeZone || this.defaultTimeZone
      }
    }

    const res = await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: patchBody
    })

    return this.mapToCalendarEvent(res.data)
  }

  public async deleteEvent(eventId: string): Promise<boolean> {
    const calendar = await this.getCalendarClient()
    try {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId
      })
      return true
    } catch (err: unknown) {
      if ((err as { code?: number })?.code === 404) {
        return false
      }
      throw err
    }
  }

  private formatToBangkokRfc3339(isoStr: string): string {
    const dt = DateTime.fromISO(isoStr, { zone: this.defaultTimeZone })
    if (dt.isValid) {
      return dt.toISO({ includeOffset: true })!
    }
    return isoStr
  }

  private mapToCalendarEvent(item: calendar_v3.Schema$Event): CalendarEvent {
    let startStr = item.start?.dateTime || item.start?.date || ''
    let endStr = item.end?.dateTime || item.end?.date || startStr

    if (item.start?.dateTime) {
      const dt = DateTime.fromISO(item.start.dateTime, { zone: this.defaultTimeZone })
      if (dt.isValid) {
        startStr = dt.toISO({ includeOffset: true })!
      }
    }

    if (item.end?.dateTime) {
      const dt = DateTime.fromISO(item.end.dateTime, { zone: this.defaultTimeZone })
      if (dt.isValid) {
        endStr = dt.toISO({ includeOffset: true })!
      }
    }

    return {
      id: item.id || `google-evt-${Date.now()}`,
      summary: item.summary || '(Không có tiêu đề)',
      description: item.description || undefined,
      location: item.location || undefined,
      start: {
        dateTime: startStr,
        timeZone: item.start?.timeZone || this.defaultTimeZone
      },
      end: {
        dateTime: endStr,
        timeZone: item.end?.timeZone || this.defaultTimeZone
      },
      status: (item.status as 'confirmed' | 'tentative' | 'cancelled') || 'confirmed',
      htmlLink: item.htmlLink || undefined
    }
  }
}
