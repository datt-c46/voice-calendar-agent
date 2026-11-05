/**
 * End-to-end: every `window.api` feature, through the real main-process code (handlers → BackendClient → HTTP),
 * against a real voice-backend + Postgres started by backendHarness (Gemini replaced by a local fake).
 * Run: pnpm test:e2e
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { createBackendApi } from '../../src/main/backend/api'
import { BackendClient } from '../../src/main/backend/backend-client'
import { resolveBackendConfig } from '../../src/main/backend/config'
import { createIpcHandlers, type IpcHandlers } from '../../src/main/backend/handlers'
import { ApiError } from '../../src/main/backend/http'
import { signInWithGoogle } from '../../src/main/backend/login'
import { MemorySessionStore } from '../../src/main/backend/session-store'
import { parseIpcError } from '../../src/shared/errors'
import type { AgentCommandResult } from '../../src/shared/ipc'
import { chunkTextForTts } from '../../src/renderer/src/services/tts/piperProvider'
import { encodeWav } from '../../src/renderer/src/utils/audioEncoder'
import { FAKE_GOOGLE_CLIENT_ID, startE2EBackend, type E2EBackend } from './backendHarness'

const ZONE = 'Asia/Bangkok'
/** `2026-11-06T09:00:00.000+07:00` → `2026-11-06T09:00:00+07:00` */
const noMillis = (iso: string | undefined): string | undefined =>
  iso?.replace(/\.\d{3}(?=[+-Z])/, '')

const tomorrow = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(Date.now() + 86_400_000))

function speechWav(seconds = 1): string {
  const samples = new Float32Array(16000 * seconds).map(
    (_, i) => Math.sin(i / 8) * 0.3 * Math.sin(i / 4000)
  )
  return Buffer.from(encodeWav(samples, 16000)).toString('base64')
}

async function ipcCall<T>(
  fn: () => Promise<T>
): Promise<{ code: string | undefined; message: string }> {
  try {
    await fn()
  } catch (error) {
    return parseIpcError(error)
  }
  throw new Error('expected the IPC call to fail')
}

describe('voice-backend end-to-end (API)', { timeout: 180_000 }, () => {
  let backend: E2EBackend
  let clock = Date.now()
  const store = new MemorySessionStore()
  let client: BackendClient
  let handlers: IpcHandlers
  let sessionChanges = 0
  const email = `e2e-${randomUUID().slice(0, 8)}@example.com`
  const opened: string[] = []

  const makeClient = (apiUrl: string): BackendClient =>
    new BackendClient({ apiUrl, store, now: () => clock, log: () => undefined })

  const wire = (c: BackendClient): IpcHandlers =>
    createIpcHandlers({
      client: c,
      api: createBackendApi(c),
      config: resolveBackendConfig({
        VOICE_BACKEND_URL: backend.url,
        VOICE_BACKEND_DEV_EMAIL: email
      }),
      // The browser leg needs a real Google account: record the URL, then cancel like a user closing the tab.
      signInWithGoogle: (signal) =>
        signInWithGoogle({
          client: c,
          signal,
          openExternal: async (url) => {
            opened.push(url)
            setTimeout(() => void handlers.cancelSignIn(), 20)
          }
        })
    })

  const command = async (text: string, conversationId?: string): Promise<AgentCommandResult> =>
    handlers.executeCommand({ text, ...(conversationId ? { conversationId } : {}) })

  const eventsTomorrow = async (): Promise<Array<{ summary: string; start: string }>> => {
    const day = tomorrow()
    const items = await handlers.listEvents({
      timeMin: `${day}T00:00:00+07:00`,
      timeMax: `${day}T23:59:59+07:00`
    })
    return items.map((e) => ({ summary: e.summary, start: noMillis(e.start.dateTime) ?? '' }))
  }

  before(async () => {
    backend = await startE2EBackend({ PENDING_ACTION_TTL_SECONDS: '10' })
    client = makeClient(backend.apiUrl)
    client.onSessionChange(() => sessionChanges++)
    handlers = wire(client)
  })
  after(() => backend?.stop())

  describe('signed out', () => {
    it('reports no session and refuses agent / voice features', async () => {
      const status = await handlers.getAuthStatus()
      assert.equal(status.isAuthenticated, false)
      assert.equal(status.devLoginAvailable, true)
      assert.equal(status.backendUrl, backend.url)
      assert.equal((await command('Ngày mai tôi có lịch gì?')).error?.code, 'UNAUTHORIZED')
      assert.equal((await handlers.getPiperStatus()).error, 'UNAUTHORIZED')
      assert.deepEqual(await handlers.getPiperVoices(), [])
      assert.equal((await handlers.getSttStatus()).isCloudAvailable, false)
      assert.equal((await ipcCall(() => handlers.getCalendarStatus())).code, 'UNAUTHORIZED')
    })

    it('Google sign-in sends the browser to Google with the backend callback, and can be cancelled', async () => {
      const status = await handlers.signInWithGoogle()
      assert.equal(status.error, 'SIGN_IN_CANCELLED')
      assert.equal(status.isAuthenticated, false)
      const google = new URL(opened.at(-1) ?? '')
      assert.equal(google.origin, 'https://accounts.google.com')
      assert.equal(google.searchParams.get('client_id'), FAKE_GOOGLE_CLIENT_ID)
      assert.equal(
        google.searchParams.get('redirect_uri'),
        `${backend.apiUrl}/auth/google/callback`
      )
      assert.equal(google.searchParams.get('code_challenge_method'), 'S256')
      assert.ok(google.searchParams.get('state'))
      assert.match(google.searchParams.get('scope') ?? '', /calendar/)
    })
  })

  describe('session', () => {
    it('signs in with the dev login (server-side local calendar)', async () => {
      const status = await handlers.signInDev()
      assert.equal(status.error, undefined, status.errorMessage)
      assert.equal(status.isAuthenticated, true)
      assert.equal(status.userEmail, email)
      assert.equal(status.calendarProvider, 'local')
      assert.equal(status.isConfigured, true)
      assert.equal(sessionChanges, 1)
      const calendar = await handlers.getCalendarStatus()
      assert.equal(calendar.mode, 'local')
      assert.equal(calendar.connected, true)
      assert.equal(calendar.timeZone, ZONE)
    })

    it('restores the stored session in a new client (app restart)', async () => {
      const restarted = makeClient(backend.apiUrl)
      await restarted.init()
      assert.equal(restarted.user?.email, email)
      const r = await wire(restarted).executeCommand({ text: 'Ngày mai tôi có lịch gì?' })
      assert.equal(r.intent, 'LIST_EVENTS', r.message)
    })
  })

  describe('agent', () => {
    let conversationId: string | undefined

    it('creates an event in the user time zone', async () => {
      const r = await command('Tạo lịch họp nhóm ngày mai lúc 9 giờ')
      assert.equal(r.success, true, r.message)
      assert.equal(r.intent, 'CREATE_EVENT')
      assert.equal(noMillis(r.events?.[0]?.start.dateTime), `${tomorrow()}T09:00:00+07:00`)
      assert.equal(r.events?.[0]?.start.timeZone, ZONE)
      assert.equal(r.events?.[0]?.provider, 'local')
      conversationId = r.conversationId
      assert.ok(conversationId)
    })

    it('lists events by voice-style question and through listEvents (query, range)', async () => {
      const r = await command('Ngày mai tôi có lịch gì?', conversationId)
      assert.equal(r.intent, 'LIST_EVENTS')
      assert.equal(r.events?.length, 1)
      assert.equal(r.conversationId, conversationId)
      assert.deepEqual(await eventsTomorrow(), [
        { summary: 'Họp nhóm', start: `${tomorrow()}T09:00:00+07:00` }
      ])
      assert.equal((await handlers.listEvents({ query: 'họp' })).length, 1)
      assert.equal((await handlers.listEvents({ query: 'không-có' })).length, 0)
    })

    it('checks availability (busy and free)', async () => {
      const busy = await command('Kiểm tra xem tôi có rảnh lúc 9 giờ sáng mai không')
      assert.equal(busy.intent, 'CHECK_AVAILABILITY', busy.message)
      assert.match(busy.message, /bận/)
      const free = await command('Chiều mai lúc 3 giờ tôi có rảnh không?')
      assert.equal(free.intent, 'CHECK_AVAILABILITY', free.message)
      assert.match(free.message, /rảnh/)
    })

    it('asks before rescheduling; rejecting keeps the event, "có" applies it', async () => {
      const ask = await command('Dời họp nhóm ngày mai sang 10 giờ', conversationId)
      assert.equal(ask.requiresConfirmation, true, ask.message)
      assert.equal(ask.pendingAction?.type, 'UPDATE_EVENT')
      const rejected = await handlers.rejectAction(ask.pendingAction?.id)
      assert.equal(rejected.intent, 'REJECT_ACTION', rejected.message)
      assert.equal((await eventsTomorrow())[0]?.start, `${tomorrow()}T09:00:00+07:00`)

      const again = await command('Dời họp nhóm ngày mai sang 10 giờ', conversationId)
      assert.equal(again.requiresConfirmation, true, again.message)
      const yes = await command('có', again.conversationId)
      assert.equal(yes.intent, 'CONFIRM_ACTION', yes.message)
      assert.equal(yes.success, true)
      assert.equal((await eventsTomorrow())[0]?.start, `${tomorrow()}T10:00:00+07:00`)
    })

    it('asks before deleting; "không" cancels, the confirm button deletes', async () => {
      const ask = await command('Xóa họp nhóm ngày mai', conversationId)
      assert.equal(ask.pendingAction?.type, 'DELETE_EVENT', ask.message)
      const no = await command('không', ask.conversationId)
      assert.equal(no.intent, 'REJECT_ACTION', no.message)
      assert.equal((await eventsTomorrow()).length, 1)

      const again = await command('Xóa họp nhóm ngày mai', conversationId)
      const done = await handlers.confirmAction(again.pendingAction?.id)
      assert.equal(done.success, true, done.message)
      assert.deepEqual(await eventsTomorrow(), [])
      // A second click on the same (now settled) action changes nothing.
      const twice = await handlers.confirmAction(again.pendingAction?.id)
      assert.equal(twice.success, false)
    })

    it('lets a pending confirmation expire', async () => {
      await command('Tạo lịch ăn trưa ngày mai lúc 12 giờ')
      const ask = await command('Xóa lịch ăn trưa ngày mai')
      assert.ok(ask.pendingAction, ask.message)
      await new Promise((r) => setTimeout(r, 10_500)) // PENDING_ACTION_TTL_SECONDS=10
      const late = await handlers.confirmAction(ask.pendingAction.id)
      assert.equal(late.success, false, late.message)
      assert.equal((await eventsTomorrow()).length, 1)
    })

    it('asks for missing details, answers unknown requests and English', async () => {
      const incomplete = await command('Tạo lịch')
      assert.equal(incomplete.success, false)
      assert.notEqual(incomplete.intent, 'ERROR')
      const unknown = await command('Hát cho tôi một bài')
      assert.equal(unknown.intent, 'UNKNOWN')
      const en = await command('What do I have tomorrow?')
      assert.equal(en.intent, 'LIST_EVENTS', en.message)
      assert.equal(en.language, 'en')
    })
  })

  describe('speech-to-text (Gemini via local fake)', () => {
    it('transcribes recorded audio and the transcript drives the agent', async () => {
      backend.gemini.transcripts.push('Ngày mai tôi có lịch gì')
      const stt = await handlers.transcribeAudio({
        audioBase64: speechWav(),
        mimeType: 'audio/wav',
        sampleRate: 16000,
        language: 'vi-VN',
        interactionId: randomUUID()
      })
      assert.equal(stt.text, 'Ngày mai tôi có lịch gì')
      assert.equal(stt.provider, 'gemini')
      assert.ok((stt.audioDurationMs ?? 0) >= 900)
      const call = backend.gemini.calls.at(-1)
      assert.equal(call?.hasAudio, true)
      assert.equal(call?.audioMimeType, 'audio/wav')
      const answer = await handlers.executeCommand({ text: stt.text, source: 'voice' })
      assert.equal(answer.intent, 'LIST_EVENTS')
      assert.equal((await handlers.getSttStatus()).isCloudAvailable, true)
    })

    it('returns an empty transcript for silence', async () => {
      const stt = await handlers.transcribeAudio({
        audioBase64: speechWav(),
        mimeType: 'audio/wav'
      })
      assert.equal(stt.text, '')
    })

    it('falls back to the next Gemini model on overload', async () => {
      backend.gemini.fail = { status: 503, count: 1 }
      backend.gemini.transcripts.push('Ngày mai tôi có lịch gì')
      const before = backend.gemini.calls.length
      const stt = await handlers.transcribeAudio({
        audioBase64: speechWav(),
        mimeType: 'audio/wav'
      })
      assert.equal(stt.text, 'Ngày mai tôi có lịch gì')
      const models = backend.gemini.calls.slice(before).map((c) => c.model)
      assert.equal(models.length, 2)
      assert.notEqual(models[0], models[1])
    })

    it('surfaces provider overload and bad audio as error codes', async () => {
      const transcribe = (): Promise<unknown> =>
        handlers.transcribeAudio({ audioBase64: speechWav(), mimeType: 'audio/wav' })
      backend.gemini.fail = { status: 429, count: 10 } // quota on every model
      const overload = await ipcCall(transcribe)
      assert.equal(overload.code, 'STT_UNAVAILABLE', overload.message)
      assert.match(overload.message, /nhận dạng giọng nói/)
      backend.gemini.fail = { status: 500, count: 10 }
      assert.equal((await ipcCall(transcribe)).code, 'UPSTREAM_ERROR')
      backend.gemini.fail = null

      const garbage = await ipcCall(() =>
        handlers.transcribeAudio({ audioBase64: 'bm90IGF1ZGlv', mimeType: 'audio/wav' })
      )
      assert.ok(
        ['VALIDATION_ERROR', 'UNSUPPORTED_MEDIA_TYPE'].includes(garbage.code ?? ''),
        garbage.message
      )
      const empty = await ipcCall(() => handlers.transcribeAudio({ audioBase64: '' }))
      assert.equal(empty.code, 'VALIDATION_ERROR')
    })
  })

  describe('text-to-speech', () => {
    it('reports status and voices, and saves the user voice on the server', async () => {
      const status = await handlers.getPiperStatus()
      assert.equal(status.isAvailable, true)
      assert.equal(status.engineType, 'mock')
      const ids = (await handlers.getPiperVoices()).map((v) => v.id)
      assert.ok(ids.includes('mock-vi') && ids.includes('mock-en'), ids.join())

      assert.equal(await handlers.setPiperVoice('does-not-exist'), false)
      assert.equal(await handlers.setPiperVoice('mock-en'), true)
      assert.equal((await handlers.getPiperStatus()).activeVoiceId, 'mock-en')
      assert.equal((await handlers.piperSynthesize({ text: 'Hello there.' })).voiceId, 'mock-en')
      assert.equal(await handlers.setPiperVoice('mock-vi'), true)
    })

    it('synthesizes WAV audio, honours the rate, and the renderer chunks fit the server limit', async () => {
      const r = await handlers.piperSynthesize({
        text: 'Xin chào, đây là bài kiểm tra.',
        rate: 1.25
      })
      assert.equal(r.mimeType, 'audio/wav')
      assert.equal(Buffer.from(r.audioBase64, 'base64').toString('ascii', 0, 4), 'RIFF')
      assert.ok(r.durationMs > 0)

      const long = 'Bạn có cuộc họp nhóm lúc 9 giờ sáng mai tại phòng họp lớn. '.repeat(30)
      assert.equal(
        (await ipcCall(() => handlers.piperSynthesize({ text: long }))).code,
        'VALIDATION_ERROR'
      )
      for (const chunk of chunkTextForTts(long)) {
        assert.ok((await handlers.piperSynthesize({ text: chunk })).audioBase64.length > 0)
      }
    })
  })

  describe('token lifecycle', () => {
    it('refreshes an expired access token once for concurrent calls', async () => {
      const before = backend.count('POST', '/api/v1/auth/token')
      clock += 60 * 60_000
      const results = await Promise.all([1, 2, 3, 4].map(() => handlers.listEvents({})))
      assert.equal(results.length, 4)
      assert.equal(backend.count('POST', '/api/v1/auth/token'), before + 1)
    })

    it('recovers transparently when the server rotates its signing key', async () => {
      await backend.restart({ JWT_SECRET: randomUUID() + randomUUID() })
      const r = await command('Ngày mai tôi có lịch gì?')
      assert.equal(r.intent, 'LIST_EVENTS', r.message)
      assert.equal(client.isSignedIn, true)
    })

    it('keeps the session while the server is down and resumes afterwards', async () => {
      await backend.pause()
      const status = await handlers.getAuthStatus()
      assert.equal(status.isAuthenticated, true)
      assert.equal(status.error, 'BACKEND_UNREACHABLE')
      assert.equal((await command('Ngày mai tôi có lịch gì?')).error?.code, 'BACKEND_UNREACHABLE')
      await backend.restart()
      assert.equal((await command('Ngày mai tôi có lịch gì?')).intent, 'LIST_EVENTS')
    })

    it('disconnectGoogle on a local account keeps the session', async () => {
      const status = await handlers.disconnectGoogle()
      assert.equal(status.isAuthenticated, true)
      assert.equal(status.calendarProvider, 'local')
    })

    it('signs the app out when the account is deleted from another device', async () => {
      const other = await backend.devLogin(email)
      const res = await fetch(`${backend.apiUrl}/me`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${other.accessToken}` }
      })
      assert.equal(res.status, 204)
      const changesBefore = sessionChanges
      const r = await command('Ngày mai tôi có lịch gì?')
      assert.equal(r.error?.code, 'UNAUTHORIZED')
      assert.equal(client.isSignedIn, false)
      assert.equal(await store.load(), null)
      assert.equal(sessionChanges, changesBefore + 1)
    })

    it('signOut revokes the refresh token on the server', async () => {
      assert.equal((await handlers.signInDev()).isAuthenticated, true)
      const refreshToken = (await store.load())?.refreshToken
      const out = await handlers.signOut()
      assert.equal(out.isAuthenticated, false)
      assert.equal((await command('Ngày mai tôi có lịch gì?')).error?.code, 'UNAUTHORIZED')
      await assert.rejects(
        client.publicRequest('POST', '/auth/token', { grantType: 'refresh_token', refreshToken }),
        (e: ApiError) => e.code === 'INVALID_GRANT'
      )
    })
  })
})
