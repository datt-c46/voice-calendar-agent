/**
 * Mock Streaming Provider (Milestone 4.2).
 *
 * NOTE: This is a DEVELOPMENT / TEST provider used strictly to validate:
 *   - Incremental response chunking
 *   - Sentence buffer segmentation across chunk boundaries
 *   - Immediate sentence-level TTS queueing
 *   - User cancellation during stream consumption
 *   - Telemetry event sequence (RESPONSE_STREAM_START, CHUNK, FIRST_SENTENCE, etc.)
 *
 * IMPORTANT (Section 4 & Section 21):
 * Do not fake performance measurements as real streaming performance.
 * The mock provider exists only to validate the architectural pipeline before
 * real LLM streaming tokens (or streaming STT/TTS in M4.3) are hooked in.
 */

import { SimpleResponseStream } from './responseStream'
import { IResponseStream, IStreamingAgent } from './types'

export interface MockStreamOptions {
  /** Delay between chunks in milliseconds (default: 40ms) */
  chunkDelayMs?: number
  /** Custom chunks to emit, or if omitted, will intelligently slice into phrases */
  chunks?: string[]
}

/**
 * Intelligently chunks a text into realistic natural-language fragments
 * (roughly 2-5 words or punctuation-bounded phrases) for streaming simulation.
 */
export function createNaturalChunks(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return []
  }

  // If already short, split into 2-3 fragments
  const words = text.split(/(\s+)/)
  const chunks: string[] = []
  let current = ''
  let wordCount = 0

  for (const part of words) {
    current += part
    if (/\S/.test(part)) {
      wordCount++
    }

    // Split roughly every 3-5 words or after sentence/phrase punctuation
    if ((wordCount >= 4 && /\s$/.test(current)) || /[.?!,:;…]\s*$/.test(current)) {
      chunks.push(current)
      current = ''
      wordCount = 0
    }
  }

  if (current.length > 0) {
    chunks.push(current)
  }

  return chunks
}

/**
 * Creates an IResponseStream that incrementally yields text chunks over time.
 * Supports cancellation at any point during emission.
 */
export function createMockResponseStream(
  text: string,
  options?: MockStreamOptions
): IResponseStream {
  const stream = new SimpleResponseStream()
  const delayMs = options?.chunkDelayMs ?? 30
  const chunks = options?.chunks ?? createNaturalChunks(text)

  if (chunks.length === 0) {
    // Empty stream case
    queueMicrotask(() => {
      stream.complete()
    })
    return stream
  }

  let index = 0
  let timerId: ReturnType<typeof setTimeout> | null = null

  const emitNext = (): void => {
    if (stream.isCancelled()) {
      if (timerId !== null) {
        clearTimeout(timerId)
        timerId = null
      }
      return
    }

    if (index < chunks.length) {
      const chunkText = chunks[index]
      const isFinal = index === chunks.length - 1
      index++

      stream.push(chunkText, isFinal)

      if (!isFinal && !stream.isCancelled()) {
        timerId = setTimeout(emitNext, delayMs)
      }
    }
  }

  // Schedule first chunk asynchronously
  timerId = setTimeout(emitNext, 5)

  // Ensure timer is cleaned up if stream is cancelled externally
  const originalCancel = stream.cancel.bind(stream)
  stream.cancel = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
    originalCancel()
  }

  return stream
}

/**
 * Mock implementation of IStreamingAgent for testing streaming pipelines.
 */
export class MockStreamingAgentProvider implements IStreamingAgent {
  private customDelayMs: number

  constructor(chunkDelayMs = 30) {
    this.customDelayMs = chunkDelayMs
  }

  public async processCommandStream(command: string): Promise<IResponseStream> {
    const mockResponse = `Đã ghi nhận yêu cầu: "${command}". Lịch trình của bạn đã được cập nhật thành công.`
    return createMockResponseStream(mockResponse, { chunkDelayMs: this.customDelayMs })
  }
}
