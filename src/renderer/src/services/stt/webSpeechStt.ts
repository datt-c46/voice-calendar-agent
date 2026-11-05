/**
 * Web Speech Recognition Provider (Chromium Native Speech-to-Text).
 * Provides high-accuracy, zero-quota, local/browser Vietnamese speech recognition.
 */

export interface SpeechRecognitionResult {
  text: string
  confidence: number
  language: string
}

// Minimal typings for the (prefixed) Web Speech API, which TypeScript's DOM lib does not ship.
interface RecognitionAlternative {
  transcript: string
  confidence: number
}
interface RecognitionResultLike {
  readonly isFinal: boolean
  readonly [index: number]: RecognitionAlternative
}
interface RecognitionEventLike {
  resultIndex: number
  results: ArrayLike<RecognitionResultLike>
}
interface RecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onresult: ((event: RecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => RecognitionLike

export class WebSpeechRecognizer {
  private recognition: RecognitionLike | null = null
  private isListening = false
  private currentTranscript = ''
  private lastConfidence = 0.95
  private resolvePromise: ((res: SpeechRecognitionResult) => void) | null = null

  constructor(lang = 'vi-VN') {
    if (typeof window !== 'undefined') {
      const w = window as unknown as {
        SpeechRecognition?: RecognitionCtor
        webkitSpeechRecognition?: RecognitionCtor
      }
      const SpeechRecognitionClass = w.SpeechRecognition || w.webkitSpeechRecognition
      if (SpeechRecognitionClass) {
        try {
          const recognition = new SpeechRecognitionClass()
          this.recognition = recognition
          recognition.continuous = true
          recognition.interimResults = true
          recognition.lang = lang
          recognition.maxAlternatives = 1

          recognition.onresult = (event) => {
            let interim = ''
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const res = event.results[i]
              if (res.isFinal) {
                this.currentTranscript += res[0].transcript
              } else {
                interim += res[0].transcript
              }
              if (res[0].confidence) {
                this.lastConfidence = res[0].confidence
              }
            }
            if (interim) {
              console.log('[WebSpeechRecognizer] Interim:', interim)
            }
          }

          recognition.onerror = (event) => {
            console.warn('[WebSpeechRecognizer] Recognition event:', event.error)
          }

          recognition.onend = () => {
            this.isListening = false
            if (this.resolvePromise) {
              const final = this.currentTranscript.trim()
              this.resolvePromise({
                text: final,
                confidence: this.lastConfidence,
                language: lang.startsWith('vi') ? 'vi' : 'en'
              })
              this.resolvePromise = null
            }
          }
        } catch (err) {
          console.warn('[WebSpeechRecognizer] Could not initialize SpeechRecognition:', err)
        }
      }
    }
  }

  public isAvailable(): boolean {
    return this.recognition !== null
  }

  public start(): void {
    if (!this.recognition || this.isListening) {
      return
    }

    try {
      this.currentTranscript = ''
      this.isListening = true
      this.recognition.start()
      console.log('[WebSpeechRecognizer] Started listening (vi-VN)...')
    } catch (err) {
      console.warn('[WebSpeechRecognizer] Start error:', err)
      this.isListening = false
    }
  }

  public stop(): Promise<SpeechRecognitionResult> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve

      if (!this.recognition || !this.isListening) {
        resolve({
          text: this.currentTranscript.trim(),
          confidence: this.lastConfidence,
          language: 'vi'
        })
        return
      }

      try {
        this.recognition.stop()
      } catch {
        this.isListening = false
        resolve({
          text: this.currentTranscript.trim(),
          confidence: this.lastConfidence,
          language: 'vi'
        })
      }

      // Safety timeout in case onend does not fire
      setTimeout(() => {
        if (this.resolvePromise) {
          const final = this.currentTranscript.trim()
          this.resolvePromise({
            text: final,
            confidence: this.lastConfidence,
            language: 'vi'
          })
          this.resolvePromise = null
        }
      }, 600)
    })
  }

  public getTranscript(): string {
    return this.currentTranscript.trim()
  }

  public abort(): void {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.abort()
      } catch {
        // Ignore abort error
      }
      this.isListening = false
      this.currentTranscript = ''
      this.resolvePromise = null
    }
  }
}
