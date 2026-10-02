import { splitIntoSentences } from '../tts/sentenceSplitter'

/**
 * SentenceBuffer (Milestone 4.1 Preparation for M4.2 Streaming).
 *
 * Incrementally accumulates partial text chunks (e.g. from token streaming or partial LLM responses),
 * identifies completed sentence boundaries, emits completed sentences, and retains the incomplete
 * tail in the buffer until further chunks or flush() arrive.
 */
export class SentenceBuffer {
  private buffer = ''

  /**
   * Append a new chunk of text to the buffer.
   * If one or more complete sentences are formed, they are returned.
   * Any trailing incomplete sentence remains in the buffer.
   *
   * @param chunk The incremental text fragment.
   * @returns Array of newly completed sentences.
   */
  public append(chunk: string): string[] {
    if (!chunk) {
      return []
    }

    this.buffer += chunk

    // If buffer doesn't even contain any sentence-ending punctuation, nothing complete yet
    if (!/[.?!…\n]/.test(this.buffer)) {
      return []
    }

    // Try segmenting the entire current buffer
    const candidateSentences = splitIntoSentences(this.buffer)
    if (candidateSentences.length === 0) {
      return []
    }

    // Check if the current buffer ends with a strong sentence terminator
    // (a dot, question mark, exclamation, ellipsis, or newline followed by whitespace/end)
    const trimmedBuffer = this.buffer.trimEnd()
    const endsWithTerminator = /[.?!…]$/.test(trimmedBuffer)

    // Even if it ends with a dot, make sure it's not a protected abbreviation (e.g., "TP.")
    // or decimal (e.g., "3.")
    const endsWithAbbrOrDecimal =
      /\b(TP|ThS|TS|PGS|GS|BS|DS|KS|KTS|v\.v|e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms)\.$/i.test(
        trimmedBuffer
      ) || /\d\.$/.test(trimmedBuffer)

    const completed: string[] = []

    if (endsWithTerminator && !endsWithAbbrOrDecimal) {
      // All candidate sentences are complete!
      completed.push(...candidateSentences)
      this.buffer = ''
    } else {
      // The last candidate segment is likely incomplete and still streaming in
      if (candidateSentences.length > 1) {
        // Emit all earlier sentences
        const ready = candidateSentences.slice(0, -1)
        completed.push(...ready)

        // Find the remaining text after the emitted sentences
        // The last sentence becomes the active buffer
        const lastIncomplete = candidateSentences[candidateSentences.length - 1]

        // Keep lastIncomplete (and any trailing whitespace/punctuation) in buffer
        const lastIndex = this.buffer.lastIndexOf(lastIncomplete)
        if (lastIndex !== -1) {
          this.buffer = this.buffer.slice(lastIndex)
        } else {
          this.buffer = lastIncomplete
        }
      }
      // If candidateSentences.length === 1 and not terminated, keep in buffer
    }

    return completed
  }

  /**
   * Flushes any remaining incomplete sentence from the buffer.
   * Should be called when the response stream signals completion.
   *
   * @returns Array of remaining sentences (usually 0 or 1).
   */
  public flush(): string[] {
    const remaining = this.buffer.trim()
    this.buffer = ''

    if (!remaining) {
      return []
    }

    const sentences = splitIntoSentences(remaining)
    return sentences.length > 0 ? sentences : [remaining]
  }

  /**
   * Discards all buffered characters immediately (e.g. on user cancellation).
   */
  public clear(): void {
    this.buffer = ''
  }

  /**
   * Returns the currently held incomplete string fragment.
   */
  public getRemaining(): string {
    return this.buffer
  }

  /**
   * True if buffer has no non-whitespace characters.
   */
  public isEmpty(): boolean {
    return this.buffer.trim().length === 0
  }
}
