/**
 * End-to-end through the real Electron UI: renderer → preload → IPC → main → real voice-backend.
 * The microphone is Chromium's fake capture device playing a real speech recording, so the whole voice pipeline
 * (VAD → WAV → /voice/transcribe → Gemini fake → agent → TTS) runs. Needs a display (skipped otherwise).
 * Run: pnpm test:e2e
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, afterEach, before, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { startE2EBackend, type E2EBackend } from './backendHarness'
import { launchApp, type ElectronApp } from './electronApp'

const APP_DIR = resolve(__dirname, '../..')
const SPEECH_WAV = process.env['E2E_SPEECH_WAV'] ?? '/usr/share/sounds/alsa/Front_Center.wav'
const hasDisplay =
  process.platform !== 'linux' || !!process.env['DISPLAY'] || !!process.env['WAYLAND_DISPLAY']

describe(
  'Electron app end-to-end (GUI)',
  { skip: hasDisplay ? false : 'no display', timeout: 300_000 },
  () => {
    let backend: E2EBackend
    let app: ElectronApp
    const work = mkdtempSync(join(tmpdir(), 'vca-gui-e2e-'))
    const configHome = join(work, 'config')
    const email = `gui-${randomUUID().slice(0, 8)}@example.com`
    const sessionFile = join(configHome, 'voice-calendar-agent', 'backend-session.bin')
    let failures = 0

    const launch = (): Promise<ElectronApp> =>
      launchApp({
        appDir: APP_DIR,
        configHome,
        env: { VOICE_BACKEND_URL: backend.url, VOICE_BACKEND_DEV_EMAIL: email },
        ...(existsSync(SPEECH_WAV) ? { fakeMicWav: SPEECH_WAV } : {})
      })

    /** Waits until a new assistant answer (not the "processing" placeholder) is shown, and returns it. */
    const waitAnswer = async (
      before: number,
      label: string
    ): Promise<{ text: string; intent: string }> => {
      await app.waitFor(
        `[...document.querySelectorAll('.chat-message.assistant')].filter((x) => !x.innerText.startsWith('Đang phân tích')).length > ${before} && !document.body.innerText.includes('Đang phân tích')`,
        label,
        30_000
      )
      return app.lastAssistant()
    }

    /** Types a command and returns the assistant answer it produced. */
    const ask = async (text: string): Promise<{ text: string; intent: string }> => {
      const before = await app.assistantCount()
      await app.typeCommand(text)
      return waitAnswer(before, `answer to "${text}"`)
    }

    /** Clicks a confirm/cancel button and returns the answer. */
    const click = async (label: string): Promise<{ text: string; intent: string }> => {
      const before = await app.assistantCount()
      await app.clickButton(label)
      return waitAnswer(before, `answer to "${label}"`)
    }

    const pendingButtons = (): Promise<number> =>
      app.evaluate<number>(`document.querySelectorAll('.pending-btn').length`)

    before(async () => {
      await promisify(execFile)('npx', ['electron-vite', 'build'], {
        cwd: APP_DIR,
        timeout: 240_000
      })
      backend = await startE2EBackend()
      app = await launch()
    })

    afterEach(async (t) => {
      // node:test passes the finished test context; keep a screenshot of the first failures for debugging.
      const ctx = t as unknown as { passed?: boolean; name: string }
      if (ctx.passed === false && failures++ < 3) {
        const file = join(work, `failure-${failures}.png`)
        await app?.screenshot(file).catch(() => undefined)
        console.error(`screenshot: ${file}\nrenderer logs:\n${app?.logs.slice(-20).join('\n')}`)
      }
    })

    after(async () => {
      await app?.close()
      await backend?.stop()
      if (failures === 0) rmSync(work, { recursive: true, force: true })
    })

    it('starts signed out with commands and microphone disabled', async () => {
      await app.waitFor(
        `document.body.innerText.includes('Đăng nhập bằng Google')`,
        'sign-in button'
      )
      assert.equal(await app.evaluate(`document.querySelector('.command-input').disabled`), true)
      assert.equal(await app.evaluate(`document.querySelector('.mic-btn-start').disabled`), true)
      assert.match(await app.text(), /voice-backend • http:\/\/127\.0\.0\.1:\d+/i) // CSS upper-cases it
    })

    it('signs in with the dev login', async () => {
      await app.clickButton('Đăng nhập dev')
      await app.waitFor(
        `document.body.innerText.includes(${JSON.stringify(email)}) && document.body.innerText.includes('LỊCH LOCAL')`,
        'signed-in header'
      )
      assert.equal(await app.evaluate(`document.querySelector('.command-input').disabled`), false)
      assert.equal(await app.evaluate(`document.querySelector('.mic-btn-start').disabled`), false)
      assert.match((await app.lastAssistant()).text, /Đã đăng nhập/)
      assert.match(await app.text(), /Asia\/Bangkok/)
    })

    it('creates an event from a typed command and reads the answer with the server voice', async () => {
      const ttsBefore = backend.count('POST', '/api/v1/tts/synthesize')
      const answer = await ask('Tạo lịch họp nhóm ngày mai lúc 9 giờ')
      assert.equal(answer.intent, 'CREATE_EVENT')
      assert.match(answer.text, /Đã tạo lịch "Họp nhóm"/)
      assert.match(answer.text, /09:00 • \d{2}\/\d{2}\/\d{4}/) // event card in the user's zone
      const deadline = Date.now() + 10_000
      while (
        backend.count('POST', '/api/v1/tts/synthesize') === ttsBefore &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 200))
      }
      assert.ok(
        backend.count('POST', '/api/v1/tts/synthesize') > ttsBefore,
        'TTS went through voice-backend'
      )
    })

    it('deletes after clicking "Xác nhận"', async () => {
      const question = await ask('Xóa họp nhóm ngày mai')
      assert.equal(question.intent, 'DELETE_EVENT')
      assert.equal(await pendingButtons(), 2)
      const done = await click('Xác nhận')
      assert.match(done.text, /Đã xóa lịch "Họp nhóm"/)
      assert.equal(await pendingButtons(), 0)
    })

    it('keeps the event after clicking "Hủy"', async () => {
      assert.equal((await ask('Tạo lịch ăn trưa ngày mai lúc 12 giờ')).intent, 'CREATE_EVENT')
      await ask('Xóa lịch ăn trưa ngày mai')
      assert.equal((await click('Hủy')).intent, 'REJECT_ACTION')
      assert.equal(await pendingButtons(), 0)
      assert.match((await ask('Ngày mai tôi có lịch gì?')).text, /Ăn trưa/)
    })

    it('answering "có" in the same conversation applies the change and settles the buttons', async () => {
      const question = await ask('Dời lịch ăn trưa ngày mai sang 13 giờ')
      assert.equal(question.intent, 'UPDATE_EVENT', question.text)
      assert.equal(await pendingButtons(), 2)
      const yes = await ask('có')
      assert.equal(yes.intent, 'CONFIRM_ACTION', yes.text)
      assert.equal(await pendingButtons(), 0)
      assert.match((await ask('Ngày mai tôi có lịch gì?')).text, /13:00/)
    })

    it(
      'runs a spoken command end to end (mic → VAD → STT → agent → TTS)',
      { skip: !existsSync(SPEECH_WAV) },
      async () => {
        const transcript = 'Ngày mai tôi có lịch gì'
        backend.gemini.transcripts.push(transcript)
        const sttBefore = backend.count('POST', '/api/v1/voice/transcribe')
        const userMessages = `[...document.querySelectorAll('.chat-message.user')].filter((m) => m.innerText.includes(${JSON.stringify(transcript)})).length`
        const typedBefore = await app.evaluate<number>(userMessages)
        const answersBefore = await app.assistantCount()
        await app.clickButton('Start Listening')
        await app.waitFor(`${userMessages} > ${typedBefore}`, 'spoken command in the chat', 45_000)
        await waitAnswer(answersBefore, 'answer to the spoken command')
        await app.waitFor(`!!document.querySelector('.mic-btn-stop')`, 'Stop Listening button')
        await app.clickButton('Stop Listening')
        const answer = await app.lastAssistant()
        assert.equal(answer.intent, 'LIST_EVENTS', answer.text)
        assert.match(answer.text, /Ăn trưa/)
        assert.ok(backend.count('POST', '/api/v1/voice/transcribe') > sttBefore)
        const audio = backend.gemini.calls.find((c) => c.hasAudio && c.audioBytes > 8_000)
        assert.ok(audio, 'the recorded WAV reached the STT provider')
        assert.equal(audio.audioMimeType, 'audio/wav')
        assert.match(await app.text(), new RegExp(transcript)) // transcription panel
      }
    )

    it('stays signed in when the server rotates its signing key', async () => {
      await backend.restart({ JWT_SECRET: randomUUID() + randomUUID() })
      assert.equal((await ask('Ngày mai tôi có lịch gì?')).intent, 'LIST_EVENTS')
      assert.match(await app.text(), new RegExp(email))
    })

    it('shows a clear error while the server is down, then recovers', async () => {
      await backend.pause()
      const down = await ask('Ngày mai tôi có lịch gì?')
      assert.match(down.text, /Không kết nối được tới server/)
      await backend.restart()
      assert.equal((await ask('Ngày mai tôi có lịch gì?')).intent, 'LIST_EVENTS')
    })

    it('keeps the session across an app restart (OS-encrypted session file)', async (t) => {
      if (!existsSync(sessionFile)) {
        t.skip('safeStorage cannot encrypt on this machine: the session is kept in memory only')
        return
      }
      await app.close()
      app = await launch()
      await app.waitFor(
        `document.body.innerText.includes(${JSON.stringify(email)})`,
        'restored session',
        30_000
      )
      assert.equal((await ask('Ngày mai tôi có lịch gì?')).intent, 'LIST_EVENTS')
    })

    it('returns to the sign-in screen when the account is deleted on another device', async () => {
      const other = await backend.devLogin(email)
      const res = await fetch(`${backend.apiUrl}/me`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${other.accessToken}` }
      })
      assert.equal(res.status, 204)
      await app.typeCommand('Ngày mai tôi có lịch gì?')
      await app.waitFor(
        `document.body.innerText.includes('Đăng nhập bằng Google')`,
        'signed-out header (pushed)'
      )
      assert.equal(await app.evaluate(`document.querySelector('.command-input').disabled`), true)
      assert.equal(existsSync(sessionFile), false)
    })

    it('signs in again and signs out', async () => {
      await app.clickButton('Đăng nhập dev')
      await app.waitFor(`document.body.innerText.includes('Đăng xuất')`, 'signed in')
      await app.clickButton('Đăng xuất')
      await app.waitFor(`document.body.innerText.includes('Đăng nhập bằng Google')`, 'signed out')
      assert.match((await app.lastAssistant()).text, /Đã đăng xuất/)
      assert.equal(existsSync(sessionFile), false)
      assert.equal(
        readdirSync(join(configHome, 'voice-calendar-agent')).includes('auth_tokens.bin'),
        false
      )
    })
  }
)
