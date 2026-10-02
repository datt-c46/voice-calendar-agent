/**
 * Telemetry and Latency Types for Main Process (Milestone 4.1 & 4.2).
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
  timestamp: number
  perfTime: number
  metadata?: Record<string, unknown>
}

export interface LatencyMetrics {
  interactionId: string
  speechDurationMs: number
  sttLatencyMs: number
  agentLatencyMs: number
  responseFormatLatencyMs: number
  ttsQueueLatencyMs: number
  ttsStartupLatencyMs: number
  speechEndToSttStartMs: number
  speechEndToTranscriptMs: number
  speechEndToAgentCompleteMs: number
  timeToFirstSentenceMs: number
  speechEndToFirstSentenceMs: number
  firstSentenceQueueLatencyMs: number
  timeToFirstAudioMs: number
  totalFromSpeechEndMs: number
  totalDurationMs: number
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
