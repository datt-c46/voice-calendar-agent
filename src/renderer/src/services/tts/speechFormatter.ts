import { TTSVoice, VoiceSelectionResult } from './types'

/**
 * Formats a raw Agent response message for natural spoken vocalization.
 *
 * Rules:
 * 1. Strips bullet points (•, -, *) and replaces with natural pause commas.
 * 2. Removes quotes and markdown syntax (bold, italic, code blocks).
 * 3. Translates range hyphens (e.g. 15:00 - 16:00) to 'đến' for natural Vietnamese speech.
 * 4. Normalizes whitespace and avoids reading raw technical symbols.
 */
export function formatAgentResponseForSpeech(rawMessage: string): string {
  if (!rawMessage || rawMessage.trim().length === 0) {
    return ''
  }

  let text = rawMessage.trim()

  // 1. Remove markdown formatting (*, _, #, `)
  text = text.replace(/[*_#`]/g, '')

  // 2. Remove quotes (" or ')
  text = text.replace(/["']/g, '')

  // 3. Replace bullet points at start of line or after newline with conversational comma pauses
  text = text.replace(/^[•\-*]\s+/gm, ', ')
  text = text.replace(/\n+[•\-*]\s+/g, ', ')

  // 4. Replace remaining newlines with commas for pause flow
  text = text.replace(/\n+/g, ', ')

  // 5. Replace time range hyphen (e.g., "15:00 - 16:00" -> "15:00 đến 16:00")
  text = text.replace(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g, '$1 đến $2')

  // 6. Clean up multiple spaces, consecutive commas, and awkward punctuation
  text = text.replace(/\s+/g, ' ')
  text = text.replace(/,\s*,+/g, ',')
  text = text.replace(/:\s*,/g, ':')
  text = text.replace(/,\s*\./g, '.')
  text = text.replace(/^[,\s]+/, '')

  return text.trim()
}

/**
 * Voice selection algorithm based on Milestone 3.1 Section 5:
 * 1. Find voice with lang == "vi-VN" (or "vi_VN", case-insensitive)
 * 2. If unavailable, find voice beginning with "vi"
 * 3. Otherwise use the platform default voice (with an informative warning)
 */
export function selectVietnameseVoice(voices: TTSVoice[]): VoiceSelectionResult {
  if (!voices || voices.length === 0) {
    return {
      voice: null,
      isVietnamese: false,
      warning: 'Không tìm thấy giọng đọc nào trên hệ thống.'
    }
  }

  // 1. Exact match for 'vi-VN' or 'vi_VN'
  const exactVi = voices.find((v) => {
    const normalized = v.lang.replace('_', '-').toLowerCase()
    return normalized === 'vi-vn'
  })
  if (exactVi) {
    return {
      voice: exactVi,
      isVietnamese: true,
      warning: null
    }
  }

  // 2. Language starting with 'vi' (e.g. 'vi', 'vi-other')
  const partialVi = voices.find((v) => v.lang.toLowerCase().startsWith('vi'))
  if (partialVi) {
    return {
      voice: partialVi,
      isVietnamese: true,
      warning: null
    }
  }

  // 3. Fallback to default voice or first available voice
  const defaultVoice = voices.find((v) => v.isDefault) || voices[0]
  return {
    voice: defaultVoice,
    isVietnamese: false,
    warning: `Hệ thống chưa có giọng tiếng Việt (vi-VN). Đang dùng giọng mặc định: ${defaultVoice.name} (${defaultVoice.lang}).`
  }
}
