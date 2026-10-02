/**
 * Telemetry and Latency Types (Milestone 4.1 & 4.2).
 *
 * Defines stage events, structured metrics, and event models to measure
 * end-to-end latency throughout the voice interaction pipeline,
 * including streaming milestones (TTFS - Time To First Sentence, TTFA - Time To First Audio).
 */

export type TelemetryEventType =
  | 'SPEECH_START'
  | 'SPEECH_END'
  | 'STT_START'
  | 'STT_FIRST_RESULT'
  | 'STT_COMPLETE'
  | 'AGENT_START'
  | 'AGENT_COMPLETE'
  | 'RESPONSE_FORMAT_START'
  | 'RESPONSE_FORMAT_COMPLETE'
  | 'RESPONSE_STREAM_START'
  | 'RESPONSE_CHUNK_RECEIVED'
  | 'FIRST_SENTENCE_DETECTED'
  | 'SENTENCE_DETECTED'
  | 'SENTENCE_QUEUED'
  | 'RESPONSE_STREAM_COMPLETE'
  | 'TTS_QUEUE_START'
  | 'TTS_FIRST_START'
  | 'TTS_COMPLETE'
  | 'ERROR'
  | 'CANCELLED'

export interface TelemetryEvent {
  interactionId: string
  type: TelemetryEventType
  timestamp: number // Wall-clock epoch timestamp (ms)
  perfTime: number // High-resolution monotonic timestamp (ms)
  metadata?: Record<string, unknown>
}

export interface LatencyMetrics {
  interactionId: string

  // Individual stage latencies
  speechDurationMs: number
  sttLatencyMs: number
  agentLatencyMs: number
  responseFormatLatencyMs: number
  ttsQueueLatencyMs: number
  ttsStartupLatencyMs: number

  // Cross-stage transitional latencies
  speechEndToSttStartMs: number
  speechEndToTranscriptMs: number
  speechEndToAgentCompleteMs: number

  // Milestone 4.2 Streaming Metrics
  timeToFirstSentenceMs: number // TTFS: streamStart -> firstSentenceDetected
  speechEndToFirstSentenceMs: number // speechEnd -> firstSentenceDetected
  firstSentenceQueueLatencyMs: number // firstSentenceDetected -> firstSentenceQueued

  // Key M4 milestone metric: Time To First Audio (TTFA = speechEnd -> first tts start)
  timeToFirstAudioMs: number

  // Overall interaction durations
  totalFromSpeechEndMs: number
  totalDurationMs: number

  // High-resolution epoch record
  timestamps: {
    speechStart?: number
    speechEnd?: number
    sttStart?: number
    sttFirstResult?: number
    sttComplete?: number
    agentStart?: number
    agentComplete?: number
    responseFormatStart?: number
    responseFormatComplete?: number
    streamStart?: number
    firstSentenceDetected?: number
    firstSentenceQueued?: number
    streamComplete?: number
    ttsQueueStart?: number
    ttsFirstStart?: number
    ttsComplete?: number
  }
}

export interface PerformanceSnapshot {
  interactionId: string
  speechDurationSec: string
  sttLatencySec: string
  agentLatencySec: string
  ttfsSec: string
  ttsStartupSec: string
  ttfaSec: string
  totalSec: string
  formattedText: string
}
