import { ITextToSpeechProvider } from './ITextToSpeechProvider'
import { SpeakOptions, TTSVoice } from './types'

/**
 * Piper Neural Text-to-Speech Provider.
 * Connects renderer to local Piper neural TTS engine running in the Electron Main process.
 * Provides high-quality offline Vietnamese neural voices (e.g. VIVOS, 25Hours).
 */
// Helper to safely access window.api in both renderer and node/test environments
function getWindowApi(): any {
  if (typeof window !== 'undefined' && 'api' in window) {
    return (window as any).api
  }
  return undefined
}

export class PiperTtsProvider implements ITextToSpeechProvider {
  public readonly id = 'piper-tts'
  public readonly name = 'Piper Neural TTS (Local)'

  private speaking = false
  private currentAudio: HTMLAudioElement | null = null
  private currentBlobUrl: string | null = null
  private cachedVoices: TTSVoice[] | null = null

  public async isAvailable(): Promise<boolean> {
    if (typeof window === 'undefined') {
      return true
    }
    const api = getWindowApi()
    if (!api?.getPiperStatus) {
      return true
    }

    try {
      const status = await api.getPiperStatus()
      return status?.isAvailable ?? true
    } catch {
      return true
    }
  }

  public async getVoices(): Promise<TTSVoice[]> {
    if (this.cachedVoices && this.cachedVoices.length > 0) {
      return this.cachedVoices
    }

    const api = getWindowApi()
    if (!api?.getPiperVoices) {
      return [
        {
          id: 'vi_VN-vivos-x_low',
          name: 'Piper Vietnamese VIVOS (x_low)',
          lang: 'vi-VN',
          isDefault: true,
          localService: true
        },
        {
          id: 'vi_VN-25hours-low',
          name: 'Piper Vietnamese 25Hours (low)',
          lang: 'vi-VN',
          isDefault: false,
          localService: true
        }
      ]
    }

    try {
      const piperVoices = await api.getPiperVoices()
      if (piperVoices && piperVoices.length > 0) {
        this.cachedVoices = piperVoices.map((v: any) => ({
          id: v.id,
          name: v.name,
          lang: v.lang,
          isDefault: v.isDefault,
          localService: true
        }))
        return this.cachedVoices || []
      }
    } catch (err) {
      console.warn('[PiperTtsProvider] Failed to fetch voices from Main process:', err)
    }

    // Default fallback voices
    return [
      {
        id: 'vi_VN-vivos-x_low',
        name: 'Piper Vietnamese VIVOS (x_low)',
        lang: 'vi-VN',
        isDefault: true,
        localService: true
      },
      {
        id: 'vi_VN-25hours-low',
        name: 'Piper Vietnamese 25Hours (low)',
        lang: 'vi-VN',
        isDefault: false,
        localService: true
      }
    ]
  }

  public async speak(text: string, options?: SpeakOptions): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }

    // Stop previous playback if any
    this.stop()

    const api = getWindowApi()
    if (!api?.piperSynthesize) {
      // Offline / unit test simulation fallback
      return this.simulateFallbackSpeak(trimmed, options)
    }

    try {
      const voiceId = options?.voice?.id || 'vi_VN-vivos-x_low'
      const synthesizeResult = await api.piperSynthesize({
        text: trimmed,
        voiceId,
        rate: options?.rate ?? 1.0,
        pitch: options?.pitch ?? 1.0,
        volume: options?.volume ?? 1.0
      })

      if (!synthesizeResult || !synthesizeResult.audioBase64) {
        throw new Error('Piper TTS returned empty audio payload.')
      }

      await this.playAudioFromBase64(synthesizeResult.audioBase64, synthesizeResult.mimeType, options)
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(String(err))
      console.error('[PiperTtsProvider] Synthesis/playback error:', errorObj)
      this.speaking = false
      options?.onError?.(errorObj)
      throw errorObj
    }
  }

  private audioContext: AudioContext | null = null
  private currentSource: AudioBufferSourceNode | null = null

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') {
      return null
    }
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) {
      return null
    }
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioCtx()
    }
    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume()
    }
    return this.audioContext
  }

  private playAudioFromBase64(
    base64: string,
    mimeType = 'audio/wav',
    options?: SpeakOptions
  ): Promise<void> {
    const cleanBase64 = base64.replace(/\s+/g, '')
    const byteCharacters = atob(cleanBase64)
    const arrayBuffer = new ArrayBuffer(byteCharacters.length)
    const byteArray = new Uint8Array(arrayBuffer)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArray[i] = byteCharacters.charCodeAt(i)
    }

    const ctx = this.getAudioContext()

    // 1. Primary: High-fidelity Web Audio API playback
    if (ctx) {
      return new Promise<void>((resolve) => {
        ctx.decodeAudioData(
          arrayBuffer.slice(0),
          (audioBuffer) => {
            const source = ctx.createBufferSource()
            source.buffer = audioBuffer

            const gainNode = ctx.createGain()
            const vol = options?.volume !== undefined ? options.volume : 1.0
            gainNode.gain.value = Math.max(0, Math.min(1, vol))

            if (options?.rate !== undefined && options.rate > 0) {
              source.playbackRate.value = Math.max(0.25, Math.min(4.0, options.rate))
            }

            source.connect(gainNode)
            gainNode.connect(ctx.destination)

            this.currentSource = source
            this.speaking = true
            options?.onStart?.()

            source.onended = () => {
              this.speaking = false
              this.currentSource = null
              options?.onEnd?.()
              resolve()
            }

            source.start(0)
          },
          (decodeErr) => {
            console.warn('[PiperTtsProvider] decodeAudioData error, falling back to Audio element:', decodeErr)
            this.fallbackAudioElementPlay(byteArray, mimeType, options, resolve)
          }
        )
      })
    }

    // 2. Secondary fallback: HTMLAudioElement
    return new Promise<void>((resolve) => {
      this.fallbackAudioElementPlay(byteArray, mimeType, options, resolve)
    })
  }

  private fallbackAudioElementPlay(
    byteArray: Uint8Array,
    mimeType: string,
    options: SpeakOptions | undefined,
    resolve: () => void
  ): void {
    try {
      const blob = new Blob([byteArray as any], { type: mimeType || 'audio/wav' })
      const blobUrl = URL.createObjectURL(blob)

      this.currentBlobUrl = blobUrl
      const audio = new Audio(blobUrl)
      this.currentAudio = audio

      const vol = options?.volume !== undefined ? options.volume : 1.0
      audio.volume = Math.max(0, Math.min(1, vol))
      if (options?.rate !== undefined) {
        audio.playbackRate = Math.max(0.25, Math.min(4.0, options.rate))
      }

      audio.onplay = () => {
        this.speaking = true
        options?.onStart?.()
      }

      audio.onended = () => {
        this.cleanupCurrentAudio()
        options?.onEnd?.()
        resolve()
      }

      audio.onerror = () => {
        this.cleanupCurrentAudio()
        options?.onEnd?.()
        resolve()
      }

      audio.play().catch((playErr) => {
        console.warn('[PiperTtsProvider] audio.play() promise catch:', playErr)
        this.cleanupCurrentAudio()
        options?.onEnd?.()
        resolve()
      })
    } catch {
      this.cleanupCurrentAudio()
      options?.onEnd?.()
      resolve()
    }
  }

  private simulateFallbackSpeak(text: string, options?: SpeakOptions): Promise<void> {
    this.speaking = true
    options?.onStart?.()

    const durationMs = Math.min(100, Math.max(10, text.length * 2))

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        this.speaking = false
        options?.onEnd?.()
        resolve()
      }, durationMs)
    })
  }

  public stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop()
      } catch {
        // Ignore
      }
      this.currentSource = null
    }
    if (this.currentAudio) {
      try {
        this.currentAudio.pause()
        this.currentAudio.currentTime = 0
      } catch (err) {
        console.warn('[PiperTtsProvider] Error pausing audio:', err)
      }
    }
    this.cleanupCurrentAudio()
  }

  public isSpeaking(): boolean {
    return this.speaking
  }

  private cleanupCurrentAudio(): void {
    this.speaking = false
    if (this.currentBlobUrl) {
      try {
        URL.revokeObjectURL(this.currentBlobUrl)
      } catch {
        // Ignore blob revoke error
      }
      this.currentBlobUrl = null
    }
    this.currentAudio = null
  }
}
