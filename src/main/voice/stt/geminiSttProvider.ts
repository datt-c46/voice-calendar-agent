import { GoogleGenAI } from '@google/genai'
import { loadEnvConfig } from '../../auth/envConfig'
import { ISpeechToTextProvider } from './ISpeechToTextProvider'
import { AudioData, STTResult } from './types'

export class GeminiSpeechToTextProvider implements ISpeechToTextProvider {
  public readonly id = 'gemini-stt'
  public readonly name = 'Google Gemini Multimodal STT'

  private aiClient: GoogleGenAI | null = null
  private readonly candidateModels: string[]
  private activeModelIndex = 0

  constructor(modelName?: string) {
    const envModel = process.env.GEMINI_MODEL
    const models = [
      envModel,
      modelName,
      'gemini-3.8-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ].filter(Boolean) as string[]

    // Deduplicate
    this.candidateModels = Array.from(new Set(models))
  }

  private getApiKey(): string | undefined {
    loadEnvConfig()
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  }

  async isAvailable(): Promise<boolean> {
    const key = this.getApiKey()
    return Boolean(key && key.trim().length > 0)
  }

  async transcribe(audio: AudioData): Promise<STTResult> {
    const apiKey = this.getApiKey()
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in environment variables.')
    }

    if (!audio.base64 && !audio.buffer) {
      throw new Error('No audio data provided for transcription.')
    }

    const base64Data = audio.base64 || audio.buffer!.toString('base64')
    const mimeType = audio.mimeType || 'audio/wav'

    if (!this.aiClient) {
      this.aiClient = new GoogleGenAI({ apiKey })
    }

    const startTime = Date.now()

    // Calculate audio duration if not passed (16kHz 16-bit mono PCM in WAV = 32000 bytes/sec)
    const rawByteLength = audio.buffer
      ? audio.buffer.length
      : Math.floor((base64Data.length * 3) / 4)
    const calculatedDurationMs =
      audio.durationMs || Math.max(100, Math.round(((rawByteLength - 44) / 32000) * 1000))

    let lastError: Error | null = null

    // Try candidate models sequentially if one is rate limited
    for (let i = this.activeModelIndex; i < this.candidateModels.length; i++) {
      const model = this.candidateModels[i]
      try {
        const response = await this.aiClient.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: base64Data
                  }
                },
                {
                  text:
                    'You are a high-accuracy, verbatim speech-to-text transcriber.\n' +
                    'RULES:\n' +
                    '1. Transcribe the spoken audio EXACTLY as spoken in the original language (Vietnamese or English).\n' +
                    '2. If Vietnamese is spoken, output standard Vietnamese with accurate accents and tone marks (e.g. "Ngày mai tôi có lịch gì?", "Chiều mai lúc 3 giờ họp với A").\n' +
                    '3. If English is spoken, output standard English (e.g. "What do I have tomorrow?", "Create a meeting with A tomorrow at 3 PM").\n' +
                    '4. NEVER translate the audio into English or any other language.\n' +
                    '5. NEVER answer questions, summarize, or execute commands.\n' +
                    '6. Output ONLY the raw transcription text without quotes, markdown, prefixes, or explanations.'
                }
              ]
            }
          ]
        })

        this.activeModelIndex = i // Stick with working model
        const latencyMs = Date.now() - startTime
        let transcribedText = response.text ? response.text.trim() : ''

        // Clean any accidental outer quotation marks, codeblocks, or labels
        transcribedText = transcribedText
          .replace(/^["'`“]+|["'`”]+$/g, '')
          .replace(/^```[\w]*\n?|```$/g, '')
          .replace(/^(transcription|transcript):\s*/i, '')
          .trim()

        // Language detection
        const language = this.detectLanguage(transcribedText)

        console.log(
          `\n[STT]\n` +
            `provider=${this.name} (${model})\n` +
            `interactionId=${audio.interactionId || 'N/A'}\n` +
            `audioDuration=${calculatedDurationMs}ms\n` +
            `languageConfig=${audio.language || 'auto'}\n` +
            `detectedLanguage=${language}\n` +
            `latency=${latencyMs}ms\n` +
            `raw="${transcribedText}"\n`
        )

        return {
          text: transcribedText,
          language,
          provider: this.id,
          durationMs: latencyMs,
          audioDurationMs: calculatedDurationMs,
          confidence: 0.95,
          interactionId: audio.interactionId
        }
      } catch (err: unknown) {
        lastError = err as Error
        const errMsg = lastError?.message || String(err)
        console.warn(`[GeminiSTT] Model ${model} error: ${errMsg}. Trying next candidate model...`)
      }
    }

    const finalErrMsg = lastError?.message || 'Gemini STT request failed across all candidate models'
    console.error('[GeminiSTT] All models exhausted:', finalErrMsg)
    throw new Error(finalErrMsg)
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
