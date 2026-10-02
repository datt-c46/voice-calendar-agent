import { useCallback, useEffect, useState } from 'react'
import { defaultTtsService, TextToSpeechService } from '../services/tts/ttsService'
import { SpeakOptions, TTSState, TTSStatus, TTSVoice } from '../services/tts/types'

export interface UseTextToSpeechOptions {
  ttsService?: TextToSpeechService
}

export interface UseTextToSpeechReturn {
  ttsState: TTSState
  isSpeaking: boolean
  selectedVoice: TTSVoice | null
  isVietnameseSupported: boolean
  warning: string | null
  error: string | null
  latencyMs: number | null
  speak: (text: string, options?: SpeakOptions) => Promise<void>
  stop: () => void
}

export function useTextToSpeech(options?: UseTextToSpeechOptions): UseTextToSpeechReturn {
  const service = options?.ttsService || defaultTtsService
  const [status, setStatus] = useState<TTSStatus>(() => service.getStatus())

  useEffect(() => {
    void service.initialize()
    const unsubscribe = service.subscribe((nextStatus) => {
      setStatus(nextStatus)
    })

    return () => {
      unsubscribe()
      // Stop speech on unmount to clean up resources cleanly
      service.stop()
    }
  }, [service])

  const speak = useCallback(
    async (text: string, opts?: SpeakOptions): Promise<void> => {
      await service.speak(text, opts)
    },
    [service]
  )

  const stop = useCallback((): void => {
    service.stop()
  }, [service])

  return {
    ttsState: status.state,
    isSpeaking: status.isSpeaking,
    selectedVoice: status.selectedVoice,
    isVietnameseSupported: status.isVietnameseSupported,
    warning: status.warning,
    error: status.error,
    latencyMs: status.latencyMs,
    speak,
    stop
  }
}
