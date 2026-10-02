import * as chrono from 'chrono-node'
import { DateTime } from 'luxon'
import { APP_TIMEZONE } from '../calendar/types'

export interface ParsedTemporalInfo {
  startDateTime: string // ISO 8601
  endDateTime: string // ISO 8601
  isTimeExplicit: boolean
  isDateExplicit: boolean
  matchedPhrases: string[]
  timeZone: string
}

export class DateTimeService {
  private defaultTimeZone: string

  constructor(timeZone?: string) {
    this.defaultTimeZone = timeZone || APP_TIMEZONE
  }

  /**
   * Parse temporal references in Vietnamese or English.
   * If only date is specified (e.g. "ngày mai"), start is start of day, end is end of day.
   * If time is specified (e.g. "lúc 3 giờ chiều mai"), start is 15:00, end is 16:00 (default 1 hour).
   */
  public parseTemporalExpression(text: string, refDateTime?: DateTime): ParsedTemporalInfo | null {
    const baseNow = (refDateTime || DateTime.now().setZone(this.defaultTimeZone)).setZone(
      this.defaultTimeZone
    )
    const lower = text.toLowerCase()
    const matchedPhrases: string[] = []

    // 1. Check Vietnamese temporal expressions
    const vnResult = this.parseVietnameseTemporal(lower, baseNow)
    if (vnResult) {
      return vnResult
    }

    // 2. Fall back to Chrono-node for English expressions
    const chronoResults = chrono.parse(text, baseNow.toJSDate())
    if (chronoResults && chronoResults.length > 0) {
      // Find date component and time component across results
      const dateResult = chronoResults.find(
        (r) =>
          r.start.isCertain('day') ||
          r.start.isCertain('month') ||
          /(tomorrow|today|yesterday|next|last|\b(mon|tue|wed|thu|fri|sat|sun)\b)/i.test(r.text)
      )
      const timeResult = chronoResults.find((r) => r.start.isCertain('hour'))
      const primary = dateResult || timeResult || chronoResults[0]

      const startYear = (dateResult || primary).start.get('year') ?? baseNow.year
      const startMonth = (dateResult || primary).start.get('month') ?? baseNow.month
      const startDay = (dateResult || primary).start.get('day') ?? baseNow.day

      const hasTime = timeResult
        ? timeResult.start.isCertain('hour')
        : primary.start.isCertain('hour')
      const startHour = hasTime ? ((timeResult || primary).start.get('hour') ?? 0) : 0
      const startMinute = hasTime ? ((timeResult || primary).start.get('minute') ?? 0) : 0
      const startSecond = hasTime ? ((timeResult || primary).start.get('second') ?? 0) : 0

      let startDt = DateTime.fromObject(
        {
          year: startYear,
          month: startMonth,
          day: startDay,
          hour: startHour,
          minute: startMinute,
          second: startSecond,
          millisecond: 0
        },
        { zone: this.defaultTimeZone }
      )

      let endDt: DateTime
      const lastWithEnd = chronoResults.find((r) => r.end)
      if (lastWithEnd && lastWithEnd.end) {
        const endYear = lastWithEnd.end.get('year') ?? startYear
        const endMonth = lastWithEnd.end.get('month') ?? startMonth
        const endDay = lastWithEnd.end.get('day') ?? startDay
        const endHour = lastWithEnd.end.get('hour') ?? (lastWithEnd.end.isCertain('hour') ? 0 : 23)
        const endMinute =
          lastWithEnd.end.get('minute') ?? (lastWithEnd.end.isCertain('minute') ? 0 : 59)
        const endSecond = lastWithEnd.end.get('second') ?? 0
        endDt = DateTime.fromObject(
          {
            year: endYear,
            month: endMonth,
            day: endDay,
            hour: endHour,
            minute: endMinute,
            second: endSecond,
            millisecond: 0
          },
          { zone: this.defaultTimeZone }
        )
      } else if (hasTime) {
        endDt = startDt.plus({ hours: 1 })
      } else {
        startDt = startDt.startOf('day')
        endDt = startDt.endOf('day')
      }

      for (const res of chronoResults) {
        matchedPhrases.push(res.text)
      }

      return {
        startDateTime: startDt.toISO()!,
        endDateTime: endDt.toISO()!,
        isTimeExplicit: hasTime,
        isDateExplicit: Boolean(dateResult || primary.start.isCertain('day')),
        matchedPhrases,
        timeZone: this.defaultTimeZone
      }
    }

    return null
  }

  /**
   * Specialized parser for Vietnamese natural-language dates & times.
   */
  private parseVietnameseTemporal(lower: string, baseNow: DateTime): ParsedTemporalInfo | null {
    let targetDate: DateTime | null = null
    const matchedPhrases: string[] = []

    // Date indicators
    if (
      /(?<!\p{L})(hôm nay|bữa nay|ngày nay|nay|hom nay|bua nay|ngay nay)(?!\p{L})/iu.test(lower)
    ) {
      targetDate = baseNow.startOf('day')
      matchedPhrases.push('hôm nay')
    } else if (
      /(?<!\p{L})(ngày mai|hôm mai|chiều mai|sáng mai|tối mai|trưa mai|ngay mai|hom mai|chieu mai|sang mai|toi mai|trua mai|mai)(?!\p{L})/iu.test(
        lower
      )
    ) {
      targetDate = baseNow.plus({ days: 1 }).startOf('day')
      matchedPhrases.push('ngày mai')
    } else if (/(?<!\p{L})(ngày mốt|ngày kia|mốt|ngay mot|ngay kia|mot)(?!\p{L})/iu.test(lower)) {
      targetDate = baseNow.plus({ days: 2 }).startOf('day')
      matchedPhrases.push('ngày mốt')
    } else if (/(?<!\p{L})(hôm qua|hom qua)(?!\p{L})/iu.test(lower)) {
      targetDate = baseNow.minus({ days: 1 }).startOf('day')
      matchedPhrases.push('hôm qua')
    } else {
      // Days of week: thứ 2 .. thứ 7, chủ nhật
      const dayMatches: Record<string, number> = {
        'thứ 2': 1,
        'thu 2': 1,
        'thứ hai': 1,
        'thu hai': 1,
        'thứ 3': 2,
        'thu 3': 2,
        'thứ ba': 2,
        'thu ba': 2,
        'thứ 4': 3,
        'thu 4': 3,
        'thứ tư': 3,
        'thu tư': 3,
        'thứ 5': 4,
        'thu 5': 4,
        'thứ năm': 4,
        'thu nam': 4,
        'thứ 6': 5,
        'thu 6': 5,
        'thứ sáu': 5,
        'thu sau': 5,
        'thứ 7': 6,
        'thu 7': 6,
        'thứ bảy': 6,
        'thu bay': 6,
        'chủ nhật': 7,
        'chu nhat': 7,
        cn: 7
      }

      for (const [phrase, weekday] of Object.entries(dayMatches)) {
        const regex = new RegExp(`(?<!\\p{L})${phrase}(?!\\p{L})`, 'iu')
        if (regex.test(lower)) {
          let daysAhead = weekday - baseNow.weekday
          if (daysAhead <= 0) daysAhead += 7
          targetDate = baseNow.plus({ days: daysAhead }).startOf('day')
          matchedPhrases.push(phrase)
          break
        }
      }
    }

    // Default to today if time is specified but date is not
    const effectiveDate = targetDate || baseNow.startOf('day')

    // Time indicators
    // E.g.: "lúc 3 giờ chiều", "3 giờ chiều", "15 giờ", "3h chiều", "3h30", "15:00", "9 giờ sáng", "12 giờ trưa"
    const timeRegex =
      /(?:lúc\s+)?(\d{1,2})(?:[h:](\d{1,2})?|\s*(?:giờ|gio)(?:\s*(\d{1,2})(?:p|phút|phut)?)?)?(?:\s*(sáng|trưa|chiều|tối|đêm|sang|trua|chieu|toi|dem|am|pm))?/iu

    // Look for time matches
    const timeMatch = lower.match(timeRegex)
    let explicitHour: number | null = null
    let explicitMinute = 0
    let periodModifier: string | null = null

    // Also look for context clues like "chiều mai", "sáng mai", "tối mai"
    if (
      /(?<!\p{L})(chiều mai|buổi chiều|chiều|chieu mai|buoi chieu|chieu)(?!\p{L})/iu.test(lower)
    ) {
      periodModifier = 'chiều'
    } else if (
      /(?<!\p{L})(sáng mai|buổi sáng|sáng|sang mai|buoi sang|sang)(?!\p{L})/iu.test(lower)
    ) {
      periodModifier = 'sáng'
    } else if (/(?<!\p{L})(tối mai|buổi tối|tối|toi mai|buoi toi|toi)(?!\p{L})/iu.test(lower)) {
      periodModifier = 'tối'
    } else if (
      /(?<!\p{L})(trưa mai|buổi trưa|trưa|trua mai|buoi trua|trua)(?!\p{L})/iu.test(lower)
    ) {
      periodModifier = 'trưa'
    }

    if (timeMatch && timeMatch[1]) {
      const parsedH = parseInt(timeMatch[1], 10)
      if (parsedH >= 0 && parsedH <= 24) {
        explicitHour = parsedH
        matchedPhrases.push(timeMatch[0])

        if (timeMatch[2]) {
          explicitMinute = parseInt(timeMatch[2], 10)
        } else if (timeMatch[3]) {
          explicitMinute = parseInt(timeMatch[3], 10)
        }

        if (timeMatch[4]) {
          periodModifier = timeMatch[4].toLowerCase()
        }
      }
    }

    // If neither date nor time was matched, return null
    if (!targetDate && explicitHour === null) {
      return null
    }

    // If no Vietnamese date was matched and the text contains English date words,
    // let Chrono handle it so the English date is accurately preserved.
    if (
      !targetDate &&
      /(tomorrow|yesterday|today|next|last|\b(mon|tue|wed|thu|fri|sat|sun)\b)/i.test(lower)
    ) {
      return null
    }

    if (explicitHour !== null) {
      let finalHour = explicitHour

      if (periodModifier === 'chiều' || periodModifier === 'chieu' || periodModifier === 'pm') {
        if (finalHour < 12) finalHour += 12
      } else if (periodModifier === 'tối' || periodModifier === 'toi') {
        if (finalHour < 12) finalHour += 12
      } else if (periodModifier === 'trưa' || periodModifier === 'trua') {
        if (finalHour < 11) finalHour += 12
      } else if (
        periodModifier === 'sáng' ||
        periodModifier === 'sang' ||
        periodModifier === 'am'
      ) {
        if (finalHour === 12) finalHour = 0
      } else if (!periodModifier && baseNow.hour >= 12 && finalHour >= 1 && finalHour <= 11) {
        // Inherit afternoon/evening context from reference anchor
        finalHour += 12
      }

      const start = effectiveDate.set({
        hour: finalHour,
        minute: explicitMinute,
        second: 0,
        millisecond: 0
      })
      const end = start.plus({ hours: 1 })

      return {
        startDateTime: start.toISO()!,
        endDateTime: end.toISO()!,
        isTimeExplicit: true,
        isDateExplicit: targetDate !== null,
        matchedPhrases,
        timeZone: this.defaultTimeZone
      }
    }

    // Only date was explicit (e.g. "Ngày mai tôi có lịch gì?")
    const startOfDay = effectiveDate.startOf('day')
    const endOfDay = effectiveDate.endOf('day')

    return {
      startDateTime: startOfDay.toISO()!,
      endDateTime: endOfDay.toISO()!,
      isTimeExplicit: false,
      isDateExplicit: true,
      matchedPhrases,
      timeZone: this.defaultTimeZone
    }
  }

  /**
   * Helper to format dates cleanly for user display
   */
  public formatEventTimeRange(startIso: string, endIso: string, lang: 'vi' | 'en' = 'vi'): string {
    const start = DateTime.fromISO(startIso, { zone: this.defaultTimeZone })
    const end = DateTime.fromISO(endIso, { zone: this.defaultTimeZone })

    const dateStr = start.toFormat('dd/MM/yyyy')
    const startTimeStr = start.toFormat('HH:mm')
    const endTimeStr = end.toFormat('HH:mm')

    return lang === 'en'
      ? `${startTimeStr} - ${endTimeStr} on ${dateStr}`
      : `${startTimeStr} - ${endTimeStr}, ngày ${dateStr}`
  }
}
