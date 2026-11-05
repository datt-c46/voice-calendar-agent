import type {
  CalendarEventDTO,
  CalendarStatusDTO,
  TokenResponse,
  TtsVoice
} from '../../shared/backend'
import { describeError } from '../../shared/errors'
import type {
  AgentCommandResult,
  AuthStatusDTO,
  CalendarAgentAPI,
  PiperStatusDTO,
  PiperSynthesizeResult,
  PiperVoiceModelInfo,
  STTResult,
  STTStatusDTO
} from '../../shared/ipc'
import type { BackendApi } from './api'
import type { BackendClient } from './backend-client'
import type { BackendConfig } from './config'
import { ApiError } from './http'
import { LoginError } from './login'

/** Every `window.api` method except the event subscription; arguments come from the renderer and are untrusted. */
export type IpcHandlers = {
  [K in Exclude<keyof CalendarAgentAPI, 'onAuthChanged'>]: (
    arg?: unknown
  ) => ReturnType<CalendarAgentAPI[K]>
}

export interface HandlerDeps {
  client: BackendClient
  api: BackendApi
  config: BackendConfig
  signInWithGoogle(signal: AbortSignal): Promise<TokenResponse>
  now?: () => number
  log?: (message: string, error?: unknown) => void
}

const MAX_COMMAND_CHARS = 2000
/** ~10 MB of audio once decoded (server MAX_AUDIO_BYTES). */
const MAX_AUDIO_BASE64_CHARS = 14_000_000
const VOICES_TTL_MS = 5 * 60_000
const ACTION_ID = /^[A-Za-z0-9-]{1,64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INTERACTION_ID = /^[A-Za-z0-9._:-]{1,128}$/
const VOICE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/

function errorCode(error: unknown): string {
  if (error instanceof ApiError || error instanceof LoginError) return error.code
  return 'CLIENT_ERROR'
}

function errorMessage(error: unknown): string {
  const code = errorCode(error)
  return describeError(code, error instanceof Error ? error.message : String(error))
}

/** `ipcMain.handle` forwards only `Error.message`: embed the code so the renderer can recover it (parseIpcError). */
export function ipcError(error: unknown): Error {
  if (error instanceof ApiError || error instanceof LoginError)
    return new Error(`${error.code}: ${error.message}`)
  return error instanceof Error ? error : new Error(String(error))
}

function failure(code: string, message: string): AgentCommandResult {
  return { success: false, intent: 'ERROR', language: 'vi', message, error: { code } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() !== '' && value.length <= max
    ? value.trim()
    : undefined
}

function toLanguage(value: unknown): 'vi' | 'en' | 'auto' | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.toLowerCase()
  if (v === 'auto') return 'auto'
  if (v.startsWith('vi')) return 'vi'
  if (v.startsWith('en')) return 'en'
  return undefined
}

const toPiperVoice = (v: TtsVoice): PiperVoiceModelInfo => ({
  id: v.id,
  name: v.name,
  lang: v.lang,
  isDefault: v.isDefault,
  ...(v.sampleRate !== undefined ? { sampleRate: v.sampleRate } : {}),
  ...(v.numSpeakers !== undefined ? { numSpeakers: v.numSpeakers } : {}),
  ...(v.quality !== undefined ? { quality: v.quality } : {})
})

export function createIpcHandlers(deps: HandlerDeps): IpcHandlers {
  const { client, api, config } = deps
  const now = deps.now ?? Date.now
  let signInAbort: AbortController | null = null
  let voicesCache: {
    userId: string
    at: number
    items: TtsVoice[]
    defaultVoiceId: string | null
  } | null = null

  client.onSessionChange(() => {
    voicesCache = null
  })

  const base = (): Pick<AuthStatusDTO, 'backendUrl' | 'devLoginAvailable'> => ({
    backendUrl: config.baseUrl,
    devLoginAvailable: config.devLoginEmail !== null
  })

  const signedOut = (): AuthStatusDTO => ({
    isAuthenticated: false,
    isConfigured: null,
    userEmail: null,
    displayName: null,
    calendarProvider: null,
    googleConnected: false,
    scopes: [],
    ...base()
  })

  const withError = (status: AuthStatusDTO, error: unknown): AuthStatusDTO => ({
    ...status,
    error: errorCode(error),
    errorMessage: errorMessage(error)
  })

  async function authStatus(): Promise<AuthStatusDTO> {
    const user = client.user
    if (!user) return signedOut()
    try {
      const s = await api.auth.status()
      return {
        isAuthenticated: true,
        isConfigured: s.isConfigured,
        userEmail: user.email,
        displayName: user.displayName,
        calendarProvider: s.calendarProvider,
        googleConnected: s.googleConnected,
        scopes: s.scopes,
        ...base()
      }
    } catch (error) {
      if (!client.isSignedIn) return signedOut() // refresh token rejected while checking
      // Server unreachable: still signed in locally; report what the session knows.
      return withError(
        {
          isAuthenticated: true,
          isConfigured: null,
          userEmail: user.email,
          displayName: user.displayName,
          calendarProvider: user.calendarProvider,
          googleConnected: user.googleConnected,
          scopes: [],
          ...base()
        },
        error
      )
    }
  }

  async function voices(): Promise<{ items: TtsVoice[]; defaultVoiceId: string | null }> {
    const userId = client.user?.id
    if (voicesCache && voicesCache.userId === userId && now() - voicesCache.at < VOICES_TTL_MS)
      return voicesCache
    const list = await api.tts.voices()
    if (userId)
      voicesCache = { userId, at: now(), items: list.items, defaultVoiceId: list.defaultVoiceId }
    return list
  }

  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      throw ipcError(error)
    }
  }

  async function runAgent(fn: () => Promise<AgentCommandResult>): Promise<AgentCommandResult> {
    if (!client.isSignedIn) return failure('UNAUTHORIZED', describeError('UNAUTHORIZED'))
    try {
      return await fn()
    } catch (error) {
      return failure(errorCode(error), errorMessage(error))
    }
  }

  return {
    async executeCommand(arg) {
      if (!isRecord(arg) || typeof arg['text'] !== 'string') {
        return failure('VALIDATION_ERROR', 'Dữ liệu yêu cầu không hợp lệ.')
      }
      const text = arg['text'].trim()
      if (text === '') return failure('VALIDATION_ERROR', 'Câu lệnh trống.')
      if (text.length > MAX_COMMAND_CHARS) {
        return failure('PAYLOAD_TOO_LARGE', `Câu lệnh dài quá ${MAX_COMMAND_CHARS} ký tự.`)
      }
      const conversationId = optionalString(arg['conversationId'], 64)
      const timeZone = optionalString(arg['timeZone'], 64)
      const source = arg['source'] === 'voice' ? 'voice' : 'text'
      return runAgent(() =>
        api.agent.command({
          text,
          source,
          ...(conversationId && UUID.test(conversationId) ? { conversationId } : {}),
          ...(timeZone ? { timeZone } : {})
        })
      )
    },

    async confirmAction(arg) {
      if (typeof arg !== 'string' || !ACTION_ID.test(arg))
        return failure('VALIDATION_ERROR', 'Mã thao tác không hợp lệ.')
      return runAgent(() => api.agent.confirm(arg))
    },

    async rejectAction(arg) {
      if (typeof arg !== 'string' || !ACTION_ID.test(arg))
        return failure('VALIDATION_ERROR', 'Mã thao tác không hợp lệ.')
      return runAgent(() => api.agent.reject(arg))
    },

    getCalendarStatus: () => guard<CalendarStatusDTO>(() => api.calendar.status()),

    listEvents: (arg) =>
      guard<CalendarEventDTO[]>(async () => {
        const q = isRecord(arg) ? arg : {}
        const maxResults =
          typeof q['maxResults'] === 'number' ? Math.trunc(q['maxResults']) : undefined
        const query = optionalString(q['query'], 200)
        const timeMin = optionalString(q['timeMin'], 64)
        const timeMax = optionalString(q['timeMax'], 64)
        const { items } = await api.calendar.list({
          ...(timeMin ? { timeMin } : {}),
          ...(timeMax ? { timeMax } : {}),
          ...(query ? { q: query } : {}),
          ...(maxResults && maxResults >= 1 && maxResults <= 250 ? { maxResults } : {})
        })
        return items
      }),

    getAuthStatus: () => authStatus(),

    async signInWithGoogle() {
      signInAbort?.abort() // a new attempt replaces a pending one (e.g. the user closed the browser tab)
      const controller = new AbortController()
      signInAbort = controller
      try {
        await client.signIn(await deps.signInWithGoogle(controller.signal))
        return await authStatus()
      } catch (error) {
        deps.log?.('[auth] Google sign-in failed', error)
        return withError(await authStatus(), error)
      } finally {
        if (signInAbort === controller) signInAbort = null
      }
    },

    async signInDev() {
      const email = config.devLoginEmail
      if (!email)
        return withError(await authStatus(), new ApiError(404, 'DEV_LOGIN_UNAVAILABLE', 'disabled'))
      try {
        await client.signIn(await api.auth.devLogin(email))
        return await authStatus()
      } catch (error) {
        const e =
          error instanceof ApiError && error.status === 404
            ? new ApiError(404, 'DEV_LOGIN_UNAVAILABLE', 'Server has dev login disabled')
            : error
        return withError(await authStatus(), e)
      }
    },

    async cancelSignIn() {
      signInAbort?.abort()
    },

    async signOut() {
      signInAbort?.abort()
      await client.signOut()
      return signedOut()
    },

    async disconnectGoogle() {
      try {
        await api.auth.disconnectGoogle()
        return await authStatus()
      } catch (error) {
        return withError(await authStatus(), error)
      }
    },

    transcribeAudio: (arg) =>
      guard<STTResult>(async () => {
        if (!isRecord(arg) || typeof arg['audioBase64'] !== 'string' || arg['audioBase64'] === '') {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Audio payload is empty')
        }
        if (arg['audioBase64'].length > MAX_AUDIO_BASE64_CHARS) {
          throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Audio is too large')
        }
        const language = toLanguage(arg['language'])
        const mimeType = optionalString(arg['mimeType'], 100) ?? 'audio/wav'
        const sampleRate =
          typeof arg['sampleRate'] === 'number' ? Math.trunc(arg['sampleRate']) : undefined
        const interactionId = optionalString(arg['interactionId'], 128)
        const r = await api.voice.transcribe({
          audioBase64: arg['audioBase64'],
          mimeType,
          ...(sampleRate && sampleRate >= 8000 && sampleRate <= 192000 ? { sampleRate } : {}),
          ...(language ? { language } : {}),
          ...(interactionId && INTERACTION_ID.test(interactionId) ? { interactionId } : {})
        })
        return {
          text: r.text,
          language: r.language,
          provider: r.provider,
          durationMs: r.latencyMs,
          ...(r.audioDurationMs !== undefined ? { audioDurationMs: r.audioDurationMs } : {}),
          ...(r.confidence !== undefined ? { confidence: r.confidence } : {}),
          ...(r.interactionId !== undefined ? { interactionId: r.interactionId } : {})
        }
      }),

    async getSttStatus(): Promise<STTStatusDTO> {
      if (!client.isSignedIn) {
        return {
          activeProviderId: 'none',
          activeProviderName: 'Chưa đăng nhập',
          isCloudAvailable: false
        }
      }
      const s = await guard(() => api.voice.sttStatus())
      return {
        activeProviderId: s.provider ?? 'none',
        activeProviderName: s.provider ?? 'none',
        isCloudAvailable: s.provider !== null && s.available
      }
    },

    piperSynthesize: (arg) =>
      guard<PiperSynthesizeResult>(async () => {
        if (!isRecord(arg) || typeof arg['text'] !== 'string' || arg['text'].trim() === '') {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Synthesis text is empty')
        }
        const rate = typeof arg['rate'] === 'number' && arg['rate'] > 0 ? arg['rate'] : undefined
        const voiceId = optionalString(arg['voiceId'], 100)
        const speakerId = arg['speakerId']
        const r = await api.tts.synthesize({
          text: arg['text'],
          ...(voiceId && VOICE_ID.test(voiceId) ? { voiceId } : {}),
          ...(rate !== undefined && rate !== 1
            ? { lengthScale: Math.min(4, Math.max(0.25, 1 / rate)) }
            : {}),
          ...(Number.isInteger(speakerId) && (speakerId as number) >= 0
            ? { speakerId: speakerId as number }
            : {})
        })
        return {
          audioBase64: r.audioBase64,
          mimeType: r.mimeType,
          sampleRate: r.sampleRate,
          durationMs: r.durationMs,
          voiceId: r.voiceId
        }
      }),

    async getPiperStatus(): Promise<PiperStatusDTO> {
      const off = (error: string): PiperStatusDTO => ({
        isAvailable: false,
        engineType: 'none',
        activeVoiceId: null,
        activeVoiceName: null,
        voices: [],
        error
      })
      if (!client.isSignedIn) return off('UNAUTHORIZED')
      try {
        const status = await api.tts.status()
        if (!status.available || status.provider === null) return off('TTS_UNAVAILABLE')
        const list = await voices()
        const active = list.items.find((v) => v.id === status.defaultVoiceId)
        return {
          isAvailable: true,
          engineType: status.provider === 'mock' ? 'mock' : 'executable',
          activeVoiceId: status.defaultVoiceId,
          activeVoiceName: active?.name ?? null,
          voices: list.items.map(toPiperVoice),
          error: null
        }
      } catch (error) {
        return off(errorCode(error))
      }
    },

    async getPiperVoices() {
      if (!client.isSignedIn) return []
      return (await guard(() => voices())).items.map(toPiperVoice)
    },

    async setPiperVoice(arg) {
      if (typeof arg !== 'string' || !VOICE_ID.test(arg) || !client.isSignedIn) return false
      try {
        // The server only checks the id's syntax, so make sure the voice exists first.
        if (!(await voices()).items.some((v) => v.id === arg)) return false
        await api.me.updateSettings({ ttsVoiceId: arg })
        voicesCache = null // defaultVoiceId follows the user's setting
        return true
      } catch (error) {
        deps.log?.('[tts] could not save the voice', error)
        return false
      }
    }
  }
}
