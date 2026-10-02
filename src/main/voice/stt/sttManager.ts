import { ISpeechToTextProvider } from './ISpeechToTextProvider'
import { GeminiSpeechToTextProvider } from './geminiSttProvider'
import { MockSpeechToTextProvider } from './mockSttProvider'
import { AudioData, STTResult } from './types'

export class SpeechToTextManager {
  private primaryProvider: ISpeechToTextProvider
  private fallbackProvider: ISpeechToTextProvider
  private activeProvider: ISpeechToTextProvider | null = null

  constructor(
    primaryProvider: ISpeechToTextProvider = new GeminiSpeechToTextProvider(),
    fallbackProvider: ISpeechToTextProvider = new MockSpeechToTextProvider()
  ) {
    this.primaryProvider = primaryProvider
    this.fallbackProvider = fallbackProvider
  }

  async initialize(): Promise<void> {
    const isPrimaryAvailable = await this.primaryProvider.isAvailable()
    if (isPrimaryAvailable) {
      this.activeProvider = this.primaryProvider
      console.log(`[STTManager] Active STT Provider: ${this.primaryProvider.name}`)
    } else {
      this.activeProvider = this.fallbackProvider
      console.log(
        `[STTManager] GEMINI_API_KEY not configured. Falling back to: ${this.fallbackProvider.name}`
      )
    }
  }

  getActiveProvider(): ISpeechToTextProvider {
    return this.activeProvider || this.fallbackProvider
  }

  async transcribe(audio: AudioData): Promise<STTResult> {
    const provider = this.getActiveProvider()
    try {
      return await provider.transcribe(audio)
    } catch (err: unknown) {
      const errMsg = (err as Error)?.message || String(err)
      console.warn(
        `[STTManager] Primary provider (${provider.name}) encountered error: ${errMsg}. Gracefully falling back to ${this.fallbackProvider.name}.`
      )

      if (provider.id !== this.fallbackProvider.id) {
        try {
          const fallbackResult = await this.fallbackProvider.transcribe(audio)
          return fallbackResult
        } catch (fallbackErr) {
          console.error('[STTManager] Fallback provider also failed:', fallbackErr)
          throw fallbackErr
        }
      }
      throw err
    }
  }

  async getStatus(): Promise<{
    activeProviderId: string
    activeProviderName: string
    isCloudAvailable: boolean
  }> {
    const isCloudAvailable = await this.primaryProvider.isAvailable()
    const active = this.getActiveProvider()
    return {
      activeProviderId: active.id,
      activeProviderName: active.name,
      isCloudAvailable
    }
  }

  setFallbackProvider(provider: ISpeechToTextProvider): void {
    this.fallbackProvider = provider
    if (this.activeProvider?.id === 'mock-stt') {
      this.activeProvider = provider
    }
  }
}
