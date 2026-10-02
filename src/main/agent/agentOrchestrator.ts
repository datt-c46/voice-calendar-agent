import { DateTime } from 'luxon'
import { APP_TIMEZONE, CalendarEvent, ICalendarService } from '../calendar/types'
import { DateTimeService } from './dateTimeService'
import { ExtractedIntent, RuleBasedIntentExtractor } from './ruleBasedExtractor'

export interface AgentCommandRequest {
  text: string
  clientTimestamp?: string
  timeZone?: string
}

export interface AgentCommandResponse {
  success: boolean
  message: string
  intent: string
  events?: CalendarEvent[]
  error?: string
}

export class AgentOrchestrator {
  private calendarService: ICalendarService
  private dateTimeService: DateTimeService
  private extractor: RuleBasedIntentExtractor

  constructor(calendarService: ICalendarService) {
    this.calendarService = calendarService
    this.dateTimeService = new DateTimeService(APP_TIMEZONE)
    this.extractor = new RuleBasedIntentExtractor(this.dateTimeService)
  }

  public async processCommand(request: AgentCommandRequest): Promise<AgentCommandResponse> {
    const rawText = request.text?.trim()
    if (!rawText) {
      return {
        success: false,
        intent: 'UNKNOWN',
        message: 'Vui lòng nhập lệnh bằng lời hoặc văn bản.'
      }
    }

    try {
      const extracted = this.extractor.extract(rawText)

      switch (extracted.type) {
        case 'LIST_EVENTS':
          return await this.handleListEvents(extracted)
        case 'CREATE_EVENT':
          return await this.handleCreateEvent(extracted)
        case 'UPDATE_EVENT':
          return await this.handleUpdateEvent(extracted)
        case 'DELETE_EVENT':
          return await this.handleDeleteEvent(extracted)
        case 'UNKNOWN':
        default:
          return this.handleUnknown(extracted)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        intent: 'ERROR',
        message: `Đã xảy ra lỗi khi xử lý yêu cầu: ${message}`,
        error: message
      }
    }
  }

  private async handleListEvents(extracted: ExtractedIntent): Promise<AgentCommandResponse> {
    const events = await this.calendarService.listEvents({
      timeMin: extracted.startDateTime,
      timeMax: extracted.endDateTime
    })

    const isVi = extracted.language === 'vi'

    if (events.length === 0) {
      const msg = isVi
        ? 'Bạn không có lịch trình nào trong khoảng thời gian này.'
        : 'You have no scheduled events for this time.'
      return {
        success: true,
        intent: 'LIST_EVENTS',
        message: msg,
        events: []
      }
    }

    const eventSummaries = events
      .map((e) => {
        const timeStr = this.dateTimeService.formatEventTimeRange(
          e.start.dateTime,
          e.end.dateTime,
          isVi ? 'vi' : 'en'
        )
        return `• ${e.summary} (${timeStr})`
      })
      .join('\n')

    const header = isVi
      ? `Bạn có ${events.length} sự kiện được lên lịch:`
      : `You have ${events.length} scheduled event(s):`

    return {
      success: true,
      intent: 'LIST_EVENTS',
      message: `${header}\n${eventSummaries}`,
      events
    }
  }

  private async handleCreateEvent(extracted: ExtractedIntent): Promise<AgentCommandResponse> {
    const summary =
      extracted.summary || (extracted.language === 'vi' ? 'Cuộc hẹn mới' : 'New Appointment')
    const startIso = extracted.startDateTime!
    const endIso = extracted.endDateTime!
    const isVi = extracted.language === 'vi'

    const created = await this.calendarService.createEvent({
      summary,
      startDateTime: startIso,
      endDateTime: endIso,
      timeZone: APP_TIMEZONE
    })

    const timeFormatted = this.dateTimeService.formatEventTimeRange(
      created.start.dateTime,
      created.end.dateTime,
      isVi ? 'vi' : 'en'
    )

    const msg = isVi
      ? `Đã lên lịch thành công: "${created.summary}" (${timeFormatted})`
      : `Successfully scheduled: "${created.summary}" (${timeFormatted})`

    return {
      success: true,
      intent: 'CREATE_EVENT',
      message: msg,
      events: [created]
    }
  }

  private async handleUpdateEvent(extracted: ExtractedIntent): Promise<AgentCommandResponse> {
    const isVi = extracted.language === 'vi'

    // Look for matching event
    const candidates = await this.calendarService.listEvents({
      timeMin: extracted.startDateTime
        ? DateTime.fromISO(extracted.startDateTime, { zone: APP_TIMEZONE }).startOf('day').toISO()!
        : undefined,
      timeMax: extracted.endDateTime
        ? DateTime.fromISO(extracted.endDateTime, { zone: APP_TIMEZONE }).endOf('day').toISO()!
        : undefined,
      query: extracted.targetQuery
    })

    // If startDateTime is specified, prioritize candidate closest to target time
    if (extracted.startDateTime && candidates.length > 0) {
      const targetMillis = DateTime.fromISO(extracted.startDateTime).toMillis()
      candidates.sort((a, b) => {
        const diffA = Math.abs(DateTime.fromISO(a.start.dateTime).toMillis() - targetMillis)
        const diffB = Math.abs(DateTime.fromISO(b.start.dateTime).toMillis() - targetMillis)
        return diffA - diffB
      })
    }

    // Find the closest candidate
    let target = candidates[0]
    if (!target && extracted.startDateTime) {
      // Try searching around the startDateTime without query string restriction
      const allUpcoming = await this.calendarService.listEvents()
      const targetMillis = DateTime.fromISO(extracted.startDateTime).toMillis()

      let closestDiff = Infinity
      for (const evt of allUpcoming) {
        const evtMillis = DateTime.fromISO(evt.start.dateTime).toMillis()
        const diff = Math.abs(evtMillis - targetMillis)
        if (diff < 3 * 3600 * 1000 && diff < closestDiff) {
          closestDiff = diff
          target = evt
        }
      }
    }

    if (!target) {
      const msg = isVi
        ? 'Không tìm thấy sự kiện phù hợp trên lịch để dời thời gian.'
        : 'Could not find a matching event on your calendar to reschedule.'
      return {
        success: false,
        intent: 'UPDATE_EVENT',
        message: msg
      }
    }

    // Determine new start and end time
    const newStart = extracted.newStartDateTime
    const newEnd = extracted.newEndDateTime

    if (!newStart && !newEnd && extracted.newSummary) {
      // Summary only update
    } else if (!newStart) {
      const msg = isVi
        ? `Tìm thấy sự kiện "${target.summary}", nhưng chưa rõ thời gian mới muốn dời sang.`
        : `Found event "${target.summary}", but the new target time was not specified.`
      return {
        success: false,
        intent: 'UPDATE_EVENT',
        message: msg,
        events: [target]
      }
    }

    const updated = await this.calendarService.updateEvent(target.id, {
      startDateTime: newStart || target.start.dateTime,
      endDateTime: newEnd || target.end.dateTime,
      summary: extracted.newSummary || target.summary,
      timeZone: APP_TIMEZONE
    })

    const newTimeFormatted = this.dateTimeService.formatEventTimeRange(
      updated.start.dateTime,
      updated.end.dateTime,
      isVi ? 'vi' : 'en'
    )

    const msg = isVi
      ? `Đã cập nhật sự kiện "${updated.summary}" sang thời gian mới: ${newTimeFormatted}`
      : `Successfully rescheduled "${updated.summary}" to: ${newTimeFormatted}`

    return {
      success: true,
      intent: 'UPDATE_EVENT',
      message: msg,
      events: [updated]
    }
  }

  private async handleDeleteEvent(extracted: ExtractedIntent): Promise<AgentCommandResponse> {
    const isVi = extracted.language === 'vi'

    // Look for matching event
    const candidates = await this.calendarService.listEvents({
      timeMin: extracted.startDateTime
        ? DateTime.fromISO(extracted.startDateTime, { zone: APP_TIMEZONE }).startOf('day').toISO()!
        : undefined,
      timeMax: extracted.endDateTime
        ? DateTime.fromISO(extracted.endDateTime, { zone: APP_TIMEZONE }).endOf('day').toISO()!
        : undefined,
      query: extracted.targetQuery
    })

    // If startDateTime is specified, prioritize candidate closest to target time
    if (extracted.startDateTime && candidates.length > 0) {
      const targetMillis = DateTime.fromISO(extracted.startDateTime).toMillis()
      candidates.sort((a, b) => {
        const diffA = Math.abs(DateTime.fromISO(a.start.dateTime).toMillis() - targetMillis)
        const diffB = Math.abs(DateTime.fromISO(b.start.dateTime).toMillis() - targetMillis)
        return diffA - diffB
      })
    }

    let target = candidates[0]

    // If query string didn't hit, check time-based proximity
    if (!target && extracted.startDateTime) {
      const allUpcoming = await this.calendarService.listEvents()
      const targetMillis = DateTime.fromISO(extracted.startDateTime).toMillis()

      let closestDiff = Infinity
      for (const evt of allUpcoming) {
        const evtMillis = DateTime.fromISO(evt.start.dateTime).toMillis()
        const diff = Math.abs(evtMillis - targetMillis)
        if (diff < 3 * 3600 * 1000 && diff < closestDiff) {
          closestDiff = diff
          target = evt
        }
      }
    }

    if (!target) {
      const msg = isVi
        ? 'Không tìm thấy cuộc hẹn nào phù hợp để xóa.'
        : 'Could not find a matching event to delete.'
      return {
        success: false,
        intent: 'DELETE_EVENT',
        message: msg
      }
    }

    await this.calendarService.deleteEvent(target.id)

    const timeFormatted = this.dateTimeService.formatEventTimeRange(
      target.start.dateTime,
      target.end.dateTime,
      isVi ? 'vi' : 'en'
    )

    const msg = isVi
      ? `Đã xóa sự kiện "${target.summary}" (${timeFormatted}) khỏi lịch.`
      : `Deleted event "${target.summary}" (${timeFormatted}) from your calendar.`

    return {
      success: true,
      intent: 'DELETE_EVENT',
      message: msg,
      events: [target]
    }
  }

  private handleUnknown(extracted: ExtractedIntent): AgentCommandResponse {
    const isVi = extracted.language === 'vi'
    const msg = isVi
      ? 'Tôi chưa hiểu rõ yêu cầu. Bạn có thể thử các mẫu câu:\n• "Ngày mai tôi có lịch gì?"\n• "Chiều mai lúc 3 giờ họp với A"\n• "Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ"\n• "Xóa cuộc họp lúc 3 giờ chiều ngày mai"'
      : 'I did not recognize that command. You can try:\n• "What do I have tomorrow?"\n• "Schedule meeting with Alice tomorrow at 3pm"\n• "Move meeting tomorrow at 3pm to 4pm"\n• "Delete meeting tomorrow at 3pm"'

    return {
      success: false,
      intent: 'UNKNOWN',
      message: msg
    }
  }
}
