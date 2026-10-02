import { PiperTtsManager } from '../src/main/voice/tts/piperManager'
import { PiperTtsProvider } from '../src/renderer/src/services/tts/piperProvider'
import { TextToSpeechService } from '../src/renderer/src/services/tts/ttsService'
import { MockTtsProvider } from '../src/renderer/src/services/tts/mockTtsProvider'
import { ITextToSpeechProvider } from '../src/renderer/src/services/tts/ITextToSpeechProvider'

// Colors for console assertions
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`${RED}Assertion Failed:${RESET} ${message}`)
    throw new Error(`Assertion failed: ${message}`)
  }
  console.log(`  ${GREEN}✓${RESET} ${message}`)
}

async function runPiperTtsTests(): Promise<void> {
  console.log(`\n${CYAN}====================================================${RESET}`)
  console.log(`${CYAN}   RUNNING PIPER TTS INTEGRATION TEST SUITE        ${RESET}`)
  console.log(`${CYAN}====================================================\n${RESET}`)

  // ----------------------------------------------------
  // Test 1: PiperTtsManager Initialization & Discovery
  // ----------------------------------------------------
  console.log(`${CYAN}[Test 1] PiperTtsManager discovery & status verification:${RESET}`)
  const piperManager = new PiperTtsManager()
  await piperManager.initialize()

  const status = piperManager.getStatus()
  assert(typeof status.isAvailable === 'boolean', 'status.isAvailable is a boolean')
  assert(Array.isArray(status.voices), 'status.voices is an array')
  assert(status.voices.length > 0, `Discovered ${status.voices.length} voice model(s)`)

  const viVoice = status.voices.find((v) => v.lang.startsWith('vi') || v.id.includes('vi_VN'))
  assert(viVoice !== undefined, `Found Vietnamese voice model: ${viVoice?.name || 'none'}`)
  console.log(`  Active Voice: ${status.activeVoiceName} (${status.activeVoiceId})`)

  // ----------------------------------------------------
  // Test 2: Piper Synthesis with various options
  // ----------------------------------------------------
  console.log(`\n${CYAN}[Test 2] Piper speech synthesis execution:${RESET}`)
  const testPhrase = 'Xin chào, bạn có cuộc họp vào lúc 3 giờ chiều mai.'
  const synthResult = await piperManager.synthesize({
    text: testPhrase,
    voiceId: viVoice?.id,
    rate: 1.1,
    pitch: 1.0,
    volume: 1.0
  })

  assert(typeof synthResult.audioBase64 === 'string', 'audioBase64 is returned as string')
  assert(synthResult.audioBase64.length > 100, `Audio payload size: ${synthResult.audioBase64.length} chars`)
  assert(synthResult.mimeType === 'audio/wav', 'mimeType is audio/wav')
  assert(synthResult.sampleRate > 0, `sampleRate: ${synthResult.sampleRate} Hz`)
  assert(synthResult.durationMs >= 0, `Synthesis latency: ${synthResult.durationMs}ms`)

  // ----------------------------------------------------
  // Test 3: PiperTtsProvider implements ITextToSpeechProvider
  // ----------------------------------------------------
  console.log(`\n${CYAN}[Test 3] PiperTtsProvider interface contract:${RESET}`)
  const piperProvider: ITextToSpeechProvider = new PiperTtsProvider()

  assert(piperProvider.id === 'piper-tts', `Provider ID is "piper-tts"`)
  assert(piperProvider.name.includes('Piper'), `Provider Name contains "Piper"`)

  const voices = await piperProvider.getVoices()
  assert(voices.length > 0, `Provider returned ${voices.length} voice(s)`)
  assert(typeof piperProvider.isSpeaking() === 'boolean', 'isSpeaking() returns boolean')

  // ----------------------------------------------------
  // Test 4: Provider speak() and lifecycle
  // ----------------------------------------------------
  console.log(`\n${CYAN}[Test 4] PiperTtsProvider speak() & lifecycle events:${RESET}`)
  let startCalled = false
  let endCalled = false

  await piperProvider.speak('Cuộc họp đã được lên lịch thành công.', {
    onStart: () => {
      startCalled = true
    },
    onEnd: () => {
      endCalled = true
    }
  })

  assert(startCalled, 'onStart callback was fired')
  assert(endCalled, 'onEnd callback was fired')
  assert(!piperProvider.isSpeaking(), 'isSpeaking is false after speech completion')

  // ----------------------------------------------------
  // Test 5: Integration with TextToSpeechService
  // ----------------------------------------------------
  console.log(`\n${CYAN}[Test 5] TextToSpeechService coordination with Piper:${RESET}`)
  const ttsService = new TextToSpeechService(piperProvider)
  await ttsService.initialize()

  const serviceStatus = ttsService.getStatus()
  assert(serviceStatus.providerId === 'piper-tts', 'Service is using piper-tts provider')
  assert(serviceStatus.isVietnameseSupported, 'Vietnamese language is supported by Piper')

  await ttsService.speak('Bạn có 1 sự kiện: Họp dự án lúc 10:00 ngày mai.')
  assert(!ttsService.isSpeaking(), 'Service completed speech cleanly')

  // ----------------------------------------------------
  // Test 6: Switching between Providers dynamically
  // ----------------------------------------------------
  console.log(`\n${CYAN}[Test 6] Dynamic switching between Piper, WebSpeech, and Mock providers:${RESET}`)
  const mockProvider = new MockTtsProvider()
  ttsService.setProvider(mockProvider)
  await ttsService.initialize()

  assert(ttsService.getProvider().id === 'mock-tts', 'Switched to mock-tts provider')

  ttsService.setProvider(piperProvider)
  await ttsService.initialize()
  assert(ttsService.getProvider().id === 'piper-tts', 'Switched back to piper-tts provider')

  // ----------------------------------------------------
  // Test 7: Stop & Cancellation handling
  // ----------------------------------------------------
  console.log(`\n${CYAN}[Test 7] Immediate cancellation during Piper playback:${RESET}`)
  const longText = 'Đây là một câu rất dài nhằm kiểm tra tính năng dừng đọc ngay lập tức khi người dùng yêu cầu.'
  const speakPromise = ttsService.speak(longText)
  
  // Call stop immediately
  ttsService.stop()
  await speakPromise

  assert(!ttsService.isSpeaking(), 'ttsService.isSpeaking() is false immediately after stop()')

  console.log(`\n${GREEN}====================================================${RESET}`)
  console.log(`${GREEN}   ALL PIPER TTS INTEGRATION TESTS PASSED 100%!     ${RESET}`)
  console.log(`${GREEN}====================================================\n${RESET}`)
}

void runPiperTtsTests()
