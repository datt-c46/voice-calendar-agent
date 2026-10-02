import { DateTime } from 'luxon'
import { APP_TIMEZONE } from '../calendar/types'
import { DateTimeService } from './dateTimeService'

export type IntentType =
  'LIST_EVENTS' | 'CREATE_EVENT' | 'UPDATE_EVENT' | 'DELETE_EVENT' | 'UNKNOWN'

export interface ExtractedIntent {
  type: IntentType
  confidence: number
  summary?: string
  startDateTime?: string
  endDateTime?: string
  targetQuery?: string
  newStartDateTime?: string
  newEndDateTime?: string
  newSummary?: string
  rawText: string
  language: 'vi' | 'en'
}

export class RuleBasedIntentExtractor {
  private dateTimeService: DateTimeService

  constructor(dateTimeService?: DateTimeService) {
    this.dateTimeService = dateTimeService || new DateTimeService(APP_TIMEZONE)
  }

  public extract(text: string): ExtractedIntent {
    const raw = text.trim()
    const lower = raw.toLowerCase()
    const lang = this.detectLanguage(lower)

    let extracted: ExtractedIntent

    // 1. UPDATE_EVENT Check
    if (this.isUpdateIntent(lower)) {
      extracted = this.extractUpdateIntent(raw, lang)
    }
    // 2. DELETE_EVENT Check
    else if (this.isDeleteIntent(lower)) {
      extracted = this.extractDeleteIntent(raw, lang)
    }
    // 3. LIST_EVENTS Check
    else if (this.isListIntent(lower)) {
      extracted = this.extractListIntent(raw, lang)
    }
    // 4. CREATE_EVENT Check
    else if (this.isCreateIntent(lower)) {
      extracted = this.extractCreateIntent(raw, lang)
    }
    // Fallback: If it has temporal info and an explicit time/activity, treat as CREATE_EVENT
    else {
      const fallbackTemporal = this.dateTimeService.parseTemporalExpression(raw)
      if (fallbackTemporal && fallbackTemporal.isTimeExplicit) {
        extracted = this.extractCreateIntent(raw, lang)
      } else {
        extracted = {
          type: 'UNKNOWN',
          confidence: 0.2,
          rawText: raw,
          language: lang
        }
      }
    }

    // Step 2 Development diagnostics
    console.log(
      `\n[AGENT]\n` +
        `input="${raw}"\n` +
        `detectedLanguage=${lang}\n` +
        `intent=${extracted.type}\n` +
        `slots={\n` +
        `  title: ${extracted.summary ? `"${extracted.summary}"` : 'undefined'},\n` +
        `  startDateTime: ${extracted.startDateTime ? `"${extracted.startDateTime}"` : 'undefined'},\n` +
        `  endDateTime: ${extracted.endDateTime ? `"${extracted.endDateTime}"` : 'undefined'},\n` +
        `  targetQuery: ${extracted.targetQuery ? `"${extracted.targetQuery}"` : 'undefined'},\n` +
        `  newStartDateTime: ${extracted.newStartDateTime ? `"${extracted.newStartDateTime}"` : 'undefined'},\n` +
        `  newEndDateTime: ${extracted.newEndDateTime ? `"${extracted.newEndDateTime}"` : 'undefined'},\n` +
        `  timezone: "${APP_TIMEZONE}"\n` +
        `}\n`
    )

    return extracted
  }

  private detectLanguage(text: string): 'vi' | 'en' {
    const vnChars = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/iu
    if (vnChars.test(text)) {
      return 'vi'
    }

    const lower = text.toLowerCase()
    const vnKeywords =
      /\b(ngày|mai|hôm|lúc|giờ|chiều|sáng|tối|trưa|họp|lịch|xóa|hủy|huỷ|dời|đổi|tôi|với|sang|hẹn|thêm|tạo|xem|kiểm tra|ngay|chieu|toi|hop|xoa|doi|huy|lich)\b/iu
    const enKeywords =
      /\b(what|tomorrow|schedule|meeting|create|delete|move|reschedule|cancel|list|show|events|calendar|today|yesterday|with|at|pm|am|have|do|please|on|from)\b/i

    const vnMatches = (lower.match(new RegExp(vnKeywords.source, 'giu')) || []).length
    const enMatches = (lower.match(new RegExp(enKeywords.source, 'gi')) || []).length

    if (enMatches > vnMatches) {
      return 'en'
    }
    if (vnMatches > enMatches) {
      return 'vi'
    }

    return 'vi'
  }

  private isUpdateIntent(lower: string): boolean {
    const viUpdate =
      /(?<!\p{L})(dời|đổi|chuyển|cập nhật|thay đổi|hoãn|lùi|doi|chuyen|cap nhat|hoan|lui)(?!\p{L})/iu
    const enUpdate = /\b(update|reschedule|move|change|shift|postpone)\b/i
    return viUpdate.test(lower) || enUpdate.test(lower)
  }

  private isDeleteIntent(lower: string): boolean {
    const viDelete = /(?<!\p{L})(xóa|hủy|huỷ|bỏ|xoa|huy|bo)(?!\p{L})/iu
    const enDelete = /\b(delete|cancel|remove|drop)\b/i
    return viDelete.test(lower) || enDelete.test(lower)
  }

  private isListIntent(lower: string): boolean {
    const viList =
      /(?<!\p{L})(có lịch gì|lịch gì|xem lịch|danh sách|lịch hôm nay|lịch ngày mai|có hẹn gì|có hẹn nào|có sự kiện gì|có cuộc họp nào|có cuộc họp gì|có họp gì|kiểm tra lịch|lịch trình|co lich gi|lich gi|xem lich|lich hom nay|lich ngay mai|co hen gi|co cuoc hop nao|co hop gi)(?!\p{L})/iu
    const enList =
      /\b(what do i have|what's on my calendar|what is on my calendar|list events|show my schedule|show events|any meetings|check calendar)\b/i
    return viList.test(lower) || enList.test(lower)
  }

  private isCreateIntent(lower: string): boolean {
    const viCreate =
      /(?<!\p{L})(họp|gặp|hẹn|tạo lịch|thêm lịch|lên lịch|nhắc|ăn trưa|ăn tối|khám|workshop|call|hop|gap|hen|tao lich|them lich|len lich|nhac|an trua|an toi|kham)(?!\p{L})/iu
    const enCreate =
      /\b(schedule|create|add|book|meeting with|meet with|sync with|call with|lunch with|dinner with)\b/i
    return viCreate.test(lower) || enCreate.test(lower)
  }

  private cleanTargetQuery(text: string): string | undefined {
    const cleaned = text
      .replace(
        /\b(chiều mai|sáng mai|tối mai|trưa mai|ngày mai|hôm nay|ngày mốt|chieu mai|sang mai|toi mai|trua mai|ngay mai|hom nay|ngay mot|tomorrow|today)\b/gi,
        ''
      )
      .replace(
        /\blúc\s+\d{1,2}(?:[h:]\d{1,2}|\s*(?:giờ|gio)(?:\s*\d{1,2}(?:p|phút|phut)?)?)?(?:\s*(sáng|trưa|chiều|tối|sang|trua|chieu|toi|am|pm))?/gi,
        ''
      )
      .replace(
        /\b\d{1,2}\s*(?:giờ|gio)(?:\s*chiều|\s*sáng|\s*tối|\s*chieu|\s*sang|\s*toi)?\b/gi,
        ''
      )
      .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '')
      .replace(
        /^(cuộc họp|buổi họp|lịch hẹn|cuộc hẹn|lịch|sự kiện|cuoc hop|buoi hop|lich hen|cuoc hen|lich|su kien|meeting|the meeting|appointment|event)\s*/gi,
        ''
      )
      .replace(
        /\b(cuộc họp|buổi họp|lịch hẹn|cuộc hẹn|lịch|sự kiện|cuoc hop|buoi hop|lich hen|cuoc hen|lich|su kien|meeting|the meeting|appointment|event)\b/gi,
        ''
      )
      .replace(/^['’]s\s*/i, '')
      .replace(/\b(với|with|cho|for|của|of)\s+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()

    return cleaned.length > 0 ? cleaned : undefined
  }

  private extractListIntent(raw: string, lang: 'vi' | 'en'): ExtractedIntent {
    const temporal = this.dateTimeService.parseTemporalExpression(raw)

    let startIso: string
    let endIso: string

    if (temporal) {
      startIso = temporal.startDateTime
      endIso = temporal.endDateTime
    } else {
      // Default to today if no date is specified
      const now = DateTime.now().setZone(APP_TIMEZONE)
      startIso = now.startOf('day').toISO()!
      endIso = now.endOf('day').toISO()!
    }

    return {
      type: 'LIST_EVENTS',
      confidence: 0.95,
      startDateTime: startIso,
      endDateTime: endIso,
      rawText: raw,
      language: lang
    }
  }

  private extractCreateIntent(raw: string, lang: 'vi' | 'en'): ExtractedIntent {
    const temporal = this.dateTimeService.parseTemporalExpression(raw)

    // Compute title / summary by stripping known command and time prefixes
    let cleanSummary = raw

    // Remove common action prefixes
    cleanSummary = cleanSummary.replace(
      /^(tạo cuộc họp|tạo lịch|thêm lịch|lên lịch|hãy lên lịch|đặt lịch|tao cuoc hop|tao lich|them lich|len lich|schedule a|schedule|create a|create|add a|add|book a|book)\s+/i,
      ''
    )

    // Clean out temporal expressions if matched
    if (temporal && temporal.matchedPhrases.length > 0) {
      for (const phrase of temporal.matchedPhrases) {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        cleanSummary = cleanSummary.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '')
      }
    }

    // Clean out residual time markers
    cleanSummary = cleanSummary
      .replace(
        /\b(chiều mai|sáng mai|tối mai|trưa mai|ngày mai|hôm nay|ngày mốt|chieu mai|sang mai|toi mai|trua mai|ngay mai|hom nay|ngay mot|tomorrow|today)\b/gi,
        ''
      )
      .replace(
        /\blúc\s+\d{1,2}(?:[h:]\d{1,2}|\s*(?:giờ|gio)(?:\s*\d{1,2}(?:p|phút|phut)?)?)?(?:\s*(sáng|trưa|chiều|tối|sang|trua|chieu|toi|am|pm))?/gi,
        ''
      )
      .replace(
        /\b\d{1,2}\s*(?:giờ|gio)(?:\s*chiều|\s*sáng|\s*tối|\s*chieu|\s*sang|\s*toi)?\b/gi,
        ''
      )
      .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '')
      .replace(/\b(at|on|for|in|vào|lúc)\s*$/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()

    // Capitalize first letter
    if (cleanSummary.length > 0) {
      cleanSummary = cleanSummary.charAt(0).toUpperCase() + cleanSummary.slice(1)
    } else {
      cleanSummary = lang === 'vi' ? 'Cuộc hẹn mới' : 'New Appointment'
    }

    // Fallback time if none specified: next top of the hour or tomorrow 9am
    let startIso: string
    let endIso: string
    if (temporal && temporal.isTimeExplicit) {
      startIso = temporal.startDateTime
      endIso = temporal.endDateTime
    } else if (temporal && !temporal.isTimeExplicit) {
      // Date explicit, time default to 9:00 AM on that date
      const dateDt = DateTime.fromISO(temporal.startDateTime, { zone: APP_TIMEZONE })
      const start = dateDt.set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
      startIso = start.toISO()!
      endIso = start.plus({ hours: 1 }).toISO()!
    } else {
      const now = DateTime.now().setZone(APP_TIMEZONE)
      const nextHour = now.plus({ hours: 1 }).startOf('hour')
      startIso = nextHour.toISO()!
      endIso = nextHour.plus({ hours: 1 }).toISO()!
    }

    return {
      type: 'CREATE_EVENT',
      confidence: 0.9,
      summary: cleanSummary,
      startDateTime: startIso,
      endDateTime: endIso,
      rawText: raw,
      language: lang
    }
  }

  private extractDeleteIntent(raw: string, lang: 'vi' | 'en'): ExtractedIntent {
    const temporal = this.dateTimeService.parseTemporalExpression(raw)

    // Extract target query by stripping delete triggers
    let target = raw
      .replace(
        /^(xóa cuộc họp|xóa lịch|xóa|hủy cuộc họp|hủy lịch|hủy|huỷ|bỏ|xoa cuoc hop|xoa lich|xoa|huy cuoc hop|huy lich|huy|bo|delete meeting|delete the meeting|delete|cancel meeting|cancel the meeting|cancel|remove)\s*/i,
        ''
      )
      .trim()

    if (temporal && temporal.matchedPhrases.length > 0) {
      for (const phrase of temporal.matchedPhrases) {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        target = target.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '')
      }
    }

    const cleanedQuery = this.cleanTargetQuery(target)

    return {
      type: 'DELETE_EVENT',
      confidence: 0.9,
      targetQuery: cleanedQuery,
      startDateTime: temporal?.startDateTime,
      endDateTime: temporal?.endDateTime,
      rawText: raw,
      language: lang
    }
  }

  private extractUpdateIntent(raw: string, lang: 'vi' | 'en'): ExtractedIntent {
    let targetPart = raw
    let destinationPart = ''

    const splitRegex = /\b(?:sang|thành|thanh|đến|den|tới|toi|qua|to|into)\b/i
    if (splitRegex.test(raw)) {
      const match = raw.match(splitRegex)
      if (match && match.index !== undefined) {
        targetPart = raw.slice(0, match.index).trim()
        destinationPart = raw.slice(match.index + match[0].length).trim()
      }
    }

    const originalTemporal = this.dateTimeService.parseTemporalExpression(targetPart)

    let newStartIso: string | undefined
    let newEndIso: string | undefined

    if (destinationPart) {
      const baseDate = originalTemporal
        ? DateTime.fromISO(originalTemporal.startDateTime, { zone: APP_TIMEZONE })
        : DateTime.now().setZone(APP_TIMEZONE)

      const newTemporal = this.dateTimeService.parseTemporalExpression(destinationPart, baseDate)

      if (newTemporal) {
        newStartIso = newTemporal.startDateTime
        newEndIso = newTemporal.endDateTime
      }
    }

    // Clean target query
    let target = targetPart
      .replace(
        /^(dời cuộc họp|dời lịch|dời|đổi cuộc họp|đổi lịch|đổi|chuyển cuộc họp|chuyển lịch|chuyển|cập nhật cuộc họp|cập nhật lịch|cập nhật|hoãn cuộc họp|hoãn lịch|hoãn|lùi cuộc họp|lùi lịch|lùi|doi cuoc hop|doi lich|doi|chuyen cuoc hop|chuyen lich|chuyen|cap nhat cuoc hop|cap nhat lich|cap nhat|move meeting|move the meeting|move|reschedule meeting|reschedule the meeting|reschedule|update meeting|update the meeting|update)\s*/i,
        ''
      )
      .trim()

    if (originalTemporal && originalTemporal.matchedPhrases.length > 0) {
      for (const phrase of originalTemporal.matchedPhrases) {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        target = target.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '')
      }
    }

    const cleanedQuery = this.cleanTargetQuery(target)

    return {
      type: 'UPDATE_EVENT',
      confidence: 0.9,
      targetQuery: cleanedQuery,
      startDateTime: originalTemporal?.startDateTime,
      endDateTime: originalTemporal?.endDateTime,
      newStartDateTime: newStartIso,
      newEndDateTime: newEndIso,
      rawText: raw,
      language: lang
    }
  }
}
