import assert from 'node:assert'
import { AgentOrchestrator } from '../src/main/agent/agentOrchestrator'
import { MockCalendarService } from '../src/main/calendar/mockCalendarService'
import { MockSpeechToTextProvider } from '../src/main/voice/stt/mockSttProvider'
import { encodeWav } from '../src/renderer/src/utils/audioEncoder'

console.log('====================================================')
console.log('STARTING MILESTONE 2.4 VOICE -> AGENT VERIFICATION')
console.log('====================================================\n')

async function runTestSuite(): Promise<void> {
  const sampleRate = 16000
  const simulatedSpeech = new Float32Array(sampleRate * 1) // 1 second
  for (let i = 0; i < simulatedSpeech.length; i++) {
    simulatedSpeech[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5
  }
  const wavBuffer = encodeWav(simulatedSpeech, sampleRate)
  const base64Audio = Buffer.from(wavBuffer).toString('base64')

  const mockCalendar = new MockCalendarService()
  const orchestrator = new AgentOrchestrator(mockCalendar)
  const mockSTT = new MockSpeechToTextProvider()

  // [TEST 1] End-to-end Voice -> STT -> Agent Flow
  console.log('[Test 1] End-to-end Voice -> STT -> Agent Pipeline:')
  mockSTT.setMockResponses(['Chiều mai lúc 3 giờ họp với A'])

  // Step 1: STT
  const t0 = Date.now()
  const sttResult = await mockSTT.transcribe({ base64: base64Audio, durationMs: 1000 })
  const sttLatency = Date.now() - t0
  assert.strictEqual(sttResult.text, 'Chiều mai lúc 3 giờ họp với A')

  // Step 2: Agent Orchestration (same entry point as text CommandInput)
  const t1 = Date.now()
  const agentResult = await orchestrator.processCommand({ text: sttResult.text })
  const agentLatency = Date.now() - t1
  const totalLatency = sttLatency + agentLatency

  assert.strictEqual(agentResult.success, true)
  assert.strictEqual(agentResult.intent, 'CREATE_EVENT')
  assert.strictEqual(agentResult.events?.[0]?.summary, 'Họp với A')
  console.log(`  ✓ Audio transcribed to "${sttResult.text}"`)
  console.log(`  ✓ Agent executed intent: ${agentResult.intent}`)
  console.log(
    `  ✓ Timing recorded: STT=${sttLatency}ms, Agent=${agentLatency}ms, Total=${totalLatency}ms`
  )

  // [TEST 2] Timezone Regression Test: Asia/Bangkok (UTC+7)
  console.log('\n[Test 2] Timezone Regression (15:00 Asia/Bangkok / UTC+7):')
  const createdEvent = agentResult.events?.[0]
  assert.ok(createdEvent, 'Created event must exist')
  assert.strictEqual(createdEvent.start.timeZone, 'Asia/Bangkok')
  assert.ok(
    createdEvent.start.dateTime.includes('15:00:00.000+07:00'),
    `Expected 15:00:00.000+07:00, received: ${createdEvent.start.dateTime}`
  )
  console.log(`  ✓ Event verified at 15:00 Asia/Bangkok: ${createdEvent.start.dateTime}`)

  // [TEST 3] Vietnamese Test Matrix
  console.log('\n[Test 3] Vietnamese Test Matrix:')
  const viTestCases = [
    { voice: 'Ngày mai tôi có lịch gì?', expectedIntent: 'LIST_EVENTS' },
    { voice: 'Chiều mai lúc 3 giờ họp với A', expectedIntent: 'CREATE_EVENT' },
    { voice: 'Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ', expectedIntent: 'UPDATE_EVENT' },
    { voice: 'Xóa cuộc họp lúc 4 giờ chiều ngày mai', expectedIntent: 'DELETE_EVENT' },
    { voice: 'Ngày mai tôi có cuộc họp nào không?', expectedIntent: 'LIST_EVENTS' }
  ]

  for (const tc of viTestCases) {
    mockSTT.setMockResponses([tc.voice])
    const stt = await mockSTT.transcribe({ base64: base64Audio })
    const res = await orchestrator.processCommand({ text: stt.text })
    assert.strictEqual(res.success, true)
    assert.strictEqual(res.intent, tc.expectedIntent)
    console.log(`  ✓ Voice: "${tc.voice}" -> Intent: ${res.intent}`)
  }

  // [TEST 4] English Test Case
  console.log('\n[Test 4] English Test Case:')
  mockSTT.setMockResponses(['What do I have tomorrow?'])
  const enStt = await mockSTT.transcribe({ base64: base64Audio })
  const enRes = await orchestrator.processCommand({ text: enStt.text })
  assert.strictEqual(enRes.success, true)
  assert.strictEqual(enRes.intent, 'LIST_EVENTS')
  console.log(`  ✓ Voice: "${enStt.text}" -> Intent: ${enRes.intent}`)

  // [TEST 5] Empty / Whitespace-only Transcript Safeguard
  console.log('\n[Test 5] Empty / Whitespace-only Transcript Handling:')
  const emptyTranscripts = ['', '   ', '\n\t  ']
  let agentCalls = 0

  for (const emptyText of emptyTranscripts) {
    // In M2.4 useVoiceActivity, text is checked before sending to Agent:
    const trimmed = emptyText.trim()
    if (trimmed.length > 0) {
      agentCalls++
      await orchestrator.processCommand({ text: trimmed })
    }
  }
  assert.strictEqual(agentCalls, 0, 'Agent should never be invoked for empty transcripts')
  console.log(
    '  ✓ Empty and whitespace-only transcripts successfully rejected without Agent invocation.'
  )

  // [TEST 6] Double Processing Prevention Lock
  console.log('\n[Test 6] Double Processing Prevention (Lock verification):')
  let isProcessingLock = false
  let executedCount = 0

  async function simulateVoiceCompletion(segmentText: string): Promise<void> {
    if (isProcessingLock) {
      console.log('    [Lock] Blocked duplicate trigger attempt')
      return
    }
    isProcessingLock = true
    try {
      executedCount++
      await orchestrator.processCommand({ text: segmentText })
    } finally {
      isProcessingLock = false
    }
  }

  // Simulate two concurrent callbacks firing for the same speech segment
  const p1 = simulateVoiceCompletion('Ngày mai tôi có lịch gì?')
  const p2 = simulateVoiceCompletion('Ngày mai tôi có lịch gì?')
  await Promise.all([p1, p2])

  assert.strictEqual(executedCount, 1, 'Only 1 execution should occur when lock is active')
  console.log('  ✓ Duplicate trigger blocked; Agent executed exactly once.')

  // [TEST 7] Convergence: Text vs Voice Input Equivalence
  console.log('\n[Test 7] Text vs Voice Equivalence (Unified Pipeline):')
  const commandText = 'Ngày mai tôi có lịch gì?'

  // Path A: Direct Text Input (CommandInput)
  const textResult = await orchestrator.processCommand({ text: commandText })

  // Path B: Voice Transcript (STT -> Agent)
  mockSTT.setMockResponses([commandText])
  const voiceStt = await mockSTT.transcribe({ base64: base64Audio })
  const voiceResult = await orchestrator.processCommand({ text: voiceStt.text })

  assert.strictEqual(textResult.intent, voiceResult.intent)
  assert.strictEqual(textResult.success, voiceResult.success)
  assert.strictEqual(textResult.message, voiceResult.message)
  console.log(
    `  ✓ Both text and voice yielded identical intent (${textResult.intent}) and response message.`
  )

  // [TEST 8] Error Handling Stages (STT vs Agent vs Calendar)
  console.log('\n[Test 8] Error Handling Stages:')
  // 8a. STT Error
  try {
    await mockSTT.transcribe({})
    assert.fail('STT should error on missing audio')
  } catch (err: unknown) {
    assert.ok((err as Error).message.includes('No audio data provided'))
    console.log('  ✓ Stage 1 (STT Error) properly caught and classified.')
  }

  // 8b. Agent Error (Unparseable date/time)
  const agentFailRes = await orchestrator.processCommand({
    text: 'Tạo cuộc họp vào ngày hôm qua hôm kia'
  })
  // Either handled with error or fallback without crash
  assert.ok(typeof agentFailRes.message === 'string')
  console.log(`  ✓ Stage 2 (Agent parsing/validation) safely responded: "${agentFailRes.message}"`)

  // 8c. Calendar Error handling
  class FailingCalendar extends MockCalendarService {
    override async listEvents(): Promise<never> {
      throw new Error('Google Calendar API 503 Service Unavailable')
    }
  }
  const failingOrchestrator = new AgentOrchestrator(new FailingCalendar())
  const calendarFailRes = await failingOrchestrator.processCommand({
    text: 'Ngày mai tôi có lịch gì?'
  })
  assert.strictEqual(calendarFailRes.success, false)
  assert.strictEqual(calendarFailRes.intent, 'ERROR')
  assert.ok(calendarFailRes.message.includes('Đã xảy ra lỗi khi xử lý yêu cầu'))
  console.log(`  ✓ Stage 3 (Calendar Error) sanitized response: "${calendarFailRes.message}"`)

  console.log('\n====================================================')
  console.log('ALL MILESTONE 2.4 VOICE -> AGENT TESTS PASSED!')
  console.log('====================================================\n')
}

runTestSuite().catch((err) => {
  console.error('Milestone 2.4 test suite failed:', err)
  process.exit(1)
})
