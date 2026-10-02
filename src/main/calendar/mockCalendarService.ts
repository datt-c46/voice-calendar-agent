import { DateTime } from 'luxon'
import {
  APP_TIMEZONE,
  CalendarEvent,
  CalendarStatus,
  CreateEventInput,
  EventQuery,
  ICalendarService,
  UpdateEventInput
} from './types'

export class MockCalendarService implements ICalendarService {
  private events: Map<string, CalendarEvent> = new Map()
  private initialized = false
  private defaultTimeZone = APP_TIMEZONE

  public async initialize(): Promise<void> {
    if (this.initialized) return

    const now = DateTime.now().setZone(this.defaultTimeZone)
    const today = now.startOf('day')
    const tomorrow = today.plus({ days: 1 })

    // Seed realistic sample events
    const sampleEvents: CalendarEvent[] = [
      {
        id: 'mock-evt-1',
        summary: 'Họp kế hoạch Sprint Voice Agent',
        description: 'Thảo luận kiến trúc và tiến độ Milestone 1',
        location: 'Phòng họp ảo Google Meet',
        start: {
          dateTime: today.set({ hour: 9, minute: 30 }).toISO()!,
          timeZone: this.defaultTimeZone
        },
        end: {
          dateTime: today.set({ hour: 10, minute: 30 }).toISO()!,
          timeZone: this.defaultTimeZone
        },
        status: 'confirmed'
      },
      {
        id: 'mock-evt-2',
        summary: 'Ăn trưa với Team AI',
        description: 'Trao đổi về mô hình offline STT/TTS',
        location: 'Nhà hàng gần công ty',
        start: {
          dateTime: today.set({ hour: 12, minute: 0 }).toISO()!,
          timeZone: this.defaultTimeZone
        },
        end: {
          dateTime: today.set({ hour: 13, minute: 0 }).toISO()!,
          timeZone: this.defaultTimeZone
        },
        status: 'confirmed'
      },
      {
        id: 'mock-evt-3',
        summary: 'Phỏng vấn ứng viên Frontend',
        description: 'Đánh giá kỹ năng React và Electron',
        start: {
          dateTime: tomorrow.set({ hour: 10, minute: 0 }).toISO()!,
          timeZone: this.defaultTimeZone
        },
        end: {
          dateTime: tomorrow.set({ hour: 11, minute: 0 }).toISO()!,
          timeZone: this.defaultTimeZone
        },
        status: 'confirmed'
      },
      {
        id: 'mock-evt-4',
        summary: 'Báo cáo tiến độ đồ án tốt nghiệp',
        description: 'Review với thầy hướng dẫn',
        location: 'Phòng Lab 402',
        start: {
          dateTime: tomorrow.set({ hour: 17, minute: 0 }).toISO()!,
          timeZone: this.defaultTimeZone
        },
        end: {
          dateTime: tomorrow.set({ hour: 18, minute: 0 }).toISO()!,
          timeZone: this.defaultTimeZone
        },
        status: 'confirmed'
      }
    ]

    for (const evt of sampleEvents) {
      this.events.set(evt.id, evt)
    }

    this.initialized = true
  }

  public async getServiceStatus(): Promise<CalendarStatus> {
    await this.initialize()
    return {
      mode: 'mock',
      connected: true,
      userEmail: 'mock-user@offline.local',
      eventCount: this.events.size,
      timeZone: this.defaultTimeZone
    }
  }

  public async listEvents(query?: EventQuery): Promise<CalendarEvent[]> {
    await this.initialize()
    let list = Array.from(this.events.values())

    if (query?.timeMin) {
      const minMillis = DateTime.fromISO(query.timeMin, { zone: this.defaultTimeZone }).toMillis()
      list = list.filter((e) => {
        const startMillis = DateTime.fromISO(e.start.dateTime, {
          zone: this.defaultTimeZone
        }).toMillis()
        return startMillis >= minMillis
      })
    }

    if (query?.timeMax) {
      const maxMillis = DateTime.fromISO(query.timeMax, { zone: this.defaultTimeZone }).toMillis()
      list = list.filter((e) => {
        const endMillis = DateTime.fromISO(e.end.dateTime, {
          zone: this.defaultTimeZone
        }).toMillis()
        return endMillis <= maxMillis
      })
    }

    if (query?.query) {
      const q = query.query.toLowerCase()
      list = list.filter(
        (e) =>
          e.summary.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q) ||
          e.location?.toLowerCase().includes(q)
      )
    }

    list.sort((a, b) => {
      const tA = DateTime.fromISO(a.start.dateTime, { zone: this.defaultTimeZone }).toMillis()
      const tB = DateTime.fromISO(b.start.dateTime, { zone: this.defaultTimeZone }).toMillis()
      return tA - tB
    })

    if (query?.maxResults && query.maxResults > 0) {
      list = list.slice(0, query.maxResults)
    }

    return list
  }

  public async getEvent(eventId: string): Promise<CalendarEvent | null> {
    await this.initialize()
    return this.events.get(eventId) || null
  }

  public async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    await this.initialize()
    const id = `mock-evt-${Date.now()}-${Math.floor(Math.random() * 1000)}`

    const newEvent: CalendarEvent = {
      id,
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: {
        dateTime: input.startDateTime,
        timeZone: input.timeZone || this.defaultTimeZone
      },
      end: {
        dateTime: input.endDateTime,
        timeZone: input.timeZone || this.defaultTimeZone
      },
      status: 'confirmed'
    }

    this.events.set(id, newEvent)
    return newEvent
  }

  public async updateEvent(eventId: string, patch: UpdateEventInput): Promise<CalendarEvent> {
    await this.initialize()
    const existing = this.events.get(eventId)
    if (!existing) {
      throw new Error(`Event with id "${eventId}" not found.`)
    }

    const updated: CalendarEvent = {
      ...existing,
      summary: patch.summary !== undefined ? patch.summary : existing.summary,
      description: patch.description !== undefined ? patch.description : existing.description,
      location: patch.location !== undefined ? patch.location : existing.location,
      start: {
        dateTime: patch.startDateTime || existing.start.dateTime,
        timeZone: patch.timeZone || existing.start.timeZone
      },
      end: {
        dateTime: patch.endDateTime || existing.end.dateTime,
        timeZone: patch.timeZone || existing.end.timeZone
      }
    }

    this.events.set(eventId, updated)
    return updated
  }

  public async deleteEvent(eventId: string): Promise<boolean> {
    await this.initialize()
    return this.events.delete(eventId)
  }
}
