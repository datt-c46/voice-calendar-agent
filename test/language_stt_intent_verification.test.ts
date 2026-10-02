import assert from 'node:assert'
import { AgentOrchestrator } from '../src/main/agent/agentOrchestrator'
import { DateTimeService } from '../src/main/agent/dateTimeService'
import { RuleBasedIntentExtractor } from '../src/main/agent/ruleBasedExtractor'
import { MockCalendarService } from '../src/main/calendar/mockCalendarService'
import { MockSpeechToTextProvider } from '../src/main/voice/stt/mockSttProvider'
import { encodeWav } from '../src/renderer/src/utils/audioEncoder'

console.log('====================================================')
console.log('STARTING MULTI-LINGUAL STT & AGENT VERIFICATION SUITE')
console.log('====================================================\n')

async function runTestSuite(): Promise<void> {
  const dateTimeService = new DateTimeService('Asia/Bangkok')
  const extractor = new RuleBasedIntentExtractor(dateTimeService)
  const mockCalendar = new MockCalendarService()
  const orchestrator = new AgentOrchestrator(mockCalendar)
  const mockSTT = new MockSpeechToTextProvider()

  const sampleRate = 16000
  const simulatedSpeech = new Float32Array(sampleRate * 1)
  for (let i = 0; i < simulatedSpeech.length; i++) {
    simulatedSpeech[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5
  }
  const wavBuffer = encodeWav(simulatedSpeech, sampleRate)
  const base64Audio = Buffer.from(wavBuffer).toString('base64')

  // SECTION 1: VIETNAMESE TEST MATRIX
  console.log('--- SECTION 1: VIETNAMESE TEST MATRIX ---')

  // VI-1: LIST_EVENTS
  console.log('\n[VI-1] Vietnamese LIST: "Ngày mai tôi có lịch gì?"')
  const viListExtracted = extractor.extract('Ngày mai tôi có lịch gì?')
  assert.strictEqual(viListExtracted.type, 'LIST_EVENTS')
  assert.strictEqual(viListExtracted.language, 'vi')
  assert.ok(viListExtracted.startDateTime, 'startDateTime must be present')
  assert.ok(viListExtracted.endDateTime, 'endDateTime must be present')
  const viListRes = await orchestrator.processCommand({ text: 'Ngày mai tôi có lịch gì?' })
  assert.strictEqual(viListRes.success, true)
  assert.strictEqual(viListRes.intent, 'LIST_EVENTS')
  assert.ok(
    viListRes.message.includes('Bạn') || viListRes.message.includes('lịch trình'),
    `Expected Vietnamese response, got: ${viListRes.message}`
  )
  console.log(
    `  ✓ Raw: "Ngày mai tôi có lịch gì?" -> Intent: ${viListExtracted.type}, Lang: ${viListExtracted.language}`
  )
  console.log(`  ✓ Response: "${viListRes.message}"`)

  // VI-2: CREATE_EVENT
  console.log('\n[VI-2] Vietnamese CREATE: "Chiều mai lúc 3 giờ họp với A"')
  const viCreateExtracted = extractor.extract('Chiều mai lúc 3 giờ họp với A')
  assert.strictEqual(viCreateExtracted.type, 'CREATE_EVENT')
  assert.strictEqual(viCreateExtracted.language, 'vi')
  assert.strictEqual(viCreateExtracted.summary, 'Họp với A')
  assert.ok(
    viCreateExtracted.startDateTime?.includes('15:00:00.000+07:00'),
    `Expected 15:00+07:00, got ${viCreateExtracted.startDateTime}`
  )
  const viCreateRes = await orchestrator.processCommand({ text: 'Chiều mai lúc 3 giờ họp với A' })
  assert.strictEqual(viCreateRes.success, true)
  assert.strictEqual(viCreateRes.intent, 'CREATE_EVENT')
  assert.ok(
    viCreateRes.message.includes('Đã lên lịch thành công'),
    `Expected Vietnamese response, got: ${viCreateRes.message}`
  )
  console.log(
    `  ✓ Extracted Title: "${viCreateExtracted.summary}", Start: ${viCreateExtracted.startDateTime}`
  )
  console.log(`  ✓ Response: "${viCreateRes.message}"`)

  // VI-3: UPDATE_EVENT
  console.log('\n[VI-3] Vietnamese UPDATE: "Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ"')
  const viUpdateExtracted = extractor.extract('Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ')
  assert.strictEqual(viUpdateExtracted.type, 'UPDATE_EVENT')
  assert.strictEqual(viUpdateExtracted.language, 'vi')
  assert.ok(viUpdateExtracted.startDateTime?.includes('15:00:00.000+07:00'))
  assert.ok(viUpdateExtracted.newStartDateTime?.includes('16:00:00.000+07:00'))
  const viUpdateRes = await orchestrator.processCommand({
    text: 'Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ'
  })
  assert.strictEqual(viUpdateRes.success, true)
  assert.strictEqual(viUpdateRes.intent, 'UPDATE_EVENT')
  assert.ok(
    viUpdateRes.message.includes('Đã cập nhật sự kiện'),
    `Expected Vietnamese response, got: ${viUpdateRes.message}`
  )
  console.log(
    `  ✓ Rescheduled from: ${viUpdateExtracted.startDateTime} to: ${viUpdateExtracted.newStartDateTime}`
  )
  console.log(`  ✓ Response: "${viUpdateRes.message}"`)

  // VI-4: DELETE_EVENT
  console.log('\n[VI-4] Vietnamese DELETE: "Xóa cuộc họp lúc 4 giờ chiều ngày mai"')
  const viDeleteExtracted = extractor.extract('Xóa cuộc họp lúc 4 giờ chiều ngày mai')
  assert.strictEqual(viDeleteExtracted.type, 'DELETE_EVENT')
  assert.strictEqual(viDeleteExtracted.language, 'vi')
  assert.ok(viDeleteExtracted.startDateTime?.includes('16:00:00.000+07:00'))
  const viDeleteRes = await orchestrator.processCommand({
    text: 'Xóa cuộc họp lúc 4 giờ chiều ngày mai'
  })
  assert.strictEqual(viDeleteRes.success, true)
  assert.strictEqual(viDeleteRes.intent, 'DELETE_EVENT')
  assert.ok(
    viDeleteRes.message.includes('Đã xóa sự kiện'),
    `Expected Vietnamese response, got: ${viDeleteRes.message}`
  )
  console.log(`  ✓ Deleted target time: ${viDeleteExtracted.startDateTime}`)
  console.log(`  ✓ Response: "${viDeleteRes.message}"`)

  // SECTION 2: ENGLISH TEST MATRIX
  console.log('\n--- SECTION 2: ENGLISH TEST MATRIX ---')

  // EN-1: LIST_EVENTS
  console.log('\n[EN-1] English LIST: "What do I have tomorrow?"')
  const enListExtracted = extractor.extract('What do I have tomorrow?')
  assert.strictEqual(enListExtracted.type, 'LIST_EVENTS')
  assert.strictEqual(enListExtracted.language, 'en')
  assert.ok(enListExtracted.startDateTime, 'startDateTime must be present')
  assert.ok(enListExtracted.endDateTime, 'endDateTime must be present')
  const enListRes = await orchestrator.processCommand({ text: 'What do I have tomorrow?' })
  assert.strictEqual(enListRes.success, true)
  assert.strictEqual(enListRes.intent, 'LIST_EVENTS')
  assert.ok(
    enListRes.message.includes('You have') || enListRes.message.includes('scheduled'),
    `Expected English response, got: ${enListRes.message}`
  )
  console.log(
    `  ✓ Raw: "What do I have tomorrow?" -> Intent: ${enListExtracted.type}, Lang: ${enListExtracted.language}`
  )
  console.log(`  ✓ Response: "${enListRes.message}"`)

  // EN-2: CREATE_EVENT
  console.log('\n[EN-2] English CREATE: "Create a meeting with A tomorrow at 3 PM"')
  const enCreateExtracted = extractor.extract('Create a meeting with A tomorrow at 3 PM')
  assert.strictEqual(enCreateExtracted.type, 'CREATE_EVENT')
  assert.strictEqual(enCreateExtracted.language, 'en')
  assert.strictEqual(enCreateExtracted.summary, 'Meeting with A')
  assert.ok(
    enCreateExtracted.startDateTime?.includes('15:00:00.000+07:00'),
    `Expected 15:00+07:00, got ${enCreateExtracted.startDateTime}`
  )
  const enCreateRes = await orchestrator.processCommand({
    text: 'Create a meeting with A tomorrow at 3 PM'
  })
  assert.strictEqual(enCreateRes.success, true)
  assert.strictEqual(enCreateRes.intent, 'CREATE_EVENT')
  assert.ok(
    enCreateRes.message.includes('Successfully scheduled'),
    `Expected English response, got: ${enCreateRes.message}`
  )
  console.log(
    `  ✓ Extracted Title: "${enCreateExtracted.summary}", Start: ${enCreateExtracted.startDateTime}`
  )
  console.log(`  ✓ Response: "${enCreateRes.message}"`)

  // EN-3: UPDATE_EVENT
  console.log('\n[EN-3] English UPDATE: "Move tomorrow\'s 3 PM meeting to 4 PM"')
  const enUpdateExtracted = extractor.extract("Move tomorrow's 3 PM meeting to 4 PM")
  assert.strictEqual(enUpdateExtracted.type, 'UPDATE_EVENT')
  assert.strictEqual(enUpdateExtracted.language, 'en')
  assert.ok(enUpdateExtracted.startDateTime?.includes('15:00:00.000+07:00'))
  assert.ok(enUpdateExtracted.newStartDateTime?.includes('16:00:00.000+07:00'))
  const enUpdateRes = await orchestrator.processCommand({
    text: "Move tomorrow's 3 PM meeting to 4 PM"
  })
  assert.strictEqual(enUpdateRes.success, true)
  assert.strictEqual(enUpdateRes.intent, 'UPDATE_EVENT')
  assert.ok(
    enUpdateRes.message.includes('Successfully rescheduled'),
    `Expected English response, got: ${enUpdateRes.message}`
  )
  console.log(
    `  ✓ Rescheduled from: ${enUpdateExtracted.startDateTime} to: ${enUpdateExtracted.newStartDateTime}`
  )
  console.log(`  ✓ Response: "${enUpdateRes.message}"`)

  // EN-4: DELETE_EVENT
  console.log('\n[EN-4] English DELETE: "Delete tomorrow\'s 4 PM meeting"')
  const enDeleteExtracted = extractor.extract("Delete tomorrow's 4 PM meeting")
  assert.strictEqual(enDeleteExtracted.type, 'DELETE_EVENT')
  assert.strictEqual(enDeleteExtracted.language, 'en')
  assert.ok(enDeleteExtracted.startDateTime?.includes('16:00:00.000+07:00'))
  const enDeleteRes = await orchestrator.processCommand({ text: "Delete tomorrow's 4 PM meeting" })
  assert.strictEqual(enDeleteRes.success, true)
  assert.strictEqual(enDeleteRes.intent, 'DELETE_EVENT')
  assert.ok(
    enDeleteRes.message.includes('Deleted event'),
    `Expected English response, got: ${enDeleteRes.message}`
  )
  console.log(`  ✓ Deleted target time: ${enDeleteExtracted.startDateTime}`)
  console.log(`  ✓ Response: "${enDeleteRes.message}"`)

  // SECTION 3: VOICE INPUT PIPELINE VERIFICATION (STT -> Agent)
  console.log('\n--- SECTION 3: VOICE PIPELINE VERIFICATION (STT -> AGENT) ---')

  // Voice 1: Vietnamese Create
  mockSTT.setMockResponses(['Chiều mai lúc 3 giờ họp với A'])
  const vStt1 = await mockSTT.transcribe({ base64: base64Audio, durationMs: 900 })
  assert.strictEqual(vStt1.text, 'Chiều mai lúc 3 giờ họp với A')
  assert.strictEqual(vStt1.language, 'vi')
  const vAgent1 = await orchestrator.processCommand({ text: vStt1.text })
  assert.strictEqual(vAgent1.success, true)
  assert.strictEqual(vAgent1.intent, 'CREATE_EVENT')
  assert.ok(vAgent1.message.includes('Đã lên lịch thành công'))
  console.log(`  ✓ Voice VI CREATE: "${vStt1.text}" -> ${vAgent1.intent} (VI Response)`)

  // Voice 2: Vietnamese List
  mockSTT.setMockResponses(['Ngày mai tôi có lịch gì?'])
  const vStt2 = await mockSTT.transcribe({ base64: base64Audio, durationMs: 800 })
  assert.strictEqual(vStt2.text, 'Ngày mai tôi có lịch gì?')
  assert.strictEqual(vStt2.language, 'vi')
  const vAgent2 = await orchestrator.processCommand({ text: vStt2.text })
  assert.strictEqual(vAgent2.success, true)
  assert.strictEqual(vAgent2.intent, 'LIST_EVENTS')
  assert.ok(vAgent2.message.includes('Bạn'))
  console.log(`  ✓ Voice VI LIST: "${vStt2.text}" -> ${vAgent2.intent} (VI Response)`)

  // Voice 3: English Create
  mockSTT.setMockResponses(['Create a meeting with A tomorrow at 3 PM'])
  const vStt3 = await mockSTT.transcribe({ base64: base64Audio, durationMs: 950 })
  assert.strictEqual(vStt3.text, 'Create a meeting with A tomorrow at 3 PM')
  assert.strictEqual(vStt3.language, 'en')
  const vAgent3 = await orchestrator.processCommand({ text: vStt3.text })
  assert.strictEqual(vAgent3.success, true)
  assert.strictEqual(vAgent3.intent, 'CREATE_EVENT')
  assert.ok(vAgent3.message.includes('Successfully scheduled'))
  console.log(`  ✓ Voice EN CREATE: "${vStt3.text}" -> ${vAgent3.intent} (EN Response)`)

  // Voice 4: English List
  mockSTT.setMockResponses(['What do I have tomorrow?'])
  const vStt4 = await mockSTT.transcribe({ base64: base64Audio, durationMs: 850 })
  assert.strictEqual(vStt4.text, 'What do I have tomorrow?')
  assert.strictEqual(vStt4.language, 'en')
  const vAgent4 = await orchestrator.processCommand({ text: vStt4.text })
  assert.strictEqual(vAgent4.success, true)
  assert.strictEqual(vAgent4.intent, 'LIST_EVENTS')
  assert.ok(vAgent4.message.includes('You have'))
  console.log(`  ✓ Voice EN LIST: "${vStt4.text}" -> ${vAgent4.intent} (EN Response)`)

  console.log('\n====================================================')
  console.log('ALL MULTI-LINGUAL STT & AGENT TESTS PASSED!')
  console.log('====================================================\n')
}

runTestSuite().catch((err) => {
  console.error('Multi-lingual verification failed:', err)
  process.exit(1)
})
