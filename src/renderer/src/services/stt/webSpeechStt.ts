/**
 * Web Speech Recognition Provider (Chromium Native Speech-to-Text).
 * Provides high-accuracy, zero-quota, local/browser Vietnamese speech recognition.
 */

export interface SpeechRecognitionResult {
  text: string
  confidence: number
  language: string
}

export class WebSpeechRecognizer {
  private recognition: any = null
  private isListening = false
  private currentTranscript = ''
  private lastConfidence = 0.95
  private resolvePromise: ((res: SpeechRecognitionResult) => void) | null = null

  constructor(lang = 'vi-VN') {
    if (typeof window !== 'undefined') {
      const SpeechRecognitionClass =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognitionClass) {
        try {
          this.recognition = new SpeechRecognitionClass()
          this.recognition.continuous = true
          this.recognition.interimResults = true
          this.recognition.lang = lang
          this.recognition.maxAlternatives = 1

          this.recognition.onresult = (event: any) => {
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

          this.recognition.onerror = (event: any) => {
            console.warn('[WebSpeechRecognizer] Recognition event:', event.error)
          }

          this.recognition.onend = () => {
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
