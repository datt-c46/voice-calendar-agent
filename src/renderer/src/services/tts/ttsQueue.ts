import { ITextToSpeechProvider } from './ITextToSpeechProvider'
import { splitIntoSentences } from './sentenceSplitter'
import {
  SpeakOptions,
  SpeakStreamOptions,
  TTSQueueMetrics,
  TTSQueueProgress,
  TTSState
} from './types'
import { defaultLatencyTracker } from '../telemetry'
import { IResponseStream } from '../streaming/types'
import { SentenceBuffer } from '../streaming/sentenceBuffer'

export interface TTSQueueStatus {
  state: TTSState
  isSpeaking: boolean
  progress: TTSQueueProgress
  metrics: TTSQueueMetrics
  error: string | null
  isOverloaded?: boolean
}

export type TTSQueueListener = (status: TTSQueueStatus) => void

/**
 * Sequential Text-To-Speech Queue (Milestone 3.2 & 4.2).
 *
 * Enqueues sentences and vocalizes them sequentially through the ITextToSpeechProvider.
 * Implements generation-token cancellation guards to guarantee that stopping or starting
 * a new request immediately aborts previous sentences and prevents orphaned callbacks.
 * Supports incremental sentence streaming (M4.2) via speakStream().
 */
export class TTSQueue {
  private provider: ITextToSpeechProvider
  private items: string[] = []
  private currentIndex = 0
  private state: TTSState = 'idle'
  private error: string | null = null
  private currentGeneration = 0
  private isProcessing = false
  private listeners: Set<TTSQueueListener> = new Set()
  private activeOptions?: SpeakOptions
  private activeResolve: (() => void) | null = null
  private activeReject: ((err: Error) => void) | null = null
  private activeStream: IResponseStream | null = null
  private isStreamActive = false

  private maxQueueSize = 50
  private highWaterMark = 30

  private metrics: TTSQueueMetrics = {
    queueCreatedAt: null,
    firstSentenceStartedAt: null,
    lastSentenceCompletedAt: null,
    totalDurationMs: null
  }

  constructor(
    provider: ITextToSpeechProvider,
    options?: { maxQueueSize?: number; highWaterMark?: number }
  ) {
    this.provider = provider
    if (options?.maxQueueSize !== undefined) {
      this.maxQueueSize = options.maxQueueSize
    }
    if (options?.highWaterMark !== undefined) {
      this.highWaterMark = options.highWaterMark
    }
  }

  public setProvider(provider: ITextToSpeechProvider): void {
    this.stop()
    this.provider = provider
  }

  public getQueueLength(): number {
    return Math.max(0, this.items.length - this.currentIndex)
  }

  public isOverloaded(): boolean {
    return this.getQueueLength() >= this.maxQueueSize
  }

  /**
   * Enqueue one or more sentences to the current queue.
   */
  public enqueue(sentences: string | string[], options?: SpeakOptions): void {
    const list = Array.isArray(sentences) ? sentences : [sentences]
    const valid = list.map((s) => s.trim()).filter((s) => s.length > 0)

    if (valid.length === 0) {
      return
    }

    if (this.isOverloaded()) {
      console.warn(
        `[TTS Queue] Backpressure: Queue is full (${this.getQueueLength()}/${this.maxQueueSize}). Dropping or delaying enqueue.`
      )
      return
    }

    if (options) {
      this.activeOptions = options
    }

    this.items.push(...valid)
    const currentQueueLen = this.getQueueLength()

    if (currentQueueLen >= this.highWaterMark) {
      console.warn(
        `[TTS Queue] Backpressure Warning: Queue length (${currentQueueLen}) reached high-water mark (${this.highWaterMark})`
      )
    }

    console.log(
      `[TTS Queue] Enqueued ${valid.length} sentence(s). Total in queue: ${this.items.length}`
    )

    if (!this.isProcessing) {
      this.state = 'queued'
      this.metrics.queueCreatedAt = Date.now()
      this.notifyListeners()
      void this.processQueue(this.currentGeneration)
    } else {
      this.notifyListeners()
    }
  }

  /**
   * High-level entry point: Segments text into sentences and speaks them sequentially.
   * Cancels any previously active speech or queued sentences.
   */
  public async speak(text: string, options?: SpeakOptions): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }

    // 1. Cancel any active speech or prior queue (Section 9)
    this.stop()

    // 2. Increment generation token to ensure isolation
    this.currentGeneration++
    const generation = this.currentGeneration

    // 3. Segment text into discrete sentences
    const sentences = splitIntoSentences(trimmed)
    if (sentences.length === 0) {
      return
    }

    this.items = [...sentences]
    this.currentIndex = 0
    this.activeOptions = options
    this.state = 'queued'
    this.error = null
    this.metrics = {
      queueCreatedAt: Date.now(),
      firstSentenceStartedAt: null,
      lastSentenceCompletedAt: null,
      totalDurationMs: null
    }

    defaultLatencyTracker.recordEvent('TTS_QUEUE_START', {
      sentencesCount: sentences.length,
      generation
    })

    console.log(`[TTS Queue] New request (gen ${generation}): ${sentences.length} sentences queued`)
    this.notifyListeners()

    // 4. Return promise that completes when all sentences in this generation finish
    return new Promise<void>((resolve, reject) => {
      this.activeResolve = resolve
      this.activeReject = reject
      this.processQueue(generation)
        .then(() => {
          if (this.activeResolve === resolve) {
            this.activeResolve = null
            this.activeReject = null
          }
          resolve()
        })
        .catch((err) => {
          if (this.activeResolve === resolve) {
            this.activeResolve = null
            this.activeReject = null
          }
          if (generation === this.currentGeneration) {
            reject(err)
          } else {
            resolve()
          }
        })
    })
  }

  /**
   * Milestone 4.2 Streaming entry point:
   * Consumes an incremental response stream chunk-by-chunk, segments text into complete sentences
   * via SentenceBuffer, and enqueues completed sentences into the playback queue IMMEDIATELY
   * without waiting for the full response to finish generating.
   */
  public async speakStream(stream: IResponseStream, options?: SpeakStreamOptions): Promise<void> {
    // 1. Cancel any active speech or prior queue
    this.stop()

    // 2. Increment generation token to ensure isolation
    this.currentGeneration++
    const generation = this.currentGeneration
    this.activeStream = stream
    this.isStreamActive = true

    this.items = []
    this.currentIndex = 0
    this.activeOptions = options
    this.state = 'queued'
    this.error = null
    this.metrics = {
      queueCreatedAt: Date.now(),
      firstSentenceStartedAt: null,
      lastSentenceCompletedAt: null,
      totalDurationMs: null
    }

    defaultLatencyTracker.recordEvent('RESPONSE_STREAM_START', {
      generation,
      interactionId: options?.interactionId
    })

    console.log(`[TTS Queue] Starting streaming response (gen ${generation})`)
    this.notifyListeners()

    const sentenceBuffer = new SentenceBuffer()
    let firstSentenceDetected = false
    let cumulativeText = ''

    // 3. Hook stream chunk listener
    stream.onChunk((chunk) => {
      if (generation !== this.currentGeneration || stream.isCancelled()) {
        return
      }

      defaultLatencyTracker.recordEvent('RESPONSE_CHUNK_RECEIVED', {
        chunkIndex: chunk.chunkIndex,
        chunkLength: chunk.text.length,
        timestamp: chunk.timestamp
      })

      cumulativeText += chunk.text
      if (options?.onTextProgress) {
        try {
          options.onTextProgress(cumulativeText, chunk.text)
        } catch (e) {
          console.warn('[TTS Queue] onTextProgress error:', e)
        }
      }

      const newlyCompleted = sentenceBuffer.append(chunk.text)
      for (const sentence of newlyCompleted) {
        if (!firstSentenceDetected) {
          firstSentenceDetected = true
          defaultLatencyTracker.recordEvent('FIRST_SENTENCE_DETECTED', {
            sentenceLength: sentence.length
          })
        }

        defaultLatencyTracker.recordEvent('SENTENCE_DETECTED', {
          sentenceLength: sentence.length
        })

        this.items.push(sentence)
        defaultLatencyTracker.recordEvent('SENTENCE_QUEUED', {
          queueLength: this.getQueueLength()
        })

        console.log(`[TTS Queue] Incremental sentence queued (${this.items.length}): "${sentence}"`)
        this.notifyListeners()

        if (!this.isProcessing) {
          void this.processQueue(generation)
        }
      }
    })

    // 4. Hook stream completion listener
    stream.onComplete(() => {
      if (generation !== this.currentGeneration || stream.isCancelled()) {
        return
      }

      defaultLatencyTracker.recordEvent('RESPONSE_STREAM_COMPLETE', {
        totalLength: cumulativeText.length
      })

      const remaining = sentenceBuffer.flush()
      for (const sentence of remaining) {
        if (!firstSentenceDetected) {
          firstSentenceDetected = true
          defaultLatencyTracker.recordEvent('FIRST_SENTENCE_DETECTED', {
            sentenceLength: sentence.length
          })
        }

        defaultLatencyTracker.recordEvent('SENTENCE_DETECTED', {
          sentenceLength: sentence.length
        })

        this.items.push(sentence)
        defaultLatencyTracker.recordEvent('SENTENCE_QUEUED', {
          queueLength: this.getQueueLength()
        })

        console.log(`[TTS Queue] Flushed final sentence (${this.items.length}): "${sentence}"`)
      }

      this.isStreamActive = false
      this.notifyListeners()

      // Empty stream handling (Section 18)
      if (this.items.length === 0) {
        console.log('[TTS Queue] Empty stream: no sentences emitted.')
        this.state = 'idle'
        this.notifyListeners()
        if (this.activeResolve) {
          const res = this.activeResolve
          this.activeResolve = null
          this.activeReject = null
          res()
        }
        return
      }

      if (!this.isProcessing && this.currentIndex < this.items.length) {
        void this.processQueue(generation)
      } else if (!this.isProcessing && this.currentIndex >= this.items.length) {
        this.finishGeneration(generation)
      }
    })

    // 5. Hook stream error listener (Section 17)
    stream.onError((err) => {
      if (generation !== this.currentGeneration) {
        return
      }

      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('[TTS Queue] Response stream error:', errMsg)
      defaultLatencyTracker.recordError('RESPONSE_STREAM', errMsg)
      this.error = errMsg
      this.isStreamActive = false
      this.state = 'error'
      this.notifyListeners()

      if (this.activeReject) {
        const rej = this.activeReject
        this.activeResolve = null
        this.activeReject = null
        rej(err)
      }
    })

    return new Promise<void>((resolve, reject) => {
      this.activeResolve = resolve
      this.activeReject = reject
    })
  }

  /**
   * Immediately stops any playing utterance, flushes remaining queue,
   * cancels any active stream, and increments generation counter to block any stale callbacks.
   */
  public stop(): void {
    this.currentGeneration++

    if (this.activeStream && !this.activeStream.isCancelled()) {
      try {
        this.activeStream.cancel()
      } catch (err) {
        console.warn('[TTS Queue] Error cancelling active stream:', err)
      }
    }
    this.activeStream = null
    this.isStreamActive = false

    this.items = []
    this.currentIndex = 0
    this.isProcessing = false

    try {
      this.provider.stop()
    } catch (err) {
      console.warn('[TTS Queue] Error stopping provider:', err)
    }

    if (this.activeResolve) {
      const resolveFn = this.activeResolve
      this.activeResolve = null
      this.activeReject = null
      resolveFn()
    }

    this.state = 'cancelled'
    this.notifyListeners()

    this.state = 'idle'
    this.notifyListeners()
    console.log('[TTS Queue] Stopped and flushed.')
  }

  /**
   * Clear pending queued sentences without interrupting the currently playing sentence.
   */
  public clear(): void {
    if (this.items.length > this.currentIndex + 1) {
      this.items = this.items.slice(0, this.currentIndex + 1)
      this.notifyListeners()
      console.log('[TTS Queue] Cleared pending queue.')
    }
  }

  public isSpeaking(): boolean {
    return this.state === 'speaking' || this.provider.isSpeaking()
  }

  public getStatus(): TTSQueueStatus {
    const currentSentence =
      this.currentIndex < this.items.length ? this.items[this.currentIndex] : null

    return {
      state: this.state,
      isSpeaking: this.isSpeaking(),
      progress: {
        currentSentence,
        currentIndex: this.currentIndex,
        totalSentences: this.items.length,
        queueLength: Math.max(0, this.items.length - this.currentIndex)
      },
      metrics: { ...this.metrics },
      error: this.error,
      isOverloaded: this.isOverloaded()
    }
  }

  public subscribe(listener: TTSQueueListener): () => void {
    this.listeners.add(listener)
    listener(this.getStatus())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private finishGeneration(gen: number): void {
    if (gen !== this.currentGeneration) {
      return
    }

    this.state = 'completed'
    this.metrics.lastSentenceCompletedAt = Date.now()
    if (this.metrics.queueCreatedAt) {
      this.metrics.totalDurationMs = Date.now() - this.metrics.queueCreatedAt
    }
    this.isProcessing = false

    defaultLatencyTracker.recordEvent('TTS_COMPLETE', {
      totalSentences: this.items.length,
      durationMs: this.metrics.totalDurationMs,
      generation: gen
    })

    this.notifyListeners()
    console.log(
      `[TTS Queue] Completed all ${this.items.length} sentence(s) in ${this.metrics.totalDurationMs}ms`
    )

    if (this.activeResolve) {
      const resolveFn = this.activeResolve
      this.activeResolve = null
      this.activeReject = null
      resolveFn()
    }
  }

  private async processQueue(gen: number): Promise<void> {
    if (this.isProcessing) {
      return
    }

    this.isProcessing = true

    while (this.currentIndex < this.items.length) {
      // Generation Guard: If generation changed (stop() or new request), abort immediately!
      if (gen !== this.currentGeneration) {
        this.isProcessing = false
        return
      }

      const sentence = this.items[this.currentIndex]
      this.state = 'speaking'

      if (this.currentIndex === 0 && !this.metrics.firstSentenceStartedAt) {
        this.metrics.firstSentenceStartedAt = Date.now()
        defaultLatencyTracker.recordEvent('TTS_FIRST_START', {
          sentence,
          generation: gen
        })
      }

      this.notifyListeners()
      console.log(
        `[TTS Queue] Speaking sentence ${this.currentIndex + 1}/${this.items.length}: "${sentence}"`
      )

      try {
        await this.provider.speak(sentence, this.activeOptions)

        // Check generation again after await
        if (gen !== this.currentGeneration) {
          this.isProcessing = false
          return
        }

        console.log(`[TTS Queue] Completed sentence ${this.currentIndex + 1}/${this.items.length}`)
        this.currentIndex++
        this.notifyListeners()
      } catch (err: unknown) {
        if (gen !== this.currentGeneration) {
          this.isProcessing = false
          return
        }

        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[TTS Queue] Error on sentence ${this.currentIndex + 1}:`, errMsg)
        defaultLatencyTracker.recordError('TTS_PLAYBACK', errMsg)
        this.error = errMsg
        this.state = 'error'
        this.isProcessing = false
        this.notifyListeners()

        if (this.activeReject) {
          const rej = this.activeReject
          this.activeResolve = null
          this.activeReject = null
          rej(err instanceof Error ? err : new Error(errMsg))
        }
        return
      }
    }

    this.isProcessing = false

    // If stream has ended and we reached the end of items, finalize this generation
    if (!this.isStreamActive && this.currentIndex >= this.items.length) {
      this.finishGeneration(gen)
    }
  }

  private notifyListeners(): void {
    const status = this.getStatus()
    this.listeners.forEach((listener) => {
      try {
        listener(status)
      } catch (err) {
        console.error('[TTS Queue] Listener notification error:', err)
      }
    })
  }
}
