import type {
  AgentCommandInput,
  AgentCommandResponse,
  BackendAuthStatus,
  CalendarEventDTO,
  CalendarStatusDTO,
  SttResult,
  SttStatus,
  SynthesizeJson,
  TokenResponse,
  TtsStatus,
  TtsVoiceList,
  UserDTO
} from '../../shared/backend'
import type { BackendClient } from './backend-client'

/** Voice uploads and LLM calls can be slow; the server's own request timeout is 60 s. */
const SLOW_TIMEOUT_MS = 65_000

export interface CalendarListQuery {
  timeMin?: string
  timeMax?: string
  q?: string
  maxResults?: number
  timeZone?: string
}

/** Typed voice-backend endpoints (paths relative to `/api/v1`, see voice-backend/docs/openapi.json). */
// The return type is inferred on purpose and exported as `BackendApi` below.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createBackendApi(client: BackendClient) {
  return {
    auth: {
      status: () => client.request<BackendAuthStatus>('GET', '/auth/status'),
      disconnectGoogle: () => client.request<BackendAuthStatus>('POST', '/auth/google/disconnect'),
      devLogin: (email: string) =>
        client.publicRequest<TokenResponse>('POST', '/auth/dev-login', {
          email,
          displayName: 'Developer'
        })
    },
    me: {
      get: () => client.request<UserDTO>('GET', '/me'),
      updateSettings: (patch: Partial<UserDTO['settings']>) =>
        client.request<UserDTO>('PATCH', '/me/settings', patch)
    },
    agent: {
      command: (input: AgentCommandInput) =>
        client.request<AgentCommandResponse>('POST', '/agent/command', input, {
          timeoutMs: SLOW_TIMEOUT_MS
        }),
      confirm: (actionId: string) =>
        client.request<AgentCommandResponse>(
          'POST',
          `/agent/actions/${encodeURIComponent(actionId)}/confirm`,
          undefined,
          { timeoutMs: SLOW_TIMEOUT_MS }
        ),
      reject: (actionId: string) =>
        client.request<AgentCommandResponse>(
          'POST',
          `/agent/actions/${encodeURIComponent(actionId)}/reject`
        )
    },
    calendar: {
      status: () => client.request<CalendarStatusDTO>('GET', '/calendar/status'),
      list: (query: CalendarListQuery = {}) => {
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined && value !== '') params.set(key, String(value))
        }
        const qs = params.toString()
        return client.request<{ items: CalendarEventDTO[] }>(
          'GET',
          `/calendar/events${qs ? `?${qs}` : ''}`
        )
      }
    },
    voice: {
      transcribe: (p: {
        audioBase64: string
        mimeType?: string
        sampleRate?: number
        language?: 'vi' | 'en' | 'auto'
        interactionId?: string
      }) =>
        client.request<SttResult>('POST', '/voice/transcribe', p, { timeoutMs: SLOW_TIMEOUT_MS }),
      sttStatus: () => client.request<SttStatus>('GET', '/voice/stt/status')
    },
    tts: {
      synthesize: (p: {
        text: string
        voiceId?: string
        lengthScale?: number
        speakerId?: number
      }) =>
        client.request<SynthesizeJson>(
          'POST',
          '/tts/synthesize',
          { ...p, responseFormat: 'base64' },
          { timeoutMs: SLOW_TIMEOUT_MS }
        ),
      voices: () => client.request<TtsVoiceList>('GET', '/tts/voices'),
      status: () => client.request<TtsStatus>('GET', '/tts/status')
    }
  }
}

export type BackendApi = ReturnType<typeof createBackendApi>
