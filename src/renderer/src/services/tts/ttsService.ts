import { ITextToSpeechProvider } from './ITextToSpeechProvider'
import { WebSpeechTtsProvider } from './webSpeechProvider'
import { PiperTtsProvider } from './piperProvider'
import { MockTtsProvider } from './mockTtsProvider'
import { formatAgentResponse } from './responseFormatter'
import { selectVietnameseVoice } from './speechFormatter'
import { TTSQueue } from './ttsQueue'
import { SpeakOptions, SpeakStreamOptions, TTSStatus, TTSVoice } from './types'
import { IResponseStream } from '../streaming/types'

export type TTSStatusListener = (status: TTSStatus) => void

/**
 * High-level Text-To-Speech Service (Milestone 3.2 + Piper Integration).
 *
 * Coordinates provider lifecycle (Piper Neural TTS, Web Speech API, Mock),
 * Vietnamese voice selection, response formatting, sequential TTS queue management,
 * and state notifications.
 */
export class TextToSpeechService {
  private provider: ITextToSpeechProvider
  private queue: TTSQueue
  private selectedVoice: TTSVoice | null = null
  private isVietnameseSupported = false
  private warning: string | null = null
  private error: string | null = null
  private latencyMs: number | null = null
  private listeners: Set<TTSStatusListener> = new Set()
  private initialized = false

  constructor(customProvider?: ITextToSpeechProvider) {
    const hasPiperApi =
      typeof window !== 'undefined' &&
      'api' in window &&
      typeof (window as any).api?.piperSynthesize === 'function'

    if (customProvider) {
      this.provider = customProvider
    } else if (hasPiperApi) {
      // Prioritize local neural Piper TTS when available
      this.provider = new PiperTtsProvider()
    } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.provider = new WebSpeechTtsProvider()
    } else {
      this.provider = new MockTtsProvider()
    }

    this.queue = new TTSQueue(this.provider)

    // Forward queue status changes to service listeners
    this.queue.subscribe((queueStatus) => {
      this.error = queueStatus.error
      if (
        queueStatus.metrics.firstSentenceStartedAt &&
        queueStatus.metrics.queueCreatedAt &&
        this.latencyMs === null
      ) {
        this.latencyMs =
          queueStatus.metrics.firstSentenceStartedAt - queueStatus.metrics.queueCreatedAt
      }
      this.notifyListeners()
    })
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      const hasPiper =
        typeof window !== 'undefined' &&
        'api' in window &&
        typeof (window as any).api?.piperSynthesize === 'function'

      if (hasPiper && this.provider.id !== 'piper-tts') {
        this.provider = new PiperTtsProvider()
        this.queue.setProvider(this.provider)
      }

      const isAvail = await this.provider.isAvailable()
      if (!isAvail) {
        // Fallback chain: Piper -> Web Speech -> Mock
        if (this.provider.id === 'piper-tts' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
          console.warn('[TTS] Piper TTS unavailable, falling back to Web Speech API.')
          this.provider = new WebSpeechTtsProvider()
          this.queue.setProvider(this.provider)
        } else {
          console.warn(
            `[TTS] Provider ${this.provider.name} unavailable. Switching to Mock provider.`
          )
          this.provider = new MockTtsProvider()
          this.queue.setProvider(this.provider)
        }
      }

      await this.refreshVoices()
      this.initialized = true
    } catch (err) {
      console.error('[TTS] Error initializing TTS service:', err)
      this.error = (err as Error).message
      this.notifyListeners()
    }
  }

  public getProvider(): ITextToSpeechProvider {
    return this.provider
  }

  public async setProviderById(
    providerId: 'piper-tts' | 'web-speech' | 'mock-tts'
  ): Promise<void> {
    let newProvider: ITextToSpeechProvider
    if (providerId === 'piper-tts') {
      newProvider = new PiperTtsProvider()
    } else if (providerId === 'web-speech') {
      newProvider = new WebSpeechTtsProvider()
    } else {
      newProvider = new MockTtsProvider()
    }

    this.setProvider(newProvider)
    await this.initialize()
  }

  public async refreshVoices(): Promise<void> {
    const voices = await this.provider.getVoices()
    const selection = selectVietnameseVoice(voices)

    this.selectedVoice = selection.voice
    this.isVietnameseSupported = selection.isVietnamese
    this.warning = selection.warning

    console.log(
      `[TTS] Selected voice: ${this.selectedVoice?.name || 'none'} (${this.selectedVoice?.lang || 'none'}). Vietnamese supported: ${this.isVietnameseSupported}`
    )
    if (this.warning) {
      console.warn(`[TTS] Warning: ${this.warning}`)
    }

    this.notifyListeners()
  }

  /**
   * Vocalize an Assistant response string.
   * Formats the response, splits it into sentences, and queues them sequentially.
   */
  public async speak(text: string, options?: SpeakOptions): Promise<void> {
    const formatted = formatAgentResponse(text)
    if (!formatted.ttsText) {
      return
    }

    if (!this.initialized) {
      await this.initialize()
    }

    this.error = null
    this.latencyMs = null

    const resolvedOptions: SpeakOptions = {
      ...options,
      voice: options?.voice || this.selectedVoice,
      lang: options?.lang || this.selectedVoice?.lang || 'vi-VN'
    }

    try {
      await this.queue.speak(formatted.ttsText, resolvedOptions)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('[TTS] speak() failed:', errMsg)
      this.error = errMsg
      this.notifyListeners()
    }
  }

  /**
   * Vocalize an incremental response stream (Milestone 4.2).
   * Chunks are received from the stream, segmented by SentenceBuffer,
   * and immediately enqueued into the playback queue sentence-by-sentence.
   */
  public async speakStream(stream: IResponseStream, options?: SpeakStreamOptions): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }

    this.error = null
    this.latencyMs = null

    const resolvedOptions: SpeakStreamOptions = {
      ...options,
      voice: options?.voice || this.selectedVoice,
      lang: options?.lang || this.selectedVoice?.lang || 'vi-VN'
    }

    try {
      await this.queue.speakStream(stream, resolvedOptions)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('[TTS] speakStream() failed:', errMsg)
      this.error = errMsg
      this.notifyListeners()
    }
  }

  /**
   * Stop any active speech and clear remaining queue immediately.
   */
  public stop(): void {
    try {
      this.queue.stop()
    } catch (err) {
      console.warn('[TTS] Error during stop():', err)
    }
    this.notifyListeners()
  }

  public isSpeaking(): boolean {
    return this.queue.isSpeaking()
  }

  public getQueue(): TTSQueue {
    return this.queue
  }

  public getStatus(): TTSStatus {
    const queueStatus = this.queue.getStatus()

    return {
      state: queueStatus.state,
      isSpeaking: queueStatus.isSpeaking,
      providerId: this.provider.id,
      providerName: this.provider.name,
      selectedVoice: this.selectedVoice,
      isVietnameseSupported: this.isVietnameseSupported,
      warning: this.warning,
      error: this.error || queueStatus.error,
      latencyMs: this.latencyMs,
      progress: queueStatus.progress,
      metrics: queueStatus.metrics
    }
  }

  public subscribe(listener: TTSStatusListener): () => void {
    this.listeners.add(listener)
    listener(this.getStatus())
    return () => {
      this.listeners.delete(listener)
    }
  }

  public setProvider(provider: ITextToSpeechProvider): void {
    this.stop()
    this.provider = provider
    this.queue.setProvider(provider)
    this.initialized = false
    void this.initialize()
  }

  private notifyListeners(): void {
    const status = this.getStatus()
    this.listeners.forEach((listener) => {
      try {
        listener(status)
      } catch (err) {
        console.error('[TTS] Listener error:', err)
      }
    })
  }
}

// Global singleton instance for the renderer process
export const defaultTtsService = new TextToSpeechService()
