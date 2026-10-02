import { useCallback, useEffect, useRef, useState } from 'react'
import { MicVAD, RealTimeVADOptions } from '@ricky0123/vad-web'
import { useMicrophone } from './useMicrophone'
import { float32ToWavBase64 } from '../utils/audioEncoder'
import { defaultTtsService } from '../services/tts/ttsService'
import { formatAgentResponse } from '../services/tts/responseFormatter'
import { createMockResponseStream } from '../services/streaming'
import { TTSQueueProgress } from '../services/tts/types'
import { defaultLatencyTracker, LatencyMetrics } from '../services/telemetry'
import { WebSpeechRecognizer } from '../services/stt/webSpeechStt'

export type VadState =
  | 'idle'
  | 'initializing'
  | 'listening'
  | 'speaking'
  | 'speech-ended'
  | 'transcribing'
  | 'processing'
  | 'speaking-assistant'
  | 'success'
  | 'error'

export interface LastSpeechInfo {
  durationMs: number
  timestamp: number
  samples: number
}

export interface PipelineLatency {
  sttMs: number
  agentMs: number
  ttsMs?: number
  totalMs: number
  ttfaMs?: number
  ttfsMs?: number
  interactionId?: string
}

export interface AgentExecutionResult {
  success: boolean
  message: string
  intent?: string
  events?: Array<{
    id: string
    summary: string
    start: { dateTime: string; timeZone?: string }
    end: { dateTime: string; timeZone?: string }
  }>
  error?: string
}

export interface UseVoiceActivityOptions {
  onVoiceCommand?: (text: string) => Promise<AgentExecutionResult | undefined>
  isAssistantSpeaking?: boolean
}

export interface UseVoiceActivityReturn {
  vadState: VadState
  isSpeechDetected: boolean
  start: () => Promise<void>
  stop: () => void
  audioLevel: number
  error: string | null
  speechCount: number
  lastSpeechInfo: LastSpeechInfo | null
  transcription: string | null
  transcriptionLatencyMs: number | null
  transcriptionLanguage: string | undefined
  agentResult: AgentExecutionResult | null
  pipelineLatency: PipelineLatency | null
  latencyMetrics: LatencyMetrics | null
  interactionId: string | null
  clearTranscription: () => void
  isAssistantSpeaking: boolean
  ttsWarning: string | null
  ttsProgress?: TTSQueueProgress
  stopSpeaking: () => void
  speakResponse: (text?: string) => Promise<void>
}

export function useVoiceActivity(options?: UseVoiceActivityOptions): UseVoiceActivityReturn {
  const { onVoiceCommand } = options || {}
  const mic = useMicrophone()
  const [vadState, setVadState] = useState<VadState>('idle')
  const [isSpeechDetected, setIsSpeechDetected] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [speechCount, setSpeechCount] = useState<number>(0)
  const [lastSpeechInfo, setLastSpeechInfo] = useState<LastSpeechInfo | null>(null)

  // STT Transcription & Agent execution state
  const [transcription, setTranscription] = useState<string | null>(null)
  const [transcriptionLatencyMs, setTranscriptionLatencyMs] = useState<number | null>(null)
  const [transcriptionLanguage, setTranscriptionLanguage] = useState<string | undefined>(undefined)
  const [agentResult, setAgentResult] = useState<AgentExecutionResult | null>(null)
  const [pipelineLatency, setPipelineLatency] = useState<PipelineLatency | null>(null)
  const [latencyMetrics, setLatencyMetrics] = useState<LatencyMetrics | null>(null)
  const [interactionId, setInteractionId] = useState<string | null>(null)

  // TTS State & Feedback Loop Prevention
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState<boolean>(false)
  const [ttsWarning, setTtsWarning] = useState<string | null>(null)
  const [ttsProgress, setTtsProgress] = useState<TTSQueueProgress | undefined>(undefined)
  const isAssistantSpeakingRef = useRef<boolean>(false)
  const assistantCooldownUntilRef = useRef<number>(0)

  const vadRef = useRef<MicVAD | null>(null)
  const recognizerRef = useRef<WebSpeechRecognizer | null>(null)
  const speechStartTimestampRef = useRef<number | null>(null)
  const speechEndTimeoutRef = useRef<number | null>(null)
  const isProcessingRef = useRef<boolean>(false)

  // Initialize WebSpeechRecognizer
  useEffect(() => {
    recognizerRef.current = new WebSpeechRecognizer('vi-VN')
    return () => {
      recognizerRef.current?.abort()
    }
  }, [])

  // Subscribe to TTS Service status
  useEffect(() => {
    void defaultTtsService.initialize()
    const unsub = defaultTtsService.subscribe((ttsStatus) => {
      setIsAssistantSpeaking(ttsStatus.isSpeaking)
      setTtsWarning(ttsStatus.warning)
      setTtsProgress(ttsStatus.progress)

      if (isAssistantSpeakingRef.current && !ttsStatus.isSpeaking) {
        // Speech ended; add 400ms cooldown to ensure speaker acoustics clear
        assistantCooldownUntilRef.current = Date.now() + 400
      }
      isAssistantSpeakingRef.current = ttsStatus.isSpeaking
    })

    return () => {
      unsub()
      defaultTtsService.stop()
    }
  }, [])

  // Internal helper to stop VAD instance cleanly
  const destroyVad = useCallback(async (): Promise<void> => {
    if (speechEndTimeoutRef.current !== null) {
      clearTimeout(speechEndTimeoutRef.current)
      speechEndTimeoutRef.current = null
    }

    recognizerRef.current?.abort()

    if (vadRef.current) {
      try {
        await vadRef.current.destroy()
      } catch (destroyErr) {
        console.warn('[VAD] Warning during VAD destroy:', destroyErr)
      }
      vadRef.current = null
    }
  }, [])

  const stop = useCallback((): void => {
    if (vadState === 'idle') {
      return
    }

    recognizerRef.current?.abort()
    defaultLatencyTracker.recordCancel('User stopped microphone')
    defaultTtsService.stop()
    isAssistantSpeakingRef.current = false
    void destroyVad()
    mic.stop()
    setVadState('idle')
    setIsSpeechDetected(false)
  }, [vadState, destroyVad, mic])

  const stopSpeaking = useCallback((): void => {
    defaultLatencyTracker.recordCancel('User stopped assistant speaking')
    defaultTtsService.stop()
    setIsAssistantSpeaking(false)
    isAssistantSpeakingRef.current = false
    assistantCooldownUntilRef.current = Date.now() + 100
  }, [])

  const speakResponse = useCallback(
    async (text?: string): Promise<void> => {
      const msg = text || agentResult?.message
      if (msg) {
        setVadState('speaking-assistant')
        try {
          const formatted = formatAgentResponse(msg)
          const stream = createMockResponseStream(formatted.ttsText || msg, { chunkDelayMs: 30 })
          await defaultTtsService.speakStream(stream)
        } finally {
          setVadState('success')
        }
      }
    },
    [agentResult]
  )

  const clearTranscription = useCallback((): void => {
    setTranscription(null)
    setTranscriptionLatencyMs(null)
    setTranscriptionLanguage(undefined)
    setAgentResult(null)
    setPipelineLatency(null)
    setLatencyMetrics(null)
    setInteractionId(null)
  }, [])

  const start = useCallback(async (): Promise<void> => {
    if (
      vadState === 'initializing' ||
      vadState === 'listening' ||
      vadState === 'speaking' ||
      vadState === 'transcribing' ||
      vadState === 'processing' ||
      vadState === 'speaking-assistant'
    ) {
      return
    }

    setVadState('initializing')
    setError(null)

    // Ensure any previously existing VAD instance is destroyed first
    await destroyVad()

    try {
      // 1. Acquire microphone stream and AudioContext via M2.1 capture
      const micResult = await mic.start()
      if (!micResult) {
        setVadState('error')
        setError(mic.error || 'Không thể cấp quyền truy cập Microphone.')
        return
      }

      const { stream, audioContext } = micResult

      // Determine the asset base URL dynamically:
      // In development / HTTP dev server, use the full origin path (e.g. "http://localhost:5173/vad/")
      // In production / file protocol, use "./vad/"
      const isHttp = typeof window !== 'undefined' && window.location.protocol.startsWith('http')
      const vadBaseUrl = isHttp ? `${window.location.origin}/vad/` : './vad/'

      // 2. Configure Silero VAD options
      const vadOptions: Partial<RealTimeVADOptions> = {
        getStream: async () => stream,
        audioContext: audioContext,
        baseAssetPath: vadBaseUrl,
        onnxWASMBasePath: vadBaseUrl,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        redemptionMs: 400,
        minSpeechMs: 250,
        preSpeechPadMs: 400,
        startOnLoad: true,
        ortConfig: (ort) => {
          ort.env.logLevel = 'error'
          ort.env.wasm.numThreads = 1
          ort.env.wasm.simd = true
          ort.env.wasm.proxy = false
          ort.env.wasm.wasmPaths = vadBaseUrl
        },
        onSpeechStart: () => {
          if (isAssistantSpeakingRef.current || Date.now() < assistantCooldownUntilRef.current) {
            console.log(
              '[VAD] Ignored speech start: Assistant TTS is active (feedback loop suppression)'
            )
            return
          }

          console.log('[VAD] Speech start detected')
          recognizerRef.current?.start()

          if (speechEndTimeoutRef.current !== null) {
            clearTimeout(speechEndTimeoutRef.current)
            speechEndTimeoutRef.current = null
          }
          speechStartTimestampRef.current = Date.now()
          const newId = defaultLatencyTracker.startInteraction()
          setInteractionId(newId)
          defaultLatencyTracker.recordEvent('SPEECH_START')
          setIsSpeechDetected(true)
          setVadState('speaking')
        },
        onSpeechEnd: async (audio: Float32Array) => {
          if (isAssistantSpeakingRef.current || Date.now() < assistantCooldownUntilRef.current) {
            console.log(
              '[VAD] Ignored speech end segment: Assistant TTS is active (feedback loop suppression)'
            )
            recognizerRef.current?.abort()
            return
          }

          const startTime = speechStartTimestampRef.current || Date.now()
          const durationMs = Date.now() - startTime
          console.log(
            `[VAD] Speech end detected: duration=${durationMs}ms, samples=${audio.length}`
          )

          defaultLatencyTracker.recordEvent('SPEECH_END', {
            durationMs,
            samples: audio.length
          })

          setIsSpeechDetected(false)
          setSpeechCount((prev) => prev + 1)
          setLastSpeechInfo({
            durationMs,
            timestamp: Date.now(),
            samples: audio.length
          })

          // Guard against concurrent processing races
          if (audio.length === 0 || isProcessingRef.current) {
            setVadState('speech-ended')
            recognizerRef.current?.abort()
            return
          }

          isProcessingRef.current = true
          setVadState('transcribing')

          const t_speechEnd = Date.now()

          try {
            // Step 1: Hybrid Speech-to-Text Transcription (Web Speech Recognition + Gemini STT Fallback)
            defaultLatencyTracker.recordEvent('STT_START')
            let recognizedText = ''
            let detectedLang: string | undefined = 'vi'
            let sttLatency = 0

            // Try WebSpeechRecognizer first (Fast, accurate native Vietnamese, zero quota)
            if (recognizerRef.current?.isAvailable()) {
              const webSpeechResult = await recognizerRef.current.stop()
              if (webSpeechResult && webSpeechResult.text) {
                recognizedText = webSpeechResult.text.trim()
                detectedLang = webSpeechResult.language || 'vi'
                console.log(`[Voice Pipeline] Web Speech Recognition result: "${recognizedText}"`)
              }
            }

            // If WebSpeechRecognizer is empty, fallback to Main process Gemini STT via IPC
            if (!recognizedText && window.api && window.api.transcribeAudio) {
              const wavBase64 = float32ToWavBase64(audio, 16000)
              const currentInteractionId = defaultLatencyTracker.getMetrics()?.interactionId
              const sttResult = await window.api.transcribeAudio({
                audioBase64: wavBase64,
                sampleRate: 16000,
                mimeType: 'audio/wav',
                durationMs,
                interactionId: currentInteractionId
              })

              recognizedText = sttResult.text ? sttResult.text.trim() : ''
              detectedLang = sttResult.language
              console.log(`[Voice Pipeline] Cloud/IPC STT result: "${recognizedText}"`)
            }

            const t_sttEnd = Date.now()
            sttLatency = t_sttEnd - t_speechEnd

            defaultLatencyTracker.recordEvent('STT_FIRST_RESULT', { text: recognizedText })
            defaultLatencyTracker.recordEvent('STT_COMPLETE', {
              text: recognizedText,
              language: detectedLang
            })

            setTranscription(recognizedText)
            setTranscriptionLatencyMs(sttLatency)
            setTranscriptionLanguage(detectedLang)

            // Step 2: Empty / Whitespace-only check (Section 8)
            if (!recognizedText || recognizedText.length === 0) {
              console.log(
                '[Voice Pipeline] Empty transcription received. Skipping Agent execution.'
              )
              defaultLatencyTracker.recordError('STT', 'Empty transcription received')
              setError('Không nhận diện được nội dung.')
              setVadState('listening')
              return
            }

            // Step 3: Send to Existing Agent Orchestrator (Milestone 2.4)
            if (onVoiceCommand) {
              setVadState('processing')
              const t_agentStart = Date.now()
              defaultLatencyTracker.recordEvent('AGENT_START', { command: recognizedText })

              try {
                const execResult = await onVoiceCommand(recognizedText)
                const t_agentEnd = Date.now()
                const agentLatency = t_agentEnd - t_agentStart
                const totalLatency = t_agentEnd - t_speechEnd

                defaultLatencyTracker.recordEvent('AGENT_COMPLETE', {
                  intent: execResult?.intent,
                  success: execResult?.success
                })

                console.log(
                  `[Voice Pipeline] STT: ${sttLatency}ms | Agent: ${agentLatency}ms | Total: ${totalLatency}ms`
                )

                if (execResult) {
                  setAgentResult(execResult)

                  defaultLatencyTracker.recordEvent('RESPONSE_FORMAT_START')
                  const formatted = formatAgentResponse(execResult.message)
                  defaultLatencyTracker.recordEvent('RESPONSE_FORMAT_COMPLETE')

                  // Milestone 4.2: Trigger Incremental Response + Sentence Streaming TTS
                  let ttsLatency = 0
                  if (execResult.message) {
                    setVadState('speaking-assistant')
                    const t_ttsStart = Date.now()
                    try {
                      const ttsText = formatted.ttsText || execResult.message
                      const stream = createMockResponseStream(ttsText, { chunkDelayMs: 30 })

                      await defaultTtsService.speakStream(stream, {
                        interactionId: defaultLatencyTracker.getMetrics()?.interactionId
                      })
                      ttsLatency = Date.now() - t_ttsStart
                      console.log(
                        `[Voice Pipeline] Incremental streaming TTS completed in ${ttsLatency}ms`
                      )
                    } catch (ttsErr) {
                      console.warn('[Voice Pipeline] Streaming TTS playback error:', ttsErr)
                    }
                  }

                  const metrics = defaultLatencyTracker.getMetrics()
                  setLatencyMetrics(metrics)

                  const totalWithTts = totalLatency + ttsLatency
                  setPipelineLatency({
                    sttMs: sttLatency,
                    agentMs: agentLatency,
                    ttsMs: ttsLatency,
                    totalMs: totalWithTts,
                    ttfaMs: metrics?.timeToFirstAudioMs,
                    ttfsMs: metrics?.timeToFirstSentenceMs,
                    interactionId: metrics?.interactionId
                  })

                  if (execResult.success) {
                    setVadState('success')
                  } else {
                    setVadState('error')
                    setError(execResult.error || execResult.message || 'Không thể xử lý yêu cầu.')
                  }
                } else {
                  setVadState('success')
                }
              } catch (agentErr) {
                const agentErrMsg =
                  (agentErr as Error)?.message || 'Lỗi xử lý yêu cầu qua Agent/Calendar.'
                console.error('[Voice Pipeline] Agent execution error:', agentErrMsg)
                defaultLatencyTracker.recordError('AGENT', agentErrMsg)
                setError(agentErrMsg)
                setVadState('error')
              }
            } else {
              // Standalone mode without agent callback
              setVadState('success')
            }
          } catch (sttErr: unknown) {
            const errMsg = (sttErr as Error)?.message || 'Không thể nhận diện giọng nói.'
            console.error('[Voice Pipeline] STT error:', errMsg)
            defaultLatencyTracker.recordError('STT', errMsg)
            setError(errMsg)
            setVadState('error')
          } finally {
            isProcessingRef.current = false
          }

          // Gracefully return to listening indicator after 3 seconds
          speechEndTimeoutRef.current = window.setTimeout(() => {
            setVadState((current) =>
              current === 'speech-ended' ||
              current === 'success' ||
              current === 'speaking-assistant' ||
              current === 'error'
                ? 'listening'
                : current
            )
            setError(null)
          }, 3000)
        },
        onVADMisfire: () => {
          console.log('[VAD] Speech misfire ignored (< minSpeechMs)')
          setIsSpeechDetected(false)
          setVadState('listening')
        }
      }

      // 3. Initialize Silero VAD with fallback for audio processor type
      let vadInstance: MicVAD
      try {
        vadInstance = await MicVAD.new({
          ...vadOptions,
          processorType: 'auto'
        })
      } catch (workletError) {
        console.warn(
          '[VAD] AudioWorklet init failed, falling back to ScriptProcessor:',
          workletError
        )
        vadInstance = await MicVAD.new({
          ...vadOptions,
          processorType: 'ScriptProcessor'
        })
      }

      vadRef.current = vadInstance
      setVadState('listening')
    } catch (err: unknown) {
      await destroyVad()
      mic.stop()
      setVadState('error')

      const rawMsg = (err as Error)?.message || 'Lỗi khởi tạo Voice Activity Detection (VAD).'
      const userMsg =
        rawMsg.includes('fetch') || rawMsg.includes('WASM') || rawMsg.includes('initWasm')
          ? 'Không thể nạp mô hình VAD WebAssembly. Vui lòng kiểm tra tài nguyên VAD cục bộ.'
          : rawMsg
      setError(userMsg)
      console.error('[VAD] Initialization error:', err)
    }
  }, [vadState, destroyVad, mic, onVoiceCommand])

  // Cleanup immediately on unmount
  useEffect(() => {
    return (): void => {
      void destroyVad()
    }
  }, [destroyVad])

  // Derived effective state avoiding cascading render effects
  const effectiveVadState = mic.error ? 'error' : vadState
  const effectiveError = mic.error || error

  return {
    vadState: effectiveVadState,
    isSpeechDetected,
    start,
    stop,
    audioLevel: mic.audioLevel,
    error: effectiveError,
    speechCount,
    lastSpeechInfo,
    transcription,
    transcriptionLatencyMs,
    transcriptionLanguage,
    agentResult,
    pipelineLatency,
    latencyMetrics,
    interactionId,
    clearTranscription,
    isAssistantSpeaking,
    ttsWarning,
    ttsProgress,
    stopSpeaking,
    speakResponse
  }
}
