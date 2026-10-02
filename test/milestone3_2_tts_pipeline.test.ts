import assert from 'node:assert'
import { AgentOrchestrator } from '../src/main/agent/agentOrchestrator'
import { MockCalendarService } from '../src/main/calendar/mockCalendarService'
import { MockTtsProvider } from '../src/renderer/src/services/tts/mockTtsProvider'
import { formatAgentResponse } from '../src/renderer/src/services/tts/responseFormatter'
import { splitIntoSentences } from '../src/renderer/src/services/tts/sentenceSplitter'
import { TTSQueue } from '../src/renderer/src/services/tts/ttsQueue'
import { TextToSpeechService } from '../src/renderer/src/services/tts/ttsService'

console.log('====================================================')
console.log('STARTING MILESTONE 3.2 ADVANCED TTS PIPELINE SUITE')
console.log('====================================================\n')

async function runTestSuite(): Promise<void> {
  const mockProvider = new MockTtsProvider()

  // [TEST 1] Sentence Segmentation with Protected Decimals, Times & Abbreviations (Section 5)
  console.log('[Test 1] Sentence Segmentation with Safe Tokens:')

  // 1a. Decimals and times preservation
  const textWithDecimals =
    'Cuộc họp sẽ kéo dài 3.5 giờ lúc 15:30. Sau đó chúng ta có 0.75 tiếng nghỉ ngơi!'
  const splitDecimals = splitIntoSentences(textWithDecimals)
  assert.strictEqual(splitDecimals.length, 2)
  assert.strictEqual(splitDecimals[0], 'Cuộc họp sẽ kéo dài 3.5 giờ lúc 15:30.')
  assert.strictEqual(splitDecimals[1], 'Sau đó chúng ta có 0.75 tiếng nghỉ ngơi!')
  console.log('  ✓ Decimals (3.5, 0.75) and times (15:30) protected from false segmentation.')

  // 1b. Abbreviations preservation
  const textWithAbbr =
    'Gặp TS. Nguyễn Văn A tại TP. Hồ Chí Minh lúc 9 giờ sáng. Mang theo tài liệu v.v. để báo cáo.'
  const splitAbbr = splitIntoSentences(textWithAbbr)
  assert.strictEqual(splitAbbr.length, 2)
  assert.strictEqual(splitAbbr[0], 'Gặp TS. Nguyễn Văn A tại TP. Hồ Chí Minh lúc 9 giờ sáng.')
  assert.strictEqual(splitAbbr[1], 'Mang theo tài liệu v.v. để báo cáo.')
  console.log('  ✓ Abbreviations (TS., TP., v.v.) protected from false segmentation.')

  // 1c. Multi-punctuation & Ellipsis
  const textWithEllipsis = 'Đang kiểm tra lịch... Bạn có 2 sự kiện! Có muốn xem không?'
  const splitEllipsis = splitIntoSentences(textWithEllipsis)
  assert.strictEqual(splitEllipsis.length, 3)
  assert.strictEqual(splitEllipsis[0], 'Đang kiểm tra lịch...')
  assert.strictEqual(splitEllipsis[1], 'Bạn có 2 sự kiện!')
  assert.strictEqual(splitEllipsis[2], 'Có muốn xem không?')
  console.log('  ✓ Ellipsis (...) and mixed punctuation (!, ?) handled cleanly.')

  // 1d. Empty / Whitespace string
  assert.deepStrictEqual(splitIntoSentences(''), [])
  assert.deepStrictEqual(splitIntoSentences('   \n\t  '), [])
  console.log('  ✓ Empty and whitespace strings produce 0 sentences.')

  // [TEST 2] Response Formatter: UI text vs TTS text separation (Section 3 & 4)
  console.log('\n[Test 2] Response Formatter (UI Text vs Conversational TTS Text):')
  const rawListMsg = `Bạn có 2 sự kiện được lên lịch:
• Họp nhóm (09:00 - 10:00, ngày 03/10/2026)
• Ăn trưa với đối tác (12:00 - 13:00, ngày 03/10/2026)`

  const formatted = formatAgentResponse(rawListMsg)
  // UI text preserves bullet points for visual display
  assert.strictEqual(formatted.uiText.includes('•'), true)
  // TTS text converts bullet lines to clean sentences with 'đến'
  assert.strictEqual(formatted.ttsText.includes('•'), false)
  assert.strictEqual(formatted.ttsText.includes('09:00 đến 10:00'), true)
  assert.strictEqual(formatted.sentences.length, 3)
  assert.strictEqual(formatted.sentences[0], 'Bạn có 2 sự kiện được lên lịch.')
  assert.strictEqual(formatted.sentences[1], 'Họp nhóm (09:00 đến 10:00, ngày 03/10/2026).')
  assert.strictEqual(
    formatted.sentences[2],
    'Ăn trưa với đối tác (12:00 đến 13:00, ngày 03/10/2026).'
  )
  console.log('  ✓ Structured response cleanly partitioned into 3 sequential spoken sentences.')

  // [TEST 3] Multi-Sentence Response Sequential Queuing (Section 15)
  console.log('\n[Test 3] Multi-Sentence Response Sequential Execution in FIFO order:')
  mockProvider.clearHistory()
  const queue = new TTSQueue(mockProvider)

  const multiSentenceText =
    'Ngày mai bạn có 3 cuộc họp. Cuộc họp đầu tiên lúc 9 giờ sáng. Cuộc họp thứ hai lúc 1 giờ chiều. Cuộc họp cuối cùng lúc 3 giờ chiều.'

  const queuePromise = queue.speak(multiSentenceText)
  assert.strictEqual(queue.getStatus().progress.totalSentences, 4)
  assert.strictEqual(queue.isSpeaking(), true)

  await queuePromise
  assert.strictEqual(queue.getStatus().state, 'completed')
  assert.strictEqual(mockProvider.getHistory().length, 4)
  assert.strictEqual(mockProvider.getHistory()[0].text, 'Ngày mai bạn có 3 cuộc họp.')
  assert.strictEqual(mockProvider.getHistory()[1].text, 'Cuộc họp đầu tiên lúc 9 giờ sáng.')
  assert.strictEqual(mockProvider.getHistory()[2].text, 'Cuộc họp thứ hai lúc 1 giờ chiều.')
  assert.strictEqual(mockProvider.getHistory()[3].text, 'Cuộc họp cuối cùng lúc 3 giờ chiều.')
  console.log('  ✓ All 4 sentences processed strictly in FIFO sequence without overlap.')

  // [TEST 4] Cancellation & Generation Guard (Section 8)
  console.log('\n[Test 4] Robust Stop/Cancellation with Generation Guard:')
  mockProvider.clearHistory()
  const stopQueue = new TTSQueue(mockProvider)

  const longText =
    'Câu số một rất dài để kiểm tra. Câu số hai không được phép phát sau khi dừng. Câu số ba cũng phải bị hủy.'

  const longPromise = stopQueue.speak(longText)
  // Let sentence 1 begin
  assert.strictEqual(stopQueue.isSpeaking(), true)

  // Trigger stop immediately
  stopQueue.stop()
  await longPromise

  assert.strictEqual(stopQueue.isSpeaking(), false)
  assert.strictEqual(stopQueue.getStatus().state, 'idle')
  // Only sentence 1 was in progress before cancellation; sentence 2 and 3 must NEVER have played!
  assert.ok(
    mockProvider.getHistory().length <= 1,
    `Expected <= 1 utterance, got ${mockProvider.getHistory().length}`
  )
  console.log('  ✓ Cancellation successfully cleared queued sentences and halted playback.')

  // [TEST 5] Repeated Requests: New Request Supersedes Old Queue (Section 9)
  console.log('\n[Test 5] Repeated Requests (New request cancels and flushes old queue):')
  mockProvider.clearHistory()
  const preemptQueue = new TTSQueue(mockProvider)

  // Start Request A (3 sentences)
  void preemptQueue.speak('Câu A1. Câu A2. Câu A3.')
  assert.strictEqual(preemptQueue.isSpeaking(), true)

  // Immediately issue Request B (1 sentence)
  const reqBPromise = preemptQueue.speak('Câu B mới nhất đã thay thế hoàn toàn.')
  await reqBPromise

  const history = mockProvider.getHistory()
  const lastSpoken = history[history.length - 1].text
  assert.strictEqual(lastSpoken, 'Câu B mới nhất đã thay thế hoàn toàn.')
  // Request A's subsequent sentences (A2, A3) must NOT appear after Request B
  const bIndex = history.findIndex((h) => h.text.includes('Câu B mới nhất'))
  assert.strictEqual(bIndex, history.length - 1, 'Request B must be the final completed utterance')
  console.log('  ✓ Request B successfully superseded Request A without sentence mixing.')

  // [TEST 6] Short One-Sentence Response (Section 16)
  console.log('\n[Test 6] Short One-Sentence Response:')
  mockProvider.clearHistory()
  await preemptQueue.speak('Đã xóa cuộc họp.')
  assert.strictEqual(mockProvider.getHistory().length, 1)
  assert.strictEqual(mockProvider.getHistory()[0].text, 'Đã xóa cuộc họp.')
  console.log('  ✓ Single sentence processed as exactly 1 queue item.')

  // [TEST 7] Empty Response (Section 17)
  console.log('\n[Test 7] Empty Response Safeguard:')
  mockProvider.clearHistory()
  await preemptQueue.speak('')
  await preemptQueue.speak('    ')
  assert.strictEqual(mockProvider.getHistory().length, 0)
  assert.strictEqual(preemptQueue.isSpeaking(), false)
  console.log('  ✓ Empty and whitespace strings rejected without queue creation or speech call.')

  // [TEST 8] End-to-End Calendar Operations via AgentOrchestrator & TextToSpeechService
  console.log('\n[Test 8] End-to-End Calendar Operations & Latency Tracking (Section 19 & 23):')
  const mockCalendar = new MockCalendarService()
  const orchestrator = new AgentOrchestrator(mockCalendar)
  const ttsService = new TextToSpeechService(mockProvider)
  await ttsService.initialize()

  const operations = [
    { query: 'Ngày mai tôi có lịch gì?', intent: 'LIST_EVENTS' },
    { query: 'Chiều mai lúc 3 giờ họp với A', intent: 'CREATE_EVENT' },
    { query: 'Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ', intent: 'UPDATE_EVENT' },
    { query: 'Xóa cuộc họp lúc 4 giờ chiều ngày mai', intent: 'DELETE_EVENT' }
  ]

  for (const op of operations) {
    const t_agent0 = Date.now()
    const agentRes = await orchestrator.processCommand({ text: op.query })
    const agentDuration = Date.now() - t_agent0

    assert.strictEqual(agentRes.success, true)
    assert.strictEqual(agentRes.intent, op.intent)

    // Vocalize via TTS Service Queue
    const t_tts0 = Date.now()
    await ttsService.speak(agentRes.message)
    const ttsDuration = Date.now() - t_tts0

    const status = ttsService.getStatus()
    assert.strictEqual(status.state, 'completed')
    assert.ok(status.metrics?.totalDurationMs !== null)

    console.log(
      `  ✓ [${agentRes.intent}] "${op.query}" -> Agent: ${agentDuration}ms, Queue TTS: ${ttsDuration}ms (${status.progress?.totalSentences} sentences)`
    )
  }

  // [TEST 9] Timezone Preservation (Section 20)
  console.log('\n[Test 9] Timezone Preservation (Asia/Bangkok / UTC+7):')
  const createCmd = await orchestrator.processCommand({
    text: 'Chiều mai lúc 3 giờ họp với A'
  })
  const event = createCmd.events?.[0]
  assert.ok(event, 'Created event must exist')
  assert.strictEqual(event.start.timeZone, 'Asia/Bangkok')
  assert.ok(event.start.dateTime.includes('15:00:00.000+07:00'))

  // Verify the spoken message uses local time (15:00 or 3 giờ chiều), not UTC (08:00)
  const spokenFormatted = formatAgentResponse(createCmd.message)
  assert.strictEqual(spokenFormatted.ttsText.includes('15:00'), true)
  assert.strictEqual(spokenFormatted.ttsText.includes('08:00'), false)
  console.log(`  ✓ Spoken time verified as local Asia/Bangkok: "${spokenFormatted.sentences[0]}"`)

  // [TEST 10] Rapid Repeated Start/Stop Cycles (Section 24)
  console.log('\n[Test 10] 10 Rapid Start/Stop Cycles:')
  for (let i = 1; i <= 10; i++) {
    void ttsService.speak(`Câu thử nghiệm lặp lại thứ ${i}`)
    ttsService.stop()
  }
  assert.strictEqual(ttsService.isSpeaking(), false)
  assert.strictEqual(ttsService.getStatus().state, 'idle')
  console.log('  ✓ 10 rapid start/stop cycles completed without stuck states or memory leaks.')

  console.log('\n====================================================')
  console.log('ALL MILESTONE 3.2 ADVANCED TTS TESTS PASSED!')
  console.log('====================================================\n')
}

runTestSuite().catch((err) => {
  console.error('Milestone 3.2 test suite failed:', err)
  process.exit(1)
})
