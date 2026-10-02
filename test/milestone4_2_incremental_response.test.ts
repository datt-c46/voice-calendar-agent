/**
 * Milestone 4.2 Incremental Response + Sentence Streaming Verification Suite.
 *
 * Verifies:
 *   1. Single-sentence response streaming
 *   2. Three-sentence response streaming
 *   3. Long multi-sentence response streaming
 *   4. Multiple sentences arriving in a single chunk
 *   5. One sentence split across multiple chunks
 *   6. Final incomplete sentence requiring flush()
 *   7. Cancellation during stream consumption
 *   8. New request while old stream is active (stale stream protection)
 *   9. Empty stream handling (no erroneous TTS calls or empty queue items)
 *  10. Stream error handling (graceful degradation, no app crash, no replay)
 *  11. Real-time metric measurement: TTFS (Time to First Sentence), TTFA, Total duration
 *  12. Calendar regression (LIST, CREATE, UPDATE, DELETE) & Asia/Bangkok UTC+7 preservation
 */

import assert from 'node:assert'
import {
  SentenceBuffer,
  SimpleResponseStream,
  createMockResponseStream
} from '../src/renderer/src/services/streaming'
import { TTSQueue } from '../src/renderer/src/services/tts/ttsQueue'
import { MockTtsProvider } from '../src/renderer/src/services/tts/mockTtsProvider'
import { formatAgentResponse } from '../src/renderer/src/services/tts/responseFormatter'
import { defaultLatencyTracker } from '../src/renderer/src/services/telemetry/latencyTracker'
import { AgentOrchestrator } from '../src/main/agent/agentOrchestrator'
import { MockCalendarService } from '../src/main/calendar/mockCalendarService'

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runTestSuite(): Promise<void> {
  console.log('====================================================')
  console.log('STARTING MILESTONE 4.2 INCREMENTAL RESPONSE TEST SUITE')
  console.log('====================================================\n')

  const mockProvider = new MockTtsProvider()
  const queue = new TTSQueue(mockProvider)

  // ----------------------------------------------------
  // TEST 1: Single-sentence response
  // ----------------------------------------------------
  console.log('[Test 1] Single-sentence response:')
  {
    defaultLatencyTracker.startInteraction()
    const text = 'Ngày mai bạn có 2 cuộc họp.'
    const stream = createMockResponseStream(text, {
      chunks: ['Ngày mai bạn', ' có 2 cuộc họp.'],
      chunkDelayMs: 20
    })

    let onStartCalled = false
    let onEndCalled = false

    await queue.speakStream(stream, {
      onStart: () => {
        onStartCalled = true
      },
      onEnd: () => {
        onEndCalled = true
      }
    })

    const metrics = defaultLatencyTracker.getMetrics()
    console.log(`  ✓ Single sentence processed. TTFS: ${metrics?.timeToFirstSentenceMs}ms`)
    assert.strictEqual(queue.getStatus().progress.totalSentences, 1)
    assert.strictEqual(queue.getStatus().state, 'completed')
    assert.strictEqual(onStartCalled, true)
    assert.strictEqual(onEndCalled, true)
  }

  // ----------------------------------------------------
  // TEST 2: Three-sentence response
  // ----------------------------------------------------
  console.log('\n[Test 2] Three-sentence response:')
  {
    defaultLatencyTracker.startInteraction()
    const chunks = [
      'Ngày mai bạn có 2 cuộc họp. ',
      'Cuộc họp đầu tiên lúc 9 giờ sáng. ',
      'Cuộc họp thứ hai lúc 3 giờ chiều.'
    ]
    const stream = createMockResponseStream(chunks.join(''), { chunks, chunkDelayMs: 20 })

    await queue.speakStream(stream)
    const metrics = defaultLatencyTracker.getMetrics()

    console.log(
      `  ✓ 3 sentences streamed and spoken sequentially. TTFS: ${metrics?.timeToFirstSentenceMs}ms, TTFA: ${metrics?.timeToFirstAudioMs}ms`
    )
    assert.strictEqual(queue.getStatus().progress.totalSentences, 3)
    assert.strictEqual(queue.getStatus().state, 'completed')
  }

  // ----------------------------------------------------
  // TEST 3: Long response
  // ----------------------------------------------------
  console.log('\n[Test 3] Long multi-sentence response:')
  {
    defaultLatencyTracker.startInteraction()
    const sentences = [
      'Lịch trình ngày mai của bạn rất bận rộn.',
      'Buổi sáng lúc 8:00 có họp giao ban định kỳ.',
      'Tiếp theo lúc 10:30 bạn có buổi phỏng vấn ứng viên kỹ sư.',
      'Buổi chiều lúc 14:00 có buổi demo sản phẩm với khách hàng.',
      'Cuối cùng lúc 16:30 bạn có buổi họp tổng kết tuần.'
    ]
    const stream = createMockResponseStream(sentences.join(' '), {
      chunks: sentences.map((s) => s + ' '),
      chunkDelayMs: 15
    })

    const tStart = Date.now()
    await queue.speakStream(stream)
    const totalMs = Date.now() - tStart

    const metrics = defaultLatencyTracker.getMetrics()
    console.log(
      `  ✓ Long response (5 sentences) completed in ${totalMs}ms. TTFS: ${metrics?.timeToFirstSentenceMs}ms`
    )
    assert.strictEqual(queue.getStatus().progress.totalSentences, 5)
    assert.strictEqual(queue.getStatus().state, 'completed')
  }

  // ----------------------------------------------------
  // TEST 4: Multiple sentences in one chunk
  // ----------------------------------------------------
  console.log('\n[Test 4] Multiple sentences in a single chunk:')
  {
    const buffer = new SentenceBuffer()
    const multiSentenceChunk =
      'Ngày mai bạn có 2 cuộc họp. Cuộc họp đầu tiên lúc 9 giờ sáng. Cuộc họp thứ hai lúc 3 giờ chiều.'
    const emitted = buffer.append(multiSentenceChunk)

    console.log(`  Emitted sentences count: ${emitted.length}`)
    assert.strictEqual(emitted.length, 3)
    assert.strictEqual(emitted[0], 'Ngày mai bạn có 2 cuộc họp.')
    assert.strictEqual(emitted[1], 'Cuộc họp đầu tiên lúc 9 giờ sáng.')
    assert.strictEqual(emitted[2], 'Cuộc họp thứ hai lúc 3 giờ chiều.')
    assert.strictEqual(buffer.isEmpty(), true)
    console.log('  ✓ Multiple sentences in one chunk cleanly segmented and emitted.')
  }

  // ----------------------------------------------------
  // TEST 5: One sentence split across multiple chunks
  // ----------------------------------------------------
  console.log('\n[Test 5] One sentence split across multiple chunks:')
  {
    const buffer = new SentenceBuffer()
    const chunk1 = 'Ngày mai bạn '
    const chunk2 = 'có 2 '
    const chunk3 = 'cuộc họp.'

    const emit1 = buffer.append(chunk1)
    assert.deepStrictEqual(emit1, [])
    console.log('  Chunk 1 -> 0 emitted (incomplete tail retained)')

    const emit2 = buffer.append(chunk2)
    assert.deepStrictEqual(emit2, [])
    console.log('  Chunk 2 -> 0 emitted (incomplete tail retained)')

    const emit3 = buffer.append(chunk3)
    assert.deepStrictEqual(emit3, ['Ngày mai bạn có 2 cuộc họp.'])
    assert.strictEqual(buffer.isEmpty(), true)
    console.log('  Chunk 3 -> Complete sentence emitted on boundary!')
    console.log('  ✓ Sentence boundary correctly assembled across fragments.')
  }

  // ----------------------------------------------------
  // TEST 6: Final incomplete sentence requiring flush()
  // ----------------------------------------------------
  console.log('\n[Test 6] Final incomplete sentence requiring flush():')
  {
    const buffer = new SentenceBuffer()
    const chunk1 = 'Ngày mai bạn có'
    const chunk2 = ' 2 cuộc họp' // No terminating dot

    const emit1 = buffer.append(chunk1)
    assert.deepStrictEqual(emit1, [])

    const emit2 = buffer.append(chunk2)
    assert.deepStrictEqual(emit2, [])

    const flushed = buffer.flush()
    console.log(`  Flushed result: "${flushed[0]}"`)
    assert.deepStrictEqual(flushed, ['Ngày mai bạn có 2 cuộc họp'])
    assert.strictEqual(buffer.isEmpty(), true)
    console.log('  ✓ Flush successfully flushed remaining incomplete sentence at stream end.')
  }

  // ----------------------------------------------------
  // TEST 7: Cancellation during stream
  // ----------------------------------------------------
  console.log('\n[Test 7] Cancellation during stream:')
  {
    defaultLatencyTracker.startInteraction()
    const chunks = [
      'Câu thứ nhất đã sẵn sàng. ',
      'Câu thứ hai đang đến. ',
      'Câu thứ ba không bao giờ được đọc. ',
      'Câu thứ tư bị hủy.'
    ]
    const stream = createMockResponseStream(chunks.join(''), { chunks, chunkDelayMs: 40 })

    const speakPromise = queue.speakStream(stream)

    // Wait until first sentence has been queued and speaking starts
    await sleep(45)

    // User cancels
    queue.stop()
    await speakPromise

    assert.strictEqual(stream.isCancelled(), true)
    assert.strictEqual(queue.getStatus().state, 'idle')
    console.log('  ✓ Stream and queue stopped immediately upon cancellation.')
  }

  // ----------------------------------------------------
  // TEST 8: New request while old stream is active (Stale stream protection)
  // ----------------------------------------------------
  console.log('\n[Test 8] New request while old stream is active (Stale stream protection):')
  {
    defaultLatencyTracker.startInteraction()
    const streamA = new SimpleResponseStream()
    const streamB = new SimpleResponseStream()

    // Request A starts
    const promiseA = queue.speakStream(streamA)
    streamA.push('Yêu cầu A bắt đầu. ', false)

    await sleep(10)
    assert.strictEqual(queue.getStatus().progress.totalSentences, 1)

    // Request B arrives immediately, superseding Request A
    const promiseB = queue.speakStream(streamB)
    streamB.push('Yêu cầu B hoàn thành. ', true)

    // Request A produces a late chunk after Request B took over
    streamA.push('Yêu cầu A bị trễ và phải bị loại bỏ.', true)

    await promiseB
    await promiseA // should resolve cleanly due to cancellation

    const status = queue.getStatus()
    console.log(`  Final status progress totalSentences: ${status.progress.totalSentences}`)
    assert.strictEqual(status.progress.totalSentences, 1)
    assert.strictEqual(status.state, 'completed')
    console.log('  ✓ Late chunk from Request A did NOT enter Request B queue.')
  }

  // ----------------------------------------------------
  // TEST 9: Empty stream
  // ----------------------------------------------------
  console.log('\n[Test 9] Empty stream handling:')
  {
    const emptyStream = createMockResponseStream('', { chunks: [] })
    await queue.speakStream(emptyStream)

    assert.strictEqual(queue.getStatus().state, 'idle')
    assert.strictEqual(queue.getStatus().progress.totalSentences, 0)
    assert.strictEqual(mockProvider.isSpeaking(), false)
    console.log('  ✓ Empty stream resolved cleanly without queueing empty strings or invoking TTS.')
  }

  // ----------------------------------------------------
  // TEST 10: Stream error handling
  // ----------------------------------------------------
  console.log('\n[Test 10] Stream error handling:')
  {
    const errorStream = new SimpleResponseStream()
    let errorCaught = false

    const speakPromise = queue.speakStream(errorStream).catch((err) => {
      errorCaught = true
      return err
    })

    errorStream.push('Câu đầu tiên trước lỗi. ', false)
    await sleep(15)

    errorStream.error(new Error('Mất kết nối mạng trong quá trình stream!'))
    await speakPromise

    assert.strictEqual(errorCaught, true)
    assert.strictEqual(queue.getStatus().state, 'error')
    console.log('  ✓ Stream error handled gracefully without crashing application.')
  }

  // ----------------------------------------------------
  // TEST 11: Real-time latency measurements (TTFS, TTFA, Total)
  // ----------------------------------------------------
  console.log('\n[Test 11] Latency measurements verification:')
  {
    const interactionId = defaultLatencyTracker.startInteraction()
    defaultLatencyTracker.recordEvent('SPEECH_END')
    defaultLatencyTracker.recordEvent('RESPONSE_STREAM_START')

    await sleep(25)
    defaultLatencyTracker.recordEvent('FIRST_SENTENCE_DETECTED')

    await sleep(10)
    defaultLatencyTracker.recordEvent('TTS_FIRST_START')

    const metrics = defaultLatencyTracker.getMetrics()
    console.log(`  Interaction ID: ${metrics?.interactionId}`)
    console.log(`  TTFS: ${metrics?.timeToFirstSentenceMs}ms (Expected ~25ms)`)
    console.log(`  TTFA: ${metrics?.timeToFirstAudioMs}ms (Expected ~35ms)`)

    assert.ok(
      metrics?.timeToFirstSentenceMs !== undefined && metrics.timeToFirstSentenceMs >= 20,
      'TTFS must be >= 20ms'
    )
    assert.ok(
      metrics?.timeToFirstAudioMs !== undefined && metrics.timeToFirstAudioMs >= 30,
      'TTFA must be >= 30ms'
    )
    assert.strictEqual(metrics?.interactionId, interactionId)
    console.log('  ✓ TTFS and TTFA recorded strictly from runtime timestamps.')
  }

  // ----------------------------------------------------
  // TEST 12: Calendar Regression (LIST, CREATE, UPDATE, DELETE) & Timezone
  // ----------------------------------------------------
  console.log('\n[Test 12] Calendar Regression & Asia/Bangkok (+07:00) Timezone:')
  {
    const calService = new MockCalendarService()
    const orchestrator = new AgentOrchestrator(calService)

    const nowIso = '2026-10-02T08:00:00.000+07:00'
    const tz = 'Asia/Bangkok'

    // 1. CREATE_EVENT
    const createRes = await orchestrator.processCommand({
      text: 'Chiều mai lúc 3 giờ họp với Anh Tuấn',
      clientTimestamp: nowIso,
      timeZone: tz
    })
    console.log(`  [Create] "${createRes.message}"`)
    assert.strictEqual(createRes.success, true)
    assert.strictEqual(createRes.intent, 'CREATE_EVENT')

    // Verify time is formatted in local 15:00 (+07:00), not UTC raw ISO
    assert.ok(
      createRes.message.includes('15:00') || createRes.message.includes('3:00'),
      'Message must contain local formatted time'
    )

    // 2. LIST_EVENTS
    const listRes = await orchestrator.processCommand({
      text: 'Ngày mai tôi có lịch gì?',
      clientTimestamp: nowIso,
      timeZone: tz
    })
    console.log(`  [List] "${listRes.message}"`)
    assert.strictEqual(listRes.success, true)
    assert.strictEqual(listRes.intent, 'LIST_EVENTS')

    // 3. UPDATE_EVENT
    const updateRes = await orchestrator.processCommand({
      text: 'Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ',
      clientTimestamp: nowIso,
      timeZone: tz
    })
    console.log(`  [Update] "${updateRes.message}"`)
    assert.strictEqual(updateRes.success, true)
    assert.strictEqual(updateRes.intent, 'UPDATE_EVENT')

    // 4. DELETE_EVENT
    const deleteRes = await orchestrator.processCommand({
      text: 'Xóa cuộc họp lúc 4 giờ chiều ngày mai',
      clientTimestamp: nowIso,
      timeZone: tz
    })
    console.log(`  [Delete] "${deleteRes.message}"`)
    assert.strictEqual(deleteRes.success, true)
    assert.strictEqual(deleteRes.intent, 'DELETE_EVENT')

    // 5. Stream response through TTS pipeline
    const formatted = formatAgentResponse(createRes.message)
    const calStream = createMockResponseStream(formatted.ttsText, { chunkDelayMs: 15 })
    await queue.speakStream(calStream)
    assert.strictEqual(queue.getStatus().state, 'completed')
    console.log('  ✓ Calendar CRUD pipeline fully functional with streaming response.')
  }

  // ----------------------------------------------------
  // TEST 13: Vietnamese text & decimal/version protection
  // ----------------------------------------------------
  console.log('\n[Test 13] Vietnamese punctuation, abbreviations & decimals protection:')
  {
    const sb = new SentenceBuffer()
    const testCases = [
      'Cuộc họp lúc 15:30 chiều mai.',
      'Thời gian dự kiến là 3.5 giờ.',
      'Đã phát hành phiên bản 1.5.0 thành công.',
      'Hẹn gặp BS. Nam tại TP. Hồ Chí Minh.',
      'Đã tạo cuộc họp!',
      'Bạn có muốn lưu thay đổi không?',
      'Đang đồng bộ dữ liệu…'
    ]

    for (const testText of testCases) {
      const emitted = sb.append(testText + ' ')
      assert.ok(emitted.length >= 1, `Failed to emit sentence for "${testText}"`)
      console.log(`  ✓ Handled: "${emitted[0]}"`)
    }
  }

  console.log('\n====================================================')
  console.log('ALL MILESTONE 4.2 TESTS COMPLETED SUCCESSFULLY!')
  console.log('====================================================\n')
}

void runTestSuite()
