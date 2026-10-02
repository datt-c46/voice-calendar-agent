import { ISpeechToTextProvider } from './ISpeechToTextProvider'
import { AudioData, STTResult } from './types'

export class MockSpeechToTextProvider implements ISpeechToTextProvider {
  public readonly id = 'mock-stt'
  public readonly name = 'Mock Speech-to-Text Fallback'

  private mockResponses: string[] = []
  private responseIndex = 0

  constructor(initialResponses?: string[]) {
    if (initialResponses && initialResponses.length > 0) {
      this.mockResponses = initialResponses
    }
  }

  setMockResponses(responses: string[]): void {
    this.mockResponses = responses
    this.responseIndex = 0
  }

  addMockResponse(response: string): void {
    this.mockResponses.push(response)
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  async transcribe(audio: AudioData): Promise<STTResult> {
    if (!audio.base64 && !audio.buffer) {
      throw new Error('No audio data provided for transcription.')
    }

    const defaultPhrases = [
      'Ngày mai tôi có lịch gì?',
      'Chiều mai lúc 3 giờ họp với A',
      'Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ',
      'Xóa cuộc họp lúc 4 giờ chiều ngày mai',
      'Ngày mai tôi có cuộc họp nào không?',
      'What do I have tomorrow?'
    ]

    let text: string
    if (this.mockResponses.length > 0) {
      text = this.mockResponses[this.responseIndex % this.mockResponses.length]
      this.responseIndex++
    } else {
      text = defaultPhrases[this.responseIndex % defaultPhrases.length]
      this.responseIndex++
    }

    const language = this.detectLanguage(text)
    const latencyMs = audio.durationMs || 150
    const audioDurationMs = audio.durationMs || 1000

    console.log(
      `\n[STT]\n` +
        `provider=${this.name} (${this.id})\n` +
        `interactionId=${audio.interactionId || 'N/A'}\n` +
        `audioDuration=${audioDurationMs}ms\n` +
        `languageConfig=${audio.language || 'auto'}\n` +
        `detectedLanguage=${language}\n` +
        `latency=${latencyMs}ms\n` +
        `raw="${text}"\n`
    )

    return {
      text,
      language,
      provider: this.id,
      durationMs: latencyMs,
      audioDurationMs,
      confidence: 0.99,
      interactionId: audio.interactionId
    }
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
}
