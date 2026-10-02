import { SpeakOptions, TTSVoice } from './types'

/**
 * Text-To-Speech Provider abstraction interface.
 * Decouples the Agent and UI from the concrete speech synthesis engine
 * (e.g. Web Speech API, Mock TTS, or future cloud TTS providers).
 */
export interface ITextToSpeechProvider {
  /** Unique identifier for the provider (e.g. 'web-speech', 'mock-tts') */
  readonly id: string

  /** Human-readable display name */
  readonly name: string

  /** Check if this provider is supported in the current environment */
  isAvailable(): Promise<boolean>

  /** Retrieve all voices supported by this provider */
  getVoices(): Promise<TTSVoice[]>

  /**
   * Synthesize and vocalize the given text.
   * Resolves when speech playback has completed or rejected on synthesis error.
   */
  speak(text: string, options?: SpeakOptions): Promise<void>

  /** Stop/cancel any ongoing speech immediately */
  stop(): void

  /** Check if speech is currently playing */
  isSpeaking(): boolean
}
