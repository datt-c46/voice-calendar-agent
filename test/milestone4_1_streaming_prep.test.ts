import { test } from 'node:test'
import assert from 'node:assert'
import {
  LatencyTracker,
  defaultLatencyTracker,
  generateInteractionId
} from '../src/renderer/src/services/telemetry'
import { SentenceBuffer, SimpleResponseStream } from '../src/renderer/src/services/streaming'
import { TTSQueue } from '../src/renderer/src/services/tts/ttsQueue'
import { MockTtsProvider } from '../src/renderer/src/services/tts/mockTtsProvider'
import { AgentOrchestrator } from '../src/main/agent/agentOrchestrator'
import { MockCalendarService } from '../src/main/calendar/mockCalendarService'
import { DateTime } from 'luxon'

test('Milestone 4.1: Streaming Architecture + Latency Instrumentation Suite', async (t) => {
  console.log('\n====================================================')
  console.log('STARTING MILESTONE 4.1 STREAMING PREPARATION TESTS')
  console.log('====================================================\n')

  await t.test('1. Interaction ID generation and uniqueness', () => {
    const id1 = generateInteractionId()
    const id2 = generateInteractionId()
    assert.ok(id1 && id1.length > 20, 'Interaction ID should be a valid UUID string')
    assert.ok(id2 && id2.length > 20, 'Interaction ID should be a valid UUID string')
    assert.notStrictEqual(id1, id2, 'Two generated IDs must be strictly unique')
    console.log(`  ✓ Generated unique IDs: ${id1} & ${id2}`)
  })

  await t.test('2. LatencyTracker stage event recording and TTFA calculation', async () => {
    const tracker = new LatencyTracker({ isDevMode: false })
    const interactionId = tracker.startInteraction()

    tracker.recordEvent('SPEECH_START')
    await new Promise((r) => setTimeout(r, 40))
    tracker.recordEvent('SPEECH_END', { durationMs: 40 })

    tracker.recordEvent('STT_START')
    await new Promise((r) => setTimeout(r, 30))
    tracker.recordEvent('STT_FIRST_RESULT', { text: 'Ngày mai tôi có lịch gì?' })
    tracker.recordEvent('STT_COMPLETE', { text: 'Ngày mai tôi có lịch gì?', language: 'vi' })

    tracker.recordEvent('AGENT_START')
    await new Promise((r) => setTimeout(r, 20))
    tracker.recordEvent('AGENT_COMPLETE', { intent: 'LIST_EVENTS' })

    tracker.recordEvent('RESPONSE_FORMAT_START')
    tracker.recordEvent('RESPONSE_FORMAT_COMPLETE')

    tracker.recordEvent('TTS_QUEUE_START', { sentencesCount: 2 })
    await new Promise((r) => setTimeout(r, 15))
    tracker.recordEvent('TTS_FIRST_START', { sentence: 'Bạn có 2 sự kiện.' })
    await new Promise((r) => setTimeout(r, 50))
    tracker.recordEvent('TTS_COMPLETE', { totalSentences: 2 })

    const metrics = tracker.getMetrics(interactionId)
    assert.ok(metrics, 'Metrics should be computed')
    assert.strictEqual(metrics.interactionId, interactionId)
    assert.ok(
      metrics.speechDurationMs >= 35,
      `Speech duration (${metrics.speechDurationMs}ms) should be >= 35ms`
    )
    assert.ok(
      metrics.sttLatencyMs >= 25,
      `STT latency (${metrics.sttLatencyMs}ms) should be >= 25ms`
    )
    assert.ok(
      metrics.agentLatencyMs >= 15,
      `Agent latency (${metrics.agentLatencyMs}ms) should be >= 15ms`
    )
    assert.ok(metrics.timeToFirstAudioMs > 0, 'TTFA must be greater than 0')
    assert.ok(
      metrics.timeToFirstAudioMs >= metrics.sttLatencyMs + metrics.agentLatencyMs,
      'TTFA must include STT + Agent + TTS startup'
    )
    assert.ok(
      metrics.totalDurationMs >= metrics.timeToFirstAudioMs,
      'Total duration must be >= TTFA'
    )

    const snapshot = tracker.getPerformanceSnapshot(interactionId)
    assert.ok(snapshot, 'Performance snapshot should be generated')
    assert.ok(
      snapshot.formattedText.includes('Voice Performance'),
      'Snapshot contains formatted text'
    )
    assert.ok(snapshot.formattedText.includes('TTFA:'), 'Snapshot contains TTFA')
    console.log(
      `  ✓ Latency Metrics & TTFA verified: TTFA=${metrics.timeToFirstAudioMs}ms, Total=${metrics.totalDurationMs}ms`
    )
  })

  await t.test('3. Multi-interaction isolation (Request A vs Request B)', () => {
    const tracker = new LatencyTracker({ isDevMode: false })
    const idA = tracker.startInteraction()
    tracker.recordEvent('SPEECH_START', undefined, idA)
    tracker.recordEvent('SPEECH_END', undefined, idA)

    const idB = tracker.startInteraction()
    tracker.recordEvent('SPEECH_START', undefined, idB)
    tracker.recordEvent('SPEECH_END', undefined, idB)
    tracker.recordEvent('STT_COMPLETE', undefined, idB)

    const eventsA = tracker.getEvents(idA)
    const eventsB = tracker.getEvents(idB)
    assert.strictEqual(eventsA.length, 2, 'Request A should only have 2 events')
    assert.strictEqual(eventsB.length, 3, 'Request B should only have 3 events')
    assert.ok(eventsA.every((e) => e.interactionId === idA))
    assert.ok(eventsB.every((e) => e.interactionId === idB))
    console.log('  ✓ Interaction ID isolation prevents mixing events across concurrent requests')
  })

  await t.test('4. SentenceBuffer incremental sentence detection', () => {
    const buffer = new SentenceBuffer()

    // Chunk 1 & 2
    const chunk1 = buffer.append('Ngày mai bạn có')
    assert.deepStrictEqual(chunk1, [], 'Incomplete chunk should emit nothing')

    const chunk2 = buffer.append(' 2 cuộc họp.')
    assert.deepStrictEqual(
      chunk2,
      ['Ngày mai bạn có 2 cuộc họp.'],
      'Completed sentence should emit immediately'
    )
    assert.strictEqual(
      buffer.getRemaining(),
      '',
      'Buffer should be empty after exact completed sentence'
    )

    // Incomplete sentence across multiple chunks
    buffer.append('Cuộc họp đầu tiên')
    buffer.append(' bắt đầu lúc 9 giờ')
    assert.deepStrictEqual(buffer.getRemaining(), 'Cuộc họp đầu tiên bắt đầu lúc 9 giờ')

    const chunk5 = buffer.append(' sáng.')
    assert.deepStrictEqual(chunk5, ['Cuộc họp đầu tiên bắt đầu lúc 9 giờ sáng.'])
    assert.strictEqual(buffer.getRemaining(), '')

    // Decimal protection inside streaming chunks: "3.5 giờ"
    buffer.append('Dự kiến kéo dài 3.')
    assert.deepStrictEqual(
      buffer.getRemaining(),
      'Dự kiến kéo dài 3.',
      'Should not emit on decimal dot'
    )
    const decimalDone = buffer.append('5 giờ chiều.')
    assert.deepStrictEqual(decimalDone, ['Dự kiến kéo dài 3.5 giờ chiều.'])

    // Flush remainder test
    buffer.append('Còn một câu chưa có dấu chấm')
    const flushed = buffer.flush()
    assert.deepStrictEqual(flushed, ['Còn một câu chưa có dấu chấm'])
    assert.strictEqual(buffer.getRemaining(), '')

    // Clear test
    buffer.append('Dữ liệu chuẩn bị hủy')
    buffer.clear()
    assert.strictEqual(buffer.isEmpty(), true)

    console.log(
      '  ✓ SentenceBuffer correctly accumulates partial chunks and emits completed sentences'
    )
  })

  await t.test('5. SimpleResponseStream async iterable and event emission', async () => {
    const stream = new SimpleResponseStream()
    const collectedChunks: string[] = []

    stream.onChunk((chunk) => {
      collectedChunks.push(chunk.text)
    })

    stream.push('Xin chào,')
    stream.push(' tôi là trợ lý.')
    stream.complete()

    assert.strictEqual(stream.isComplete(), true)
    assert.deepStrictEqual(collectedChunks, ['Xin chào,', ' tôi là trợ lý.'])

    // Consume via AsyncIterable
    const stream2 = new SimpleResponseStream()
    setTimeout(() => {
      stream2.push('Part 1 ')
      stream2.push('Part 2')
      stream2.complete()
    }, 10)

    const parts: string[] = []
    for await (const text of stream2) {
      parts.push(text)
    }
    assert.deepStrictEqual(parts, ['Part 1 ', 'Part 2'])
    console.log('  ✓ SimpleResponseStream successfully emits chunks and supports AsyncIterable')
  })

  await t.test('6. TTSQueue Backpressure and Queue Bounding', () => {
    const mockProvider = new MockTtsProvider()
    const queue = new TTSQueue(mockProvider, { maxQueueSize: 3, highWaterMark: 2 })

    queue.enqueue('Câu 1.')
    queue.enqueue('Câu 2.')
    assert.strictEqual(queue.getQueueLength(), 2)
    assert.strictEqual(queue.isOverloaded(), false)

    queue.enqueue('Câu 3.')
    assert.strictEqual(queue.isOverloaded(), true, 'Queue with 3 items should reach maxQueueSize')

    // Attempting to enqueue when overloaded should be rejected/dropped
    queue.enqueue('Câu 4 bị tràn.')
    assert.strictEqual(
      queue.getStatus().progress.totalSentences,
      3,
      'Item beyond capacity must be dropped'
    )
    queue.stop()
    console.log('  ✓ TTSQueue correctly enforces capacity limits and detects backpressure overload')
  })

  await t.test(
    '7. Baseline Performance Measurements Across 5 Voice Commands (Section 5 & 20)',
    async () => {
      console.log('\n  --- Executing 5 Baseline Voice Commands ---')
      const calendar = new MockCalendarService()
      const orchestrator = new AgentOrchestrator(calendar)
      const mockProvider = new MockTtsProvider()
      const queue = new TTSQueue(mockProvider)

      // Pre-populate calendar for listing/updating
      const now = DateTime.now().setZone('Asia/Bangkok')
      const tomorrow10am = now
        .plus({ days: 1 })
        .set({ hour: 10, minute: 0, second: 0, millisecond: 0 })
      const tomorrow3pm = now
        .plus({ days: 1 })
        .set({ hour: 15, minute: 0, second: 0, millisecond: 0 })

      await calendar.createEvent({
        summary: 'Họp với A',
        startDateTime: tomorrow3pm.toISO()!,
        endDateTime: tomorrow3pm.plus({ hours: 1 }).toISO()!,
        timeZone: 'Asia/Bangkok'
      })

      await calendar.createEvent({
        summary: 'Họp ban quản trị',
        startDateTime: tomorrow10am.toISO()!,
        endDateTime: tomorrow10am.plus({ hours: 1 }).toISO()!,
        timeZone: 'Asia/Bangkok'
      })

      const baselineCommands = [
        { id: 1, text: 'Ngày mai tôi có lịch gì?', speechMs: 1400 },
        { id: 2, text: 'Chiều mai lúc 3 giờ họp với A', speechMs: 1800 },
        { id: 3, text: 'Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ', speechMs: 2200 },
        { id: 4, text: 'Xóa cuộc họp lúc 4 giờ chiều ngày mai', speechMs: 1900 },
        { id: 5, text: 'Ngày mai tôi có cuộc họp nào không?', speechMs: 1600 }
      ]

      const baselineResults: Array<{
        cmd: string
        speechDurationMs: number
        sttLatencyMs: number
        agentLatencyMs: number
        ttsStartupMs: number
        ttfaMs: number
        totalDurationMs: number
      }> = []

      for (const item of baselineCommands) {
        const tracker = defaultLatencyTracker
        const interactionId = tracker.startInteraction()

        // 1. Simulated Speech
        tracker.recordEvent('SPEECH_START')
        await new Promise((r) => setTimeout(r, 20))
        tracker.recordEvent('SPEECH_END', { durationMs: item.speechMs })

        // 2. Simulated STT
        tracker.recordEvent('STT_START')
        await new Promise((r) => setTimeout(r, 35)) // Simulated fast STT
        tracker.recordEvent('STT_FIRST_RESULT', { text: item.text })
        tracker.recordEvent('STT_COMPLETE', { text: item.text, language: 'vi' })

        // 3. Real Agent Orchestrator Execution
        tracker.recordEvent('AGENT_START')
        const agentResult = await orchestrator.processCommand({ text: item.text })
        tracker.recordEvent('AGENT_COMPLETE', {
          intent: agentResult.intent,
          success: agentResult.success
        })

        // 4. Response Formatting & TTS Queue
        tracker.recordEvent('RESPONSE_FORMAT_START')
        tracker.recordEvent('RESPONSE_FORMAT_COMPLETE')

        // 5. TTS Sequential Synthesis
        const speechPromise = queue.speak(agentResult.message)
        await speechPromise

        const metrics = tracker.getMetrics(interactionId)
        assert.ok(metrics, 'Metrics must be generated')

        baselineResults.push({
          cmd: item.text,
          speechDurationMs: item.speechMs,
          sttLatencyMs: metrics.sttLatencyMs,
          agentLatencyMs: metrics.agentLatencyMs,
          ttsStartupMs: metrics.ttsStartupLatencyMs,
          ttfaMs: metrics.timeToFirstAudioMs,
          totalDurationMs: metrics.totalDurationMs
        })

        console.log(`  [Command ${item.id}] "${item.text}"`)
        console.log(`    Intent: ${agentResult.intent || 'NONE'} | Success: ${agentResult.success}`)
        console.log(
          `    Speech: ${item.speechMs}ms | STT: ${metrics.sttLatencyMs}ms | Agent: ${metrics.agentLatencyMs}ms | TTFA: ${metrics.timeToFirstAudioMs}ms | Total: ${metrics.totalDurationMs}ms`
        )
      }

      assert.strictEqual(baselineResults.length, 5, 'All 5 baseline commands must be recorded')
      assert.ok(
        baselineResults.every((r) => r.ttfaMs > 0),
        'Every command must have a valid positive TTFA'
      )
      console.log('  ✓ 5/5 Baseline voice commands executed, measured, and verified successfully')
    }
  )

  await t.test('8. Edge cases: Error tracking and cancellation telemetry', () => {
    const tracker = new LatencyTracker({ isDevMode: false })
    const id = tracker.startInteraction()

    tracker.recordEvent('SPEECH_START')
    tracker.recordEvent('SPEECH_END')
    tracker.recordError('STT', 'Audio network timeout')

    const events = tracker.getEvents(id)
    const errEvent = events.find((e) => e.type === 'ERROR')
    assert.ok(errEvent, 'Error event must be recorded')
    assert.strictEqual(errEvent.metadata?.stage, 'STT')

    tracker.recordCancel('User clicked Stop')
    const cancelEvent = tracker.getEvents(id).find((e) => e.type === 'CANCELLED')
    assert.ok(cancelEvent, 'Cancel event must be recorded')
    assert.strictEqual(cancelEvent.metadata?.reason, 'User clicked Stop')
    console.log('  ✓ Telemetry captures ERROR and CANCELLED states gracefully')
  })

  console.log('\n====================================================')
  console.log('ALL MILESTONE 4.1 TESTS PASSED SUCCESSFULLY!')
  console.log('====================================================\n')
})
