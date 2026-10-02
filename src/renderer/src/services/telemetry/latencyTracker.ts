import { LatencyMetrics, PerformanceSnapshot, TelemetryEvent, TelemetryEventType } from './types'

/**
 * Generates a clean random UUID v4 string for tracking interaction sessions.
 */
export function generateInteractionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Gets high-resolution monotonic time (ms).
 */
function getMonotonicTime(): number {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now()
  }
  return Date.now()
}

export type TelemetryListener = (event: TelemetryEvent, metrics: LatencyMetrics | null) => void

/**
 * Latency & Telemetry Tracker (Milestone 4.1 & 4.2).
 *
 * Captures fine-grained timestamps across all stages of a voice command:
 * Speech Detection -> STT -> Agent -> Stream/Formatting -> Sentence Detection -> TTS Queuing -> Audio Playback.
 * Calculates transitional latencies, including Time To First Sentence (TTFS) and Time To First Audio (TTFA).
 */
export class LatencyTracker {
  private activeInteractionId: string | null = null
  private events: Map<string, TelemetryEvent[]> = new Map()
  private maxHistorySize = 50
  private listeners: Set<TelemetryListener> = new Set()
  private isDevMode = true

  constructor(options?: { isDevMode?: boolean; maxHistorySize?: number }) {
    if (options?.isDevMode !== undefined) {
      this.isDevMode = options.isDevMode
    }
    if (options?.maxHistorySize !== undefined) {
      this.maxHistorySize = options.maxHistorySize
    }
  }

  public getActiveInteractionId(): string | null {
    return this.activeInteractionId
  }

  /**
   * Starts a new interaction session with an optional custom ID.
   */
  public startInteraction(customId?: string): string {
    const interactionId = customId || generateInteractionId()
    this.activeInteractionId = interactionId
    this.events.set(interactionId, [])

    // Bound historical entries to prevent memory growth
    if (this.events.size > this.maxHistorySize) {
      const oldestKey = this.events.keys().next().value
      if (oldestKey) {
        this.events.delete(oldestKey)
      }
    }

    return interactionId
  }

  /**
   * Records a pipeline event for the current interaction (or specified interaction).
   */
  public recordEvent(
    type: TelemetryEventType,
    metadata?: Record<string, unknown>,
    interactionId?: string
  ): TelemetryEvent {
    const targetId = interactionId || this.activeInteractionId || this.startInteraction()
    const timestamp = Date.now()
    const perfTime = getMonotonicTime()

    const event: TelemetryEvent = {
      interactionId: targetId,
      type,
      timestamp,
      perfTime,
      metadata
    }

    let eventList = this.events.get(targetId)
    if (!eventList) {
      eventList = []
      this.events.set(targetId, eventList)
    }
    eventList.push(event)

    if (this.isDevMode) {
      this.logDevelopmentTrace(event)
    }

    const metrics = this.getMetrics(targetId)
    this.notifyListeners(event, metrics)

    return event
  }

  /**
   * Records an error event at a specific stage.
   */
  public recordError(stage: string, error: unknown, interactionId?: string): TelemetryEvent {
    const errMessage = error instanceof Error ? error.message : String(error)
    return this.recordEvent(
      'ERROR',
      {
        stage,
        error: errMessage
      },
      interactionId
    )
  }

  /**
   * Records a cancellation event.
   */
  public recordCancel(reason?: string, interactionId?: string): TelemetryEvent {
    return this.recordEvent(
      'CANCELLED',
      {
        reason: reason || 'User cancelled'
      },
      interactionId
    )
  }

  /**
   * Returns all recorded telemetry events for an interaction.
   */
  public getEvents(interactionId?: string): TelemetryEvent[] {
    const targetId = interactionId || this.activeInteractionId
    if (!targetId) {
      return []
    }
    return [...(this.events.get(targetId) || [])]
  }

  /**
   * Calculates structured latency metrics for the interaction.
   */
  public getMetrics(interactionId?: string): LatencyMetrics | null {
    const targetId = interactionId || this.activeInteractionId
    if (!targetId) {
      return null
    }

    const eventList = this.events.get(targetId)
    if (!eventList || eventList.length === 0) {
      return null
    }

    // Map each event type to its high-res perfTime and epoch timestamp
    const perfMap = new Map<TelemetryEventType, number>()
    const epochMap: Record<string, number> = {}

    for (const ev of eventList) {
      // Use the earliest recorded instance of the event if multiple exist
      if (!perfMap.has(ev.type)) {
        perfMap.set(ev.type, ev.perfTime)
        epochMap[ev.type] = ev.timestamp
      }
    }

    const getDelta = (startType: TelemetryEventType, endType: TelemetryEventType): number => {
      const s = perfMap.get(startType)
      const e = perfMap.get(endType)
      if (s !== undefined && e !== undefined && e >= s) {
        return Math.round((e - s) * 10) / 10
      }
      return 0
    }

    const speechDurationMs = getDelta('SPEECH_START', 'SPEECH_END')
    const sttLatencyMs = getDelta('STT_START', 'STT_COMPLETE')
    const agentLatencyMs = getDelta('AGENT_START', 'AGENT_COMPLETE')
    const responseFormatLatencyMs = getDelta('RESPONSE_FORMAT_START', 'RESPONSE_FORMAT_COMPLETE')
    const ttsQueueLatencyMs = getDelta('TTS_QUEUE_START', 'TTS_COMPLETE')
    const ttsStartupLatencyMs = getDelta('TTS_QUEUE_START', 'TTS_FIRST_START')

    // Cross-stage intervals from SPEECH_END
    const speechEndToSttStartMs = getDelta('SPEECH_END', 'STT_START')
    const speechEndToTranscriptMs = getDelta('SPEECH_END', 'STT_COMPLETE')
    const speechEndToAgentCompleteMs = getDelta('SPEECH_END', 'AGENT_COMPLETE')

    // Milestone 4.2 Streaming Metrics: TTFS (Time To First Sentence)
    let timeToFirstSentenceMs = getDelta('RESPONSE_STREAM_START', 'FIRST_SENTENCE_DETECTED')
    if (timeToFirstSentenceMs === 0 && perfMap.has('FIRST_SENTENCE_DETECTED')) {
      // Fallback: measured from AGENT_COMPLETE if stream start not logged
      timeToFirstSentenceMs = getDelta('AGENT_COMPLETE', 'FIRST_SENTENCE_DETECTED')
    }

    const speechEndToFirstSentenceMs = getDelta('SPEECH_END', 'FIRST_SENTENCE_DETECTED')
    const firstSentenceQueueLatencyMs = getDelta('FIRST_SENTENCE_DETECTED', 'SENTENCE_QUEUED')

    // Primary Metric: Time To First Audio (TTFA = speechEnd -> first tts start)
    const timeToFirstAudioMs = getDelta('SPEECH_END', 'TTS_FIRST_START')

    // Totals
    const totalFromSpeechEndMs = getDelta('SPEECH_END', 'TTS_COMPLETE')
    const totalDurationMs = getDelta('SPEECH_START', 'TTS_COMPLETE')

    return {
      interactionId: targetId,
      speechDurationMs,
      sttLatencyMs,
      agentLatencyMs,
      responseFormatLatencyMs,
      ttsQueueLatencyMs,
      ttsStartupLatencyMs,
      speechEndToSttStartMs,
      speechEndToTranscriptMs,
      speechEndToAgentCompleteMs,
      timeToFirstSentenceMs,
      speechEndToFirstSentenceMs,
      firstSentenceQueueLatencyMs,
      timeToFirstAudioMs,
      totalFromSpeechEndMs,
      totalDurationMs,
      timestamps: {
        speechStart: epochMap['SPEECH_START'],
        speechEnd: epochMap['SPEECH_END'],
        sttStart: epochMap['STT_START'],
        sttFirstResult: epochMap['STT_FIRST_RESULT'],
        sttComplete: epochMap['STT_COMPLETE'],
        agentStart: epochMap['AGENT_START'],
        agentComplete: epochMap['AGENT_COMPLETE'],
        responseFormatStart: epochMap['RESPONSE_FORMAT_START'],
        responseFormatComplete: epochMap['RESPONSE_FORMAT_COMPLETE'],
        streamStart: epochMap['RESPONSE_STREAM_START'],
        firstSentenceDetected: epochMap['FIRST_SENTENCE_DETECTED'],
        firstSentenceQueued: epochMap['SENTENCE_QUEUED'],
        streamComplete: epochMap['RESPONSE_STREAM_COMPLETE'],
        ttsQueueStart: epochMap['TTS_QUEUE_START'],
        ttsFirstStart: epochMap['TTS_FIRST_START'],
        ttsComplete: epochMap['TTS_COMPLETE']
      }
    }
  }

  /**
   * Generates a formatted multi-line performance snapshot.
   */
  public getPerformanceSnapshot(interactionId?: string): PerformanceSnapshot | null {
    const metrics = this.getMetrics(interactionId)
    if (!metrics) {
      return null
    }

    const toSec = (ms: number): string => `${(ms / 1000).toFixed(2)} s`

    const speechSec = toSec(metrics.speechDurationMs)
    const sttSec = toSec(metrics.sttLatencyMs)
    const agentSec = toSec(metrics.agentLatencyMs)
    const ttfsSec = toSec(metrics.timeToFirstSentenceMs)
    const ttsStartSec = toSec(metrics.ttsStartupLatencyMs)
    const ttfaSec = toSec(metrics.timeToFirstAudioMs)
    const totalSec = toSec(metrics.totalDurationMs)

    const shortId = metrics.interactionId.slice(0, 8)
    const formattedText = [
      `Voice Performance [${shortId}]`,
      '-------------------------',
      `Speech:        ${speechSec.padEnd(8)}`,
      `STT:           ${sttSec.padEnd(8)}`,
      `Agent:         ${agentSec.padEnd(8)}`,
      `TTFS:          ${ttfsSec.padEnd(8)}`,
      `TTS startup:   ${ttsStartSec.padEnd(8)}`,
      `TTFA:          ${ttfaSec.padEnd(8)}`,
      `Total:         ${totalSec.padEnd(8)}`
    ].join('\n')

    return {
      interactionId: metrics.interactionId,
      speechDurationSec: speechSec,
      sttLatencySec: sttSec,
      agentLatencySec: agentSec,
      ttfsSec,
      ttsStartupSec: ttsStartSec,
      ttfaSec,
      totalSec,
      formattedText
    }
  }

  public subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners(event: TelemetryEvent, metrics: LatencyMetrics | null): void {
    for (const listener of this.listeners) {
      try {
        listener(event, metrics)
      } catch (err) {
        console.warn('[Telemetry] Error in listener callback:', err)
      }
    }
  }

  private logDevelopmentTrace(event: TelemetryEvent): void {
    const shortId = event.interactionId.slice(0, 8)
    const prefix = `[VOICE ${shortId}]`

    switch (event.type) {
      case 'SPEECH_START':
        console.log(`${prefix} Speech start`)
        break
      case 'SPEECH_END': {
        const metrics = this.getMetrics(event.interactionId)
        console.log(`${prefix} Speech end: ${metrics?.speechDurationMs || 0} ms`)
        break
      }
      case 'STT_COMPLETE': {
        const metrics = this.getMetrics(event.interactionId)
        console.log(`${prefix} STT: ${metrics?.sttLatencyMs || 0} ms`)
        break
      }
      case 'AGENT_COMPLETE': {
        const metrics = this.getMetrics(event.interactionId)
        console.log(`${prefix} Agent: ${metrics?.agentLatencyMs || 0} ms`)
        break
      }
      case 'RESPONSE_STREAM_START':
        console.log(`${prefix} Stream start`)
        break
      case 'FIRST_SENTENCE_DETECTED': {
        const metrics = this.getMetrics(event.interactionId)
        console.log(`${prefix} TTFS: ${metrics?.timeToFirstSentenceMs || 0} ms`)
        break
      }
      case 'TTS_FIRST_START': {
        const metrics = this.getMetrics(event.interactionId)
        console.log(`${prefix} TTFA: ${metrics?.timeToFirstAudioMs || 0} ms`)
        break
      }
      case 'TTS_COMPLETE': {
        const metrics = this.getMetrics(event.interactionId)
        console.log(`${prefix} Total: ${metrics?.totalDurationMs || 0} ms`)
        const snapshot = this.getPerformanceSnapshot(event.interactionId)
        if (snapshot) {
          console.log(`\n${snapshot.formattedText}\n`)
        }
        break
      }
      case 'ERROR':
        console.warn(`${prefix} ERROR stage=${event.metadata?.stage}:`, event.metadata?.error)
        break
      case 'CANCELLED':
        console.log(`${prefix} CANCELLED reason=${event.metadata?.reason || 'unspecified'}`)
        break
      default:
        break
    }
  }
}

/**
 * Default global LatencyTracker instance for renderer.
 */
export const defaultLatencyTracker = new LatencyTracker()
