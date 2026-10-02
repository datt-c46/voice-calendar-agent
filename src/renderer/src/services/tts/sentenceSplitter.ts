/**
 * Sentence Segmentation Module for Text-to-Speech (Milestone 3.2).
 *
 * Accurately segments conversational Vietnamese and English text into discrete sentences,
 * protecting decimals (3.5 giờ), times (15:30), abbreviations (TP., TS., v.v.), and ellipsis.
 */

// Common Vietnamese and English abbreviations that end with a dot but should NOT terminate a sentence
const PROTECTED_ABBREVIATIONS = [
  'TP.',
  'ThS.',
  'TS.',
  'PGS.',
  'GS.',
  'BS.',
  'DS.',
  'KS.',
  'KTS.',
  'v.v.',
  'e.g.',
  'i.e.',
  'etc.',
  'vs.',
  'Dr.',
  'Mr.',
  'Mrs.',
  'Ms.',
  'Prof.',
  'Sr.',
  'Jr.',
  'No.',
  'St.',
  'Ave.'
]

/**
 * Splits text into an array of discrete sentences suitable for sequential TTS queuing.
 *
 * @param text The input raw or formatted text.
 * @returns Array of sentence strings. Returns empty array if input is empty/whitespace.
 */
export function splitIntoSentences(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return []
  }

  let sanitized = text.trim()

  // 1. Normalize line endings and multiple spaces
  sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  sanitized = sanitized.replace(/[ \t]+/g, ' ')

  // 2. Normalize ellipsis (... or …)
  sanitized = sanitized.replace(/\.{3,}/g, '...')

  // 3. Protect decimals & version numbers: e.g. 3.5, 0.25, 1.5.0
  sanitized = sanitized.replace(/(?<=\d)\.(?=\d)/g, '__DECIMAL_DOT__')

  // 4. Protect abbreviations
  for (const abbr of PROTECTED_ABBREVIATIONS) {
    // Escape special regex dots
    const escaped = abbr.replace(/\./g, '\\.')
    const regex = new RegExp(`\\b${escaped}`, 'gi')
    const replacement = abbr.replace(/\./g, '__ABBR_DOT__')
    sanitized = sanitized.replace(regex, replacement)
  }

  // 5. Replace newline breaks that are preceded by sentence terminators with space,
  // or convert isolated newlines to sentence terminators
  sanitized = sanitized.replace(/([.?!…])\n+/g, '$1 ')
  sanitized = sanitized.replace(/\n+/g, '. ')

  // 6. Split on sentence delimiters (. ? ! …) followed by whitespace or end of string
  const rawSegments = sanitized.split(/(?<=[.?!…])\s+/)

  const sentences: string[] = []

  for (const seg of rawSegments) {
    let restored = seg.trim()
    if (!restored) {
      continue
    }

    // Restore protected tokens
    restored = restored.replace(/__DECIMAL_DOT__/g, '.')
    restored = restored.replace(/__ABBR_DOT__/g, '.')
    restored = restored.replace(/__ELLIPSIS__/g, '...')
    restored = restored.replace(/\s+/g, ' ').trim()

    // Ensure sentence is non-empty and contains alphanumeric characters
    if (restored.length > 0 && /[\p{L}\p{N}]/u.test(restored)) {
      sentences.push(restored)
    }
  }

  return sentences
}
