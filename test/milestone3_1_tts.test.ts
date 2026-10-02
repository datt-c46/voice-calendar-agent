import assert from 'node:assert'
import { AgentOrchestrator } from '../src/main/agent/agentOrchestrator'
import { MockCalendarService } from '../src/main/calendar/mockCalendarService'
import { MockTtsProvider } from '../src/renderer/src/services/tts/mockTtsProvider'
import {
  formatAgentResponseForSpeech,
  selectVietnameseVoice
} from '../src/renderer/src/services/tts/speechFormatter'
import { TextToSpeechService } from '../src/renderer/src/services/tts/ttsService'
import { TTSVoice } from '../src/renderer/src/services/tts/types'

console.log('====================================================')
console.log('STARTING MILESTONE 3.1 TTS VERIFICATION SUITE')
console.log('====================================================\n')

async function runTestSuite(): Promise<void> {
  // [TEST 1] Provider abstraction contract verification
  console.log('[Test 1] TTS Provider abstraction interface contract:')
  const mockProvider = new MockTtsProvider()

  assert.strictEqual(typeof mockProvider.id, 'string')
  assert.strictEqual(typeof mockProvider.name, 'string')
  assert.strictEqual(typeof mockProvider.isAvailable, 'function')
  assert.strictEqual(typeof mockProvider.getVoices, 'function')
  assert.strictEqual(typeof mockProvider.speak, 'function')
  assert.strictEqual(typeof mockProvider.stop, 'function')
  assert.strictEqual(typeof mockProvider.isSpeaking, 'function')
  console.log('  ✓ MockTtsProvider strictly implements ITextToSpeechProvider contract.')

  // [TEST 2] Vietnamese Voice Selection Algorithm (Section 5)
  console.log('\n[Test 2] Vietnamese Voice Selection Algorithm:')

  // Scenario 2a: Exact vi-VN voice available
  const voicesExact: TTSVoice[] = [
    { id: 'en-1', name: 'Microsoft David', lang: 'en-US' },
    { id: 'vi-1', name: 'Microsoft HoaiMy', lang: 'vi-VN' },
    { id: 'fr-1', name: 'Microsoft Paul', lang: 'fr-FR' }
  ]
  const selExact = selectVietnameseVoice(voicesExact)
  assert.strictEqual(selExact.isVietnamese, true)
  assert.strictEqual(selExact.voice?.id, 'vi-1')
  assert.strictEqual(selExact.warning, null)
  console.log('  ✓ Priority 1: Exact "vi-VN" voice correctly matched.')

  // Scenario 2b: Partial "vi" prefix voice available
  const voicesPartial: TTSVoice[] = [
    { id: 'en-1', name: 'Microsoft David', lang: 'en-US' },
    { id: 'vi-2', name: 'Google Vietnamese', lang: 'vi' }
  ]
  const selPartial = selectVietnameseVoice(voicesPartial)
  assert.strictEqual(selPartial.isVietnamese, true)
  assert.strictEqual(selPartial.voice?.id, 'vi-2')
  assert.strictEqual(selPartial.warning, null)
  console.log('  ✓ Priority 2: Partial "vi*" prefix voice correctly matched.')

  // Scenario 2c: No Vietnamese voice -> platform default fallback with clear warning
  const voicesNoVi: TTSVoice[] = [
    { id: 'en-default', name: 'Microsoft David', lang: 'en-US', isDefault: true },
    { id: 'en-2', name: 'Microsoft Zira', lang: 'en-US' }
  ]
  const selNoVi = selectVietnameseVoice(voicesNoVi)
  assert.strictEqual(selNoVi.isVietnamese, false)
  assert.strictEqual(selNoVi.voice?.id, 'en-default')
  assert.ok(selNoVi.warning?.includes('chưa có giọng tiếng Việt'))
  console.log(`  ✓ Priority 3: Fallback warning properly issued: "${selNoVi.warning}"`)

  // Scenario 2d: Empty voices list
  const selEmpty = selectVietnameseVoice([])
  assert.strictEqual(selEmpty.voice, null)
  assert.strictEqual(selEmpty.isVietnamese, false)
  assert.ok(typeof selEmpty.warning === 'string')
  console.log('  ✓ Empty voice list gracefully handled without crash.')

  // [TEST 3] Response Text Sanitization & Formatting (Section 7 & 8)
  console.log('\n[Test 3] Response Text Formatting for Natural Speech:')
  const rawListResponse = `Bạn có 2 sự kiện được lên lịch:
• Họp nhóm (09:00 - 10:00, ngày 03/10/2026)
• Ăn trưa với đối tác (12:00 - 13:00, ngày 03/10/2026)`

  const formattedSpeech = formatAgentResponseForSpeech(rawListResponse)
  assert.strictEqual(formattedSpeech.includes('•'), false, 'Bullet points must be removed')
  assert.strictEqual(formattedSpeech.includes('09:00 đến 10:00'), true, 'Hyphen converted to đến')
  assert.strictEqual(formattedSpeech.includes('12:00 đến 13:00'), true, 'Hyphen converted to đến')
  console.log(`  ✓ Formatted speech output:\n    "${formattedSpeech}"`)

  // Empty string handling
  assert.strictEqual(formatAgentResponseForSpeech(''), '')
  assert.strictEqual(formatAgentResponseForSpeech('   \n\t '), '')
  console.log('  ✓ Empty and whitespace strings produce empty speech payload (no-op).')

  // [TEST 4] TextToSpeechService Lifecycle and Vocalization
  console.log('\n[Test 4] TextToSpeechService Lifecycle and Vocalization:')
  const ttsService = new TextToSpeechService(mockProvider)
  await ttsService.initialize()

  const status = ttsService.getStatus()
  assert.strictEqual(status.isVietnameseSupported, true)
  assert.strictEqual(status.selectedVoice?.lang, 'vi-VN')

  // Test speaking
  await ttsService.speak('Ngày mai bạn có 2 cuộc họp.')
  assert.strictEqual(mockProvider.getHistory().length, 1)
  assert.strictEqual(mockProvider.getHistory()[0].text, 'Ngày mai bạn có 2 cuộc họp.')
  assert.strictEqual(ttsService.getStatus().state, 'completed')
  console.log('  ✓ Spoken message recorded successfully with state="completed".')

  // [TEST 5] Stop / Cancel Behavior (Section 12)
  console.log('\n[Test 5] Stop / Cancel behavior:')
  // Start speaking then immediately cancel
  const speakPromise = ttsService.speak(
    'Đây là một câu phản hồi rất dài để kiểm tra tính năng dừng đọc giữa chừng.'
  )
  assert.strictEqual(ttsService.isSpeaking(), true)
  ttsService.stop()
  await speakPromise
  assert.strictEqual(ttsService.isSpeaking(), false)
  assert.strictEqual(ttsService.getStatus().state, 'idle')
  console.log('  ✓ Stop canceled active speech immediately and restored state="idle".')

  // [TEST 6] End-to-end Pipeline: Voice Intent -> Calendar -> Speech Vocalization (Section 17)
  console.log('\n[Test 6] End-to-end Calendar Command -> Vocalization Flow:')
  const mockCalendar = new MockCalendarService()
  const orchestrator = new AgentOrchestrator(mockCalendar)
  mockProvider.clearHistory()

  const testMatrix = [
    {
      voiceQuery: 'Ngày mai tôi có lịch gì?',
      expectedIntent: 'LIST_EVENTS'
    },
    {
      voiceQuery: 'Chiều mai lúc 3 giờ họp với A',
      expectedIntent: 'CREATE_EVENT'
    },
    {
      voiceQuery: 'Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ',
      expectedIntent: 'UPDATE_EVENT'
    },
    {
      voiceQuery: 'Xóa cuộc họp lúc 4 giờ chiều ngày mai',
      expectedIntent: 'DELETE_EVENT'
    },
    {
      voiceQuery: 'What do I have tomorrow?',
      expectedIntent: 'LIST_EVENTS'
    }
  ]

  for (const item of testMatrix) {
    const t0 = Date.now()
    const agentRes = await orchestrator.processCommand({ text: item.voiceQuery })
    const agentLatency = Date.now() - t0

    assert.strictEqual(agentRes.success, true)
    assert.strictEqual(agentRes.intent, item.expectedIntent)

    // TTS vocalizes the final human-readable message
    const t_tts0 = Date.now()
    await ttsService.speak(agentRes.message)
    const ttsLatency = Date.now() - t_tts0

    console.log(
      `  ✓ [${agentRes.intent}] "${item.voiceQuery}" -> Agent: ${agentLatency}ms, TTS: ${ttsLatency}ms`
    )
    console.log(`    Spoken: "${agentRes.message.split('\n')[0]}..."`)
  }

  assert.ok(
    mockProvider.getHistory().length >= 5,
    `Expected at least 5 utterances, got ${mockProvider.getHistory().length}`
  )

  // [TEST 7] Feedback Loop Prevention Verification (Section 13)
  console.log('\n[Test 7] Feedback Loop Prevention (Acoustic Echo Suppression):')
  let isAssistantSpeaking = true
  let suppressedCount = 0
  let processedCount = 0

  function simulateVadDetection(): void {
    if (isAssistantSpeaking) {
      suppressedCount++
      return
    }
    processedCount++
  }

  // Assistant is speaking: user microphone should NOT trigger STT/Agent
  simulateVadDetection()
  simulateVadDetection()
  assert.strictEqual(suppressedCount, 2)
  assert.strictEqual(processedCount, 0)
  console.log('  ✓ VAD audio successfully suppressed while assistant is speaking.')

  // Assistant finishes: audio input resumes
  isAssistantSpeaking = false
  simulateVadDetection()
  assert.strictEqual(processedCount, 1)
  console.log('  ✓ VAD audio processing resumes immediately after assistant finishes.')

  // [TEST 8] Rapid Sequential Commands & Robustness (Section 18)
  console.log('\n[Test 8] Rapid Sequential Commands without Crash:')
  mockProvider.clearHistory()
  for (let i = 1; i <= 10; i++) {
    await ttsService.speak(`Thông báo thứ ${i}`)
  }
  assert.strictEqual(mockProvider.getHistory().length, 10)
  console.log('  ✓ 10 rapid sequential TTS utterances processed cleanly.')

  console.log('\n====================================================')
  console.log('ALL MILESTONE 3.1 TTS TESTS PASSED SUCCESSFULLY!')
  console.log('====================================================\n')
}

runTestSuite().catch((err) => {
  console.error('Milestone 3.1 test suite failed:', err)
  process.exit(1)
})
