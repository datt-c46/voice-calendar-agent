import { ITextToSpeechProvider } from './ITextToSpeechProvider'
import { SpeakOptions, TTSVoice } from './types'

/**
 * Web Speech API implementation of ITextToSpeechProvider.
 * Uses window.speechSynthesis natively supported by Chromium inside Electron.
 * Requires zero native dependencies and zero API keys.
 */
export class WebSpeechTtsProvider implements ITextToSpeechProvider {
  public readonly id = 'web-speech'
  public readonly name = 'Web Speech API (Browser Native)'

  private speaking = false
  private cachedVoices: TTSVoice[] | null = null

  public async isAvailable(): Promise<boolean> {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof window.speechSynthesis.speak === 'function'
    )
  }

  public async getVoices(): Promise<TTSVoice[]> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return []
    }

    if (this.cachedVoices && this.cachedVoices.length > 0) {
      return this.cachedVoices
    }

    return new Promise<TTSVoice[]>((resolve) => {
      const synth = window.speechSynthesis
      const existing = synth.getVoices()
      if (existing && existing.length > 0) {
        this.cachedVoices = this.mapVoices(existing)
        return resolve(this.cachedVoices)
      }

      // Voices may load asynchronously in Chromium
      const handleVoicesChanged = (): void => {
        synth.removeEventListener('voiceschanged', handleVoicesChanged)
        const loaded = synth.getVoices()
        this.cachedVoices = this.mapVoices(loaded)
        resolve(this.cachedVoices)
      }

      synth.addEventListener('voiceschanged', handleVoicesChanged)

      // Fallback timeout in case voiceschanged event doesn't trigger
      setTimeout(() => {
        synth.removeEventListener('voiceschanged', handleVoicesChanged)
        const fallback = synth.getVoices()
        this.cachedVoices = this.mapVoices(fallback)
        resolve(this.cachedVoices)
      }, 500)
    })
  }

  public async speak(text: string, options?: SpeakOptions): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      throw new Error('Web Speech API is not supported in this environment.')
    }

    const synth = window.speechSynthesis

    // Ensure any previously playing speech is stopped
    this.stop()

    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(trimmed)

      // Apply audio controls
      utterance.rate = options?.rate ?? 1.0
      utterance.pitch = options?.pitch ?? 1.0
      utterance.volume = options?.volume ?? 1.0

      if (options?.lang) {
        utterance.lang = options.lang
      }

      // Map voice object if supplied
      if (options?.voice) {
        const rawVoices = synth.getVoices()
        const match = rawVoices.find(
          (rv) => rv.voiceURI === options.voice?.id || rv.name === options.voice?.name
        )
        if (match) {
          utterance.voice = match
          utterance.lang = match.lang
        }
      }

      utterance.onstart = (): void => {
        this.speaking = true
        options?.onStart?.()
      }

      utterance.onend = (): void => {
        this.speaking = false
        options?.onEnd?.()
        resolve()
      }

      utterance.onerror = (event): void => {
        this.speaking = false
        // 'canceled' or 'interrupted' is expected when user calls stop()
        if (event.error === 'canceled' || event.error === 'interrupted') {
          resolve()
          return
        }

        const err = new Error(`SpeechSynthesis error: ${event.error}`)
        options?.onError?.(err)
        reject(err)
      }

      synth.speak(utterance)
    })
  }

  public stop(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    this.speaking = false
  }

  public isSpeaking(): boolean {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      return this.speaking || window.speechSynthesis.speaking
    }
    return this.speaking
  }

  private mapVoices(voices: SpeechSynthesisVoice[]): TTSVoice[] {
    return voices.map((v) => ({
      id: v.voiceURI || v.name,
      name: v.name,
      lang: v.lang,
      isDefault: v.default,
      localService: v.localService
    }))
  }
}
