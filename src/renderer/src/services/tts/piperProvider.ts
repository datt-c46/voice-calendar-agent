import type { CalendarAgentAPI } from '../../../../shared/ipc'
import { ITextToSpeechProvider } from './ITextToSpeechProvider'
import { SpeakOptions, TTSVoice } from './types'

/** voice-backend rejects texts over TTS_MAX_CHARS (default 1000). */
export const MAX_TTS_CHARS = 900

/** Voice shown when the server list is unavailable; never sent to the server (it picks the user's voice). */
const SERVER_DEFAULT_VOICE: TTSVoice = {
  id: 'server-default',
  name: 'Giọng mặc định của server',
  lang: 'vi-VN',
  isDefault: true,
  localService: false
}

// Safe access to window.api in both renderer and node/test environments.
function getWindowApi(): CalendarAgentAPI | undefined {
  if (typeof window !== 'undefined' && 'api' in window) return window.api
  return undefined
}

/** Splits text into pieces of at most `max` chars, preferring sentence, then word boundaries. */
export function chunkTextForTts(text: string, max = MAX_TTS_CHARS): string[] {
  const chunks: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    const head = rest.slice(0, max + 1)
    let cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
    if (cut > 0) cut += 1
    else cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '))
    if (cut <= 0) cut = head.lastIndexOf(' ')
    if (cut <= 0) cut = max
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

/**
 * Piper neural TTS running on voice-backend (renderer → IPC → main → POST /tts/synthesize).
 * The voice is chosen by the server from the user's settings (`PATCH /me/settings ttsVoiceId`).
 */
export class PiperTtsProvider implements ITextToSpeechProvider {
  public readonly id = 'piper-tts'
  public readonly name = 'Piper Neural TTS (voice-backend)'

  private speaking = false
  /** Bumped by stop(): a synthesis that finishes after stop() must not start playing. */
  private generation = 0
  private currentAudio: HTMLAudioElement | null = null
  private currentBlobUrl: string | null = null
  private cachedVoices: TTSVoice[] | null = null
  private audioContext: AudioContext | null = null
  private currentSource: AudioBufferSourceNode | null = null
  private pendingResolve: (() => void) | null = null

  public async isAvailable(): Promise<boolean> {
    if (typeof window === 'undefined') return true
    const api = getWindowApi()
    if (!api?.getPiperStatus) return true
    try {
      // false while signed out or when the server has TTS disabled
      return (await api.getPiperStatus()).isAvailable
    } catch {
      return false
    }
  }

  public async getVoices(): Promise<TTSVoice[]> {
    if (this.cachedVoices && this.cachedVoices.length > 0) return this.cachedVoices

    const api = getWindowApi()
    if (!api?.getPiperVoices) return [SERVER_DEFAULT_VOICE]

    try {
      const voices = await api.getPiperVoices()
      if (voices.length > 0) {
        this.cachedVoices = voices.map((v) => ({
          id: v.id,
          name: v.name,
          lang: v.lang,
          isDefault: v.isDefault,
          localService: false
        }))
        return this.cachedVoices
      }
    } catch (err) {
      console.warn('[PiperTtsProvider] Failed to fetch server voices:', err)
    }
    return [SERVER_DEFAULT_VOICE]
  }

  public async speak(text: string, options?: SpeakOptions): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return

    // Stop previous playback if any
    this.stop()
    const generation = this.generation

    const api = getWindowApi()
    if (!api?.piperSynthesize) {
      // Offline / unit test simulation fallback
      return this.simulateFallbackSpeak(trimmed, options)
    }

    try {
      for (const chunk of chunkTextForTts(trimmed)) {
        const result = await api.piperSynthesize({
          text: chunk,
          ...(options?.rate !== undefined && options.rate !== 1 ? { rate: options.rate } : {})
        })
        if (generation !== this.generation) return // stopped while synthesizing
        if (!result?.audioBase64) throw new Error('Piper TTS returned empty audio payload.')
        await this.playAudioFromBase64(result.audioBase64, result.mimeType, options)
        if (generation !== this.generation) return
      }
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(String(err))
      console.error('[PiperTtsProvider] Synthesis/playback error:', errorObj)
      this.speaking = false
      options?.onError?.(errorObj)
      throw errorObj
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return null
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
    const byteCharacters = atob(base64.replace(/\s+/g, ''))
    const arrayBuffer = new ArrayBuffer(byteCharacters.length)
    const byteArray = new Uint8Array(arrayBuffer)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArray[i] = byteCharacters.charCodeAt(i)
    }

    const ctx = this.getAudioContext()

    // 1. Primary: Web Audio API playback (the server already applied the speaking rate)
    if (ctx) {
      return new Promise<void>((resolve) => {
        this.pendingResolve = resolve
        ctx.decodeAudioData(
          arrayBuffer.slice(0),
          (audioBuffer) => {
            if (this.pendingResolve !== resolve) return // stopped while decoding
            const source = ctx.createBufferSource()
            source.buffer = audioBuffer

            const gainNode = ctx.createGain()
            const vol = options?.volume !== undefined ? options.volume : 1.0
            gainNode.gain.value = Math.max(0, Math.min(1, vol))

            source.connect(gainNode)
            gainNode.connect(ctx.destination)

            this.currentSource = source
            this.speaking = true
            options?.onStart?.()

            source.onended = () => {
              this.speaking = false
              if (this.currentSource === source) this.currentSource = null
              this.settle(resolve)
              options?.onEnd?.()
            }

            source.start(0)
          },
          (decodeErr) => {
            console.warn(
              '[PiperTtsProvider] decodeAudioData error, falling back to Audio element:',
              decodeErr
            )
            this.fallbackAudioElementPlay(arrayBuffer, mimeType, options, resolve)
          }
        )
      })
    }

    // 2. Secondary fallback: HTMLAudioElement
    return new Promise<void>((resolve) => {
      this.pendingResolve = resolve
      this.fallbackAudioElementPlay(arrayBuffer, mimeType, options, resolve)
    })
  }

  /** Resolves a playback promise once (stop() also resolves it so the queue never hangs). */
  private settle(resolve: () => void): void {
    if (this.pendingResolve === resolve) this.pendingResolve = null
    resolve()
  }

  private fallbackAudioElementPlay(
    audioData: ArrayBuffer,
    mimeType: string,
    options: SpeakOptions | undefined,
    resolve: () => void
  ): void {
    const finish = (): void => {
      this.cleanupCurrentAudio()
      options?.onEnd?.()
      this.settle(resolve)
    }
    try {
      const blobUrl = URL.createObjectURL(new Blob([audioData], { type: mimeType || 'audio/wav' }))
      this.currentBlobUrl = blobUrl
      const audio = new Audio(blobUrl)
      this.currentAudio = audio

      const vol = options?.volume !== undefined ? options.volume : 1.0
      audio.volume = Math.max(0, Math.min(1, vol))

      audio.onplay = () => {
        this.speaking = true
        options?.onStart?.()
      }
      audio.onended = finish
      audio.onerror = finish
      audio.play().catch((playErr) => {
        console.warn('[PiperTtsProvider] audio.play() promise catch:', playErr)
        finish()
      })
    } catch {
      finish()
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
    this.generation++
    if (this.currentSource) {
      try {
        this.currentSource.stop()
      } catch {
        // already stopped
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
    const pending = this.pendingResolve
    if (pending) this.settle(pending)
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
