import {
  ChunkListener,
  CompletionListener,
  ErrorListener,
  IResponseStream,
  ResponseChunk
} from './types'

/**
 * Standard implementation of IResponseStream for partial chunk emission and async iteration.
 */
export class SimpleResponseStream implements IResponseStream {
  private chunkListeners: Set<ChunkListener> = new Set()
  private completionListeners: Set<CompletionListener> = new Set()
  private errorListeners: Set<ErrorListener> = new Set()

  private chunks: ResponseChunk[] = []
  private chunkIndex = 0
  private completed = false
  private cancelled = false
  private errorState: Error | null = null

  // Queue of waiting async iterator consumers
  private waiters: Array<{
    resolve: (val: IteratorResult<string>) => void
    reject: (err: Error) => void
  }> = []

  public onChunk(callback: ChunkListener): () => void {
    this.chunkListeners.add(callback)
    return () => {
      this.chunkListeners.delete(callback)
    }
  }

  public onComplete(callback: CompletionListener): () => void {
    this.completionListeners.add(callback)
    if (this.completed) {
      callback()
    }
    return () => {
      this.completionListeners.delete(callback)
    }
  }

  public onError(callback: ErrorListener): () => void {
    this.errorListeners.add(callback)
    if (this.errorState) {
      callback(this.errorState)
    }
    return () => {
      this.errorListeners.delete(callback)
    }
  }

  public cancel(): void {
    if (this.completed || this.cancelled) {
      return
    }
    this.cancelled = true

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter?.resolve({ value: undefined, done: true })
    }
  }

  public isCancelled(): boolean {
    return this.cancelled
  }

  public isComplete(): boolean {
    return this.completed
  }

  /**
   * Pushes a new text chunk to the stream.
   */
  public push(text: string, isFinal = false): void {
    if (this.completed || this.cancelled) {
      return
    }

    const chunk: ResponseChunk = {
      text,
      isFinal,
      chunkIndex: this.chunkIndex++,
      timestamp: Date.now()
    }

    this.chunks.push(chunk)

    for (const listener of this.chunkListeners) {
      try {
        listener(chunk)
      } catch (err) {
        console.warn('[ResponseStream] Error in chunk listener:', err)
      }
    }

    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter?.resolve({ value: text, done: false })
    }

    if (isFinal) {
      this.complete()
    }
  }

  /**
   * Signals that no more chunks will be emitted.
   */
  public complete(): void {
    if (this.completed || this.cancelled) {
      return
    }
    this.completed = true

    for (const listener of this.completionListeners) {
      try {
        listener()
      } catch (err) {
        console.warn('[ResponseStream] Error in complete listener:', err)
      }
    }

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter?.resolve({ value: undefined, done: true })
    }
  }

  /**
   * Signals an error on the stream.
   */
  public error(err: Error): void {
    if (this.completed || this.cancelled) {
      return
    }
    this.errorState = err
    this.completed = true

    for (const listener of this.errorListeners) {
      try {
        listener(err)
      } catch (listenerErr) {
        console.warn('[ResponseStream] Error in error listener:', listenerErr)
      }
    }

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter?.reject(err)
    }
  }

  /**
   * Standard AsyncIterable implementation.
   */
  public [Symbol.asyncIterator](): AsyncIterator<string> {
    let readIndex = 0

    return {
      next: (): Promise<IteratorResult<string>> => {
        if (this.cancelled) {
          return Promise.resolve({ value: undefined, done: true })
        }

        if (readIndex < this.chunks.length) {
          const val = this.chunks[readIndex++].text
          return Promise.resolve({ value: val, done: false })
        }

        if (this.completed) {
          if (this.errorState) {
            return Promise.reject(this.errorState)
          }
          return Promise.resolve({ value: undefined, done: true })
        }

        return new Promise<IteratorResult<string>>((resolve, reject) => {
          this.waiters.push({
            resolve: (res) => {
              if (!res.done && res.value !== undefined) {
                readIndex++
              }
              resolve(res)
            },
            reject
          })
        })
      }
    }
  }

  /**
   * Helper to create a stream from a full static response (convenience adapter).
   */
  public static fromString(text: string): SimpleResponseStream {
    const stream = new SimpleResponseStream()
    queueMicrotask(() => {
      stream.push(text, true)
    })
    return stream
  }
}
