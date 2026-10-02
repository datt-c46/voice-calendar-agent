/**
 * Streaming Architecture Interfaces & Types (Milestone 4.1 Preparation).
 *
 * Defines contracts for incremental response chunking, asynchronous generators,
 * streaming agent responses, and sentence-level buffering ahead of M4.2.
 */

export interface ResponseChunk {
  text: string
  isFinal: boolean
  chunkIndex: number
  timestamp: number
}

export type ChunkListener = (chunk: ResponseChunk) => void
export type CompletionListener = () => void
export type ErrorListener = (error: Error) => void

/**
 * Interface representing a stream of text chunks (e.g. from an LLM or streaming Agent).
 * Supports both event-listener subscriptions and standard AsyncIterable consumption.
 */
export interface IResponseStream {
  onChunk(callback: ChunkListener): () => void
  onComplete(callback: CompletionListener): () => void
  onError(callback: ErrorListener): () => void
  cancel(): void
  isCancelled(): boolean
  isComplete(): boolean
  [Symbol.asyncIterator](): AsyncIterator<string>
}

/**
 * Interface contract for future streaming-capable Agent implementations.
 */
export interface IStreamingAgent {
  processCommandStream(command: string): Promise<IResponseStream>
}

/**
 * Configuration for backpressure management in streaming queues.
 */
export interface BackpressureConfig {
  /** Maximum number of sentences allowed in the queue before applying backpressure. Default: 50 */
  maxQueueSize: number
  /** Threshold at which warning/slowdown signals are emitted. Default: 30 */
  highWaterMark: number
}
