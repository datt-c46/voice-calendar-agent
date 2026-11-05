import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { AgentCommandInput, AgentCommandResponse, TokenResponse } from '../src/shared/backend'
import { parseIpcError } from '../src/shared/errors'
import type { BackendApi } from '../src/main/backend/api'
import { BackendClient } from '../src/main/backend/backend-client'
import { resolveBackendConfig } from '../src/main/backend/config'
import { createIpcHandlers, ipcError, type IpcHandlers } from '../src/main/backend/handlers'
import { ApiError } from '../src/main/backend/http'
import { LoginError } from '../src/main/backend/login'
import { MemorySessionStore } from '../src/main/backend/session-store'
import { USER } from './helpers/fakeBackend'

const CONVERSATION = '22222222-2222-4222-8222-222222222222'

function tokens(n = 1): TokenResponse {
  return {
    accessToken: `a${n}`,
    tokenType: 'Bearer',
    expiresIn: 900,
    refreshToken: `r${n}`,
    refreshExpiresIn: 3600,
    user: USER
  }
}

/** Stub of the typed endpoints; each test overrides what it needs. */
function stubApi(calls: string[]): BackendApi {
  const reply = (text: string): AgentCommandResponse => ({
    success: true,
    message: text,
    intent: 'UNKNOWN' as const,
    language: 'vi' as const,
    conversationId: CONVERSATION,
    messageId: 'm1'
  })
  return {
    auth: {
      status: async () => {
        calls.push('auth.status')
        return {
          isAuthenticated: true,
          isConfigured: true,
          userEmail: 'g@gmail.com',
          scopes: ['openid'],
          calendarProvider: 'google',
          googleConnected: true
        }
      },
      disconnectGoogle: async () => {
        calls.push('auth.disconnectGoogle')
        throw new ApiError(500, 'INTERNAL', 'x')
      },
      devLogin: async (email: string) => {
        calls.push(`auth.devLogin:${email}`)
        return tokens(2)
      }
    },
    me: {
      get: async () => USER,
      updateSettings: async (patch) => {
        calls.push(`me.updateSettings:${JSON.stringify(patch)}`)
        return USER
      }
    },
    agent: {
      command: async (input: AgentCommandInput) => {
        calls.push(`agent.command:${JSON.stringify(input)}`)
        return reply(input.text)
      },
      confirm: async (id: string) => {
        calls.push(`agent.confirm:${id}`)
        return reply('ok')
      },
      reject: async (id: string) => {
        calls.push(`agent.reject:${id}`)
        return reply('ok')
      }
    },
    calendar: {
      status: async () => ({ mode: 'local', connected: true, timeZone: 'Asia/Bangkok' }),
      list: async (q) => {
        calls.push(`calendar.list:${JSON.stringify(q)}`)
        return { items: [] }
      }
    },
    voice: {
      transcribe: async (p) => {
        calls.push(
          `voice.transcribe:${JSON.stringify({ ...p, audioBase64: p.audioBase64.length })}`
        )
        return {
          text: 'xin chào',
          language: 'vi',
          provider: 'gemini',
          latencyMs: 321,
          audioDurationMs: 900
        }
      },
      sttStatus: async () => ({ provider: 'gemini', available: true })
    },
    tts: {
      synthesize: async (p) => {
        calls.push(`tts.synthesize:${JSON.stringify(p)}`)
        return {
          audioBase64: 'UklGRg==',
          mimeType: 'audio/wav',
          sampleRate: 16000,
          durationMs: 500,
          voiceId: 'vi_VN-vivos-x_low',
          provider: 'piper'
        }
      },
      voices: async () => {
        calls.push('tts.voices')
        return {
          items: [{ id: 'vi_VN-vivos-x_low', name: 'VIVOS', lang: 'vi_VN', isDefault: true }],
          defaultVoiceId: 'vi_VN-vivos-x_low'
        }
      },
      status: async () => ({
        provider: 'piper',
        available: true,
        voiceCount: 1,
        defaultVoiceId: 'vi_VN-vivos-x_low'
      })
    }
  }
}

describe('IPC handlers', () => {
  let calls: string[]
  let api: BackendApi
  let client: BackendClient
  let handlers: IpcHandlers
  let googleSignIn: (signal: AbortSignal) => Promise<TokenResponse>
  const logoutFetch: typeof fetch = async () => new Response(null, { status: 204 })

  const make = (env: Record<string, string> = {}): void => {
    handlers = createIpcHandlers({
      client,
      api,
      config: resolveBackendConfig({ VOICE_BACKEND_URL: 'http://backend.test:4000/', ...env }),
      signInWithGoogle: (signal) => googleSignIn(signal)
    })
  }

  beforeEach(async () => {
    calls = []
    api = stubApi(calls)
    client = new BackendClient({
      apiUrl: 'http://backend.test/api/v1',
      store: new MemorySessionStore(),
      fetch: logoutFetch
    })
    await client.signIn(tokens())
    googleSignIn = async () => tokens(3)
    make()
  })

  describe('executeCommand', () => {
    it('forwards text, source and a valid conversation id', async () => {
      const res = await handlers.executeCommand({
        text: '  Xóa họp  ',
        conversationId: CONVERSATION,
        source: 'voice'
      })
      assert.equal(res.success, true)
      assert.equal(res.conversationId, CONVERSATION)
      assert.deepEqual(calls, [
        `agent.command:${JSON.stringify({ text: 'Xóa họp', source: 'voice', conversationId: CONVERSATION })}`
      ])
    })

    it('drops a malformed conversation id instead of failing', async () => {
      await handlers.executeCommand({ text: 'hi', conversationId: '../../etc' })
      assert.deepEqual(calls, [`agent.command:${JSON.stringify({ text: 'hi', source: 'text' })}`])
    })

    it('validates input without calling the backend', async () => {
      for (const bad of [undefined, 'text', { text: 42 }, { text: '   ' }]) {
        const res = await handlers.executeCommand(bad)
        assert.equal(res.success, false)
        assert.equal(res.error?.code, 'VALIDATION_ERROR')
      }
      const long = await handlers.executeCommand({ text: 'a'.repeat(2001) })
      assert.equal(long.error?.code, 'PAYLOAD_TOO_LARGE')
      assert.deepEqual(calls, [])
    })

    it('turns backend errors into an ERROR answer with the code', async () => {
      api.agent.command = async () => {
        throw new ApiError(429, 'RATE_LIMITED', 'Too many requests')
      }
      const res = await handlers.executeCommand({ text: 'hi' })
      assert.deepEqual(res.error, { code: 'RATE_LIMITED' })
      assert.equal(res.intent, 'ERROR')
      assert.match(res.message, /quá nhanh/)
    })

    it('answers UNAUTHORIZED when signed out', async () => {
      await client.signOut()
      const res = await handlers.executeCommand({ text: 'hi' })
      assert.equal(res.error?.code, 'UNAUTHORIZED')
      assert.equal(calls.filter((c) => c.startsWith('agent.')).length, 0)
    })
  })

  it('confirm / reject validate the action id', async () => {
    assert.equal((await handlers.confirmAction('abc-123')).success, true)
    assert.equal((await handlers.rejectAction('abc-123')).success, true)
    assert.equal((await handlers.confirmAction('../x')).error?.code, 'VALIDATION_ERROR')
    assert.equal((await handlers.rejectAction(42)).error?.code, 'VALIDATION_ERROR')
    assert.deepEqual(calls, ['agent.confirm:abc-123', 'agent.reject:abc-123'])
  })

  it('listEvents renames query → q and drops invalid fields', async () => {
    await handlers.listEvents({
      timeMin: '2026-11-05T00:00:00+07:00',
      query: 'họp',
      maxResults: 999,
      junk: 1
    })
    assert.deepEqual(calls, [
      `calendar.list:${JSON.stringify({ timeMin: '2026-11-05T00:00:00+07:00', q: 'họp' })}`
    ])
  })

  describe('auth', () => {
    it('reports the signed-in user and server Google config', async () => {
      const s = await handlers.getAuthStatus()
      assert.equal(s.isAuthenticated, true)
      assert.equal(s.userEmail, 'user@example.com')
      assert.equal(s.calendarProvider, 'google')
      assert.equal(s.isConfigured, true)
      assert.equal(s.backendUrl, 'http://backend.test:4000')
      assert.equal(s.devLoginAvailable, false)
    })

    it('reports signed out without calling the backend', async () => {
      await client.signOut()
      calls.length = 0
      const s = await handlers.getAuthStatus()
      assert.equal(s.isAuthenticated, false)
      assert.equal(s.isConfigured, null)
      assert.deepEqual(calls, [])
    })

    it('stays signed in (with an error code) when the server is unreachable', async () => {
      api.auth.status = async () => {
        throw new ApiError(0, 'BACKEND_UNREACHABLE', 'down')
      }
      const s = await handlers.getAuthStatus()
      assert.equal(s.isAuthenticated, true)
      assert.equal(s.error, 'BACKEND_UNREACHABLE')
      assert.equal(s.calendarProvider, 'local') // from the stored user
    })

    it('Google sign-in stores the new session; failures carry the error code', async () => {
      const ok = await handlers.signInWithGoogle()
      assert.equal(ok.isAuthenticated, true)
      assert.equal(ok.error, undefined)

      googleSignIn = async () => {
        throw new LoginError('access_denied')
      }
      const denied = await handlers.signInWithGoogle()
      assert.equal(denied.error, 'access_denied')
      assert.match(denied.errorMessage ?? '', /từ chối/)
    })

    it('a second sign-in or cancelSignIn aborts the pending attempt', async () => {
      const signals: AbortSignal[] = []
      googleSignIn = (signal) =>
        new Promise((_resolve, reject) => {
          signals.push(signal)
          signal.addEventListener('abort', () => reject(new LoginError('SIGN_IN_CANCELLED')))
        })
      const first = handlers.signInWithGoogle()
      await new Promise((r) => setImmediate(r))
      void handlers.cancelSignIn()
      assert.equal((await first).error, 'SIGN_IN_CANCELLED')
      assert.equal(signals[0]?.aborted, true)
    })

    it('dev sign-in uses VOICE_BACKEND_DEV_EMAIL and maps 404 to DEV_LOGIN_UNAVAILABLE', async () => {
      const hidden = await handlers.signInDev()
      assert.equal(hidden.error, 'DEV_LOGIN_UNAVAILABLE')

      make({ VOICE_BACKEND_DEV_EMAIL: 'dev@example.com' })
      const ok = await handlers.signInDev()
      assert.equal(ok.devLoginAvailable, true)
      assert.equal(ok.error, undefined)
      assert.ok(calls.includes('auth.devLogin:dev@example.com'))

      api.auth.devLogin = async () => {
        throw new ApiError(404, 'NOT_FOUND', 'Route not found')
      }
      assert.equal((await handlers.signInDev()).error, 'DEV_LOGIN_UNAVAILABLE')
    })

    it('signOut returns a signed-out status', async () => {
      const s = await handlers.signOut()
      assert.equal(s.isAuthenticated, false)
      assert.equal(client.isSignedIn, false)
    })

    it('disconnectGoogle failure keeps the session and reports the error', async () => {
      const s = await handlers.disconnectGoogle()
      assert.equal(s.isAuthenticated, true)
      assert.equal(s.error, 'INTERNAL')
    })
  })

  describe('voice', () => {
    it('transcribeAudio normalizes the request and keeps the old result shape', async () => {
      const r = await handlers.transcribeAudio({
        audioBase64: 'AAAA',
        sampleRate: 16000,
        language: 'vi-VN',
        interactionId: 'f3b1-uuid',
        durationMs: 1234
      })
      assert.equal(r.text, 'xin chào')
      assert.equal(r.durationMs, 321) // backend latencyMs
      assert.deepEqual(calls, [
        `voice.transcribe:${JSON.stringify({ audioBase64: 4, mimeType: 'audio/wav', sampleRate: 16000, language: 'vi', interactionId: 'f3b1-uuid' })}`
      ])
    })

    it('transcribeAudio rejects empty audio with a parsable code', async () => {
      await assert.rejects(handlers.transcribeAudio({ audioBase64: '' }), (e: Error) => {
        assert.equal(parseIpcError(e).code, 'VALIDATION_ERROR')
        return true
      })
    })

    it('piperSynthesize converts rate to lengthScale and never forwards junk', async () => {
      await handlers.piperSynthesize({ text: 'Xin chào', rate: 2, voiceId: '../evil', pitch: 3 })
      await handlers.piperSynthesize({ text: 'Xin chào', rate: 1 })
      assert.deepEqual(calls, [
        `tts.synthesize:${JSON.stringify({ text: 'Xin chào', lengthScale: 0.5 })}`,
        `tts.synthesize:${JSON.stringify({ text: 'Xin chào' })}`
      ])
    })

    it('getPiperStatus is unavailable while signed out, available with voices when signed in', async () => {
      const on = await handlers.getPiperStatus()
      assert.equal(on.isAvailable, true)
      assert.equal(on.activeVoiceName, 'VIVOS')
      assert.equal(on.engineType, 'executable')

      await client.signOut()
      const off = await handlers.getPiperStatus()
      assert.equal(off.isAvailable, false)
      assert.equal(off.error, 'UNAUTHORIZED')
      assert.deepEqual(await handlers.getPiperVoices(), [])
    })

    it('caches the voice list and checks it before saving a voice', async () => {
      await handlers.getPiperVoices()
      await handlers.getPiperVoices()
      assert.equal(calls.filter((c) => c === 'tts.voices').length, 1)

      assert.equal(await handlers.setPiperVoice('vi_VN-unknown'), false)
      assert.equal(await handlers.setPiperVoice('vi_VN-vivos-x_low'), true)
      assert.ok(
        calls.includes(`me.updateSettings:${JSON.stringify({ ttsVoiceId: 'vi_VN-vivos-x_low' })}`)
      )
      assert.equal(calls.filter((c) => c.startsWith('me.updateSettings')).length, 1)
    })

    it('getSttStatus maps the backend status', async () => {
      assert.deepEqual(await handlers.getSttStatus(), {
        activeProviderId: 'gemini',
        activeProviderName: 'gemini',
        isCloudAvailable: true
      })
    })
  })

  it('ipcError embeds the code so the renderer can parse it back', () => {
    const wrapped = ipcError(new ApiError(503, 'TTS_UNAVAILABLE', 'TTS is disabled'))
    const asSeenByRenderer = new Error(
      `Error invoking remote method 'tts:piper:synthesize': Error: ${wrapped.message}`
    )
    const parsed = parseIpcError(asSeenByRenderer)
    assert.equal(parsed.code, 'TTS_UNAVAILABLE')
    assert.match(parsed.message, /giọng đọc/)
  })
})
