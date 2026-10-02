import { FormattedResponse } from './types'
import { splitIntoSentences } from './sentenceSplitter'

export interface AgentResponseInput {
  message: string
  intent?: string
  events?: Array<{
    id: string
    summary: string
    start: { dateTime: string; timeZone?: string }
    end: { dateTime: string; timeZone?: string }
  }>
}

/**
 * Formats a raw agent response into distinct UI text and conversational TTS text.
 * Separates visual layout (e.g. structured bullet lists) from spoken acoustic flow.
 */
export function formatAgentResponse(input: AgentResponseInput | string): FormattedResponse {
  const rawMessage = typeof input === 'string' ? input : input.message || ''

  if (!rawMessage || rawMessage.trim().length === 0) {
    return {
      uiText: '',
      ttsText: '',
      sentences: []
    }
  }

  // 1. UI Text preserves structured bullet points and clean formatting
  const uiText = rawMessage.trim()

  // 2. TTS Text: Conversational speech adaptation
  let ttsText = rawMessage.trim()

  // Remove markdown bold/italic/code syntax
  ttsText = ttsText.replace(/[*_#`]/g, '')

  // Remove quotes around event summaries
  ttsText = ttsText.replace(/["']/g, '')

  // Replace bullet points (•, -, *) with a period to create distinct sentence boundaries
  ttsText = ttsText.replace(/^[•\-*]\s+/gm, '')
  ttsText = ttsText.replace(/\n+[•\-*]\s+/g, '. ')

  // Replace remaining newlines with periods for natural sentence pacing
  ttsText = ttsText.replace(/\n+/g, '. ')

  // Replace time range hyphens with 'đến' (e.g., "15:00 - 16:00" -> "15:00 đến 16:00")
  ttsText = ttsText.replace(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g, '$1 đến $2')

  // Clean consecutive periods or colons followed by periods
  ttsText = ttsText.replace(/:\s*\./g, '.')
  ttsText = ttsText.replace(/\.{2,}/g, '.')
  ttsText = ttsText.replace(/\s+/g, ' ').trim()

  // Ensure ttsText ends with a period
  if (ttsText.length > 0 && !/[.?!]$/.test(ttsText)) {
    ttsText += '.'
  }

  // 3. Sentence segmentation
  const sentences = splitIntoSentences(ttsText)

  return {
    uiText,
    ttsText,
    sentences
  }
}
