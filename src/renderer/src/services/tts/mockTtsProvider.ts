import { ITextToSpeechProvider } from './ITextToSpeechProvider'
import { SpeakOptions, TTSVoice } from './types'

export interface SpokenUtterance {
  text: string
  options?: SpeakOptions
  timestamp: number
  durationMs: number
}

/**
 * Deterministic Mock implementation of ITextToSpeechProvider.
 * Used for automated tests, offline headless environments, and regression verification.
 */
export class MockTtsProvider implements ITextToSpeechProvider {
  public readonly id = 'mock-tts'
  public readonly name = 'Mock TTS Provider'

  private speaking = false
  private voices: TTSVoice[]
  private spokenHistory: SpokenUtterance[] = []
  private stopRequested = false

  constructor(customVoices?: TTSVoice[]) {
    this.voices = customVoices || [
      {
        id: 'vi-VN-Standard-A',
        name: 'Microsoft HoaiMy - Vietnamese (Vietnam)',
        lang: 'vi-VN',
        isDefault: false
      },
      {
        id: 'en-US-Standard-A',
        name: 'Microsoft David - English (United States)',
        lang: 'en-US',
        isDefault: true
      }
    ]
  }

  public async isAvailable(): Promise<boolean> {
    return true
  }

  public async getVoices(): Promise<TTSVoice[]> {
    return [...this.voices]
  }

  public setVoices(voices: TTSVoice[]): void {
    this.voices = [...voices]
  }

  public async speak(text: string, options?: SpeakOptions): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }

    this.stopRequested = false
    this.speaking = true
    options?.onStart?.()

    const startTime = Date.now()
    const simulatedDurationMs = Math.min(100, Math.max(10, trimmed.length * 2))

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        if (this.stopRequested) {
          this.speaking = false
          resolve()
          return
        }

        this.speaking = false
        const utterance: SpokenUtterance = {
          text: trimmed,
          options,
          timestamp: startTime,
          durationMs: Date.now() - startTime
        }
        this.spokenHistory.push(utterance)
        options?.onEnd?.()
        resolve()
      }, simulatedDurationMs)
    })
  }

  public stop(): void {
    this.stopRequested = true
    this.speaking = false
  }

  public isSpeaking(): boolean {
    return this.speaking
  }

  public getHistory(): SpokenUtterance[] {
    return [...this.spokenHistory]
  }

  public clearHistory(): void {
    this.spokenHistory = []
  }
}
