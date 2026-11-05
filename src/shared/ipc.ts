/**
 * Contract between the renderer (`window.api`) and the main process. Type-only (no runtime code) except the channel
 * table, so both the preload bundle and the renderer can import it.
 *
 * The renderer never sees backend tokens: every call goes renderer → IPC → main → voice-backend.
 */
import type {
  AgentCommandResponse,
  CalendarEventDTO,
  CalendarProvider,
  CalendarStatusDTO,
  Lang
} from './backend'

export type { CalendarEventDTO, CalendarStatusDTO, PendingActionDTO } from './backend'

export const IPC = {
  executeCommand: 'agent:execute-command',
  confirmAction: 'agent:confirm-action',
  rejectAction: 'agent:reject-action',
  getCalendarStatus: 'calendar:get-status',
  listEvents: 'calendar:list-events',
  getAuthStatus: 'auth:get-status',
  signInWithGoogle: 'auth:sign-in-google',
  signInDev: 'auth:sign-in-dev',
  cancelSignIn: 'auth:cancel-sign-in',
  signOut: 'auth:sign-out',
  disconnectGoogle: 'auth:disconnect-google',
  transcribeAudio: 'stt:transcribe',
  getSttStatus: 'stt:get-status',
  piperSynthesize: 'tts:piper:synthesize',
  getPiperStatus: 'tts:piper:get-status',
  getPiperVoices: 'tts:piper:get-voices',
  setPiperVoice: 'tts:piper:set-voice'
} as const

/** Main → renderer push: the auth state changed (sign-in, sign-out, session expired). */
export const AUTH_CHANGED_EVENT = 'auth:changed'

export interface AgentCommandRequest {
  text: string
  /** Send back the `conversationId` of the previous answer to continue the dialog (e.g. answering "có"). */
  conversationId?: string
  timeZone?: string
  source?: 'text' | 'voice'
}

/**
 * Backend `AgentCommandResponse`. When the request never reached the agent (network down, signed out, rate limited…)
 * main synthesizes `{ success: false, intent: 'ERROR', error: { code } }` without conversation ids.
 */
export type AgentCommandResult = Omit<AgentCommandResponse, 'conversationId' | 'messageId'> & {
  conversationId?: string
  messageId?: string
}

export interface EventQuery {
  /** ISO-8601 with offset. */
  timeMin?: string
  timeMax?: string
  query?: string
  maxResults?: number
}

export interface AuthStatusDTO {
  /** A voice-backend session exists (signed in with Google or the dev login). */
  isAuthenticated: boolean
  /** Server has Google OAuth configured; `null` = unknown (only reported to signed-in users). */
  isConfigured: boolean | null
  userEmail: string | null
  displayName: string | null
  calendarProvider: CalendarProvider | null
  googleConnected: boolean
  scopes: string[]
  /** `VOICE_BACKEND_DEV_EMAIL` is set: offer the development sign-in (works only if the server enables it). */
  devLoginAvailable: boolean
  backendUrl: string
  /** Error code of the action that produced this status (e.g. `access_denied`, `GOOGLE_NOT_CONFIGURED`). */
  error?: string
  errorMessage?: string
}

export interface TranscribeAudioRequest {
  audioBase64: string
  mimeType?: string
  sampleRate?: number
  language?: string
  interactionId?: string
}

export interface STTResult {
  text: string
  language?: Lang
  provider?: string
  /** STT latency in ms (backend `latencyMs`). */
  durationMs?: number
  audioDurationMs?: number
  confidence?: number
  interactionId?: string
}

export interface STTStatusDTO {
  activeProviderId: string
  activeProviderName: string
  isCloudAvailable: boolean
}

export interface PiperSynthesizeRequest {
  text: string
  voiceId?: string
  speakerId?: number
  /** Speaking-rate factor (> 1 is faster); sent to the server as `lengthScale = 1 / rate`. */
  rate?: number
}

export interface PiperSynthesizeResult {
  audioBase64: string
  mimeType: string
  sampleRate: number
  durationMs: number
  voiceId: string
}

export interface PiperVoiceModelInfo {
  id: string
  name: string
  lang: string
  sampleRate?: number
  numSpeakers?: number
  quality?: string
  isDefault?: boolean
}

export interface PiperStatusDTO {
  isAvailable: boolean
  engineType: 'executable' | 'mock' | 'none'
  activeVoiceId: string | null
  activeVoiceName: string | null
  voices: PiperVoiceModelInfo[]
  error: string | null
}

export interface CalendarAgentAPI {
  executeCommand: (request: AgentCommandRequest) => Promise<AgentCommandResult>
  confirmAction: (actionId: string) => Promise<AgentCommandResult>
  rejectAction: (actionId: string) => Promise<AgentCommandResult>
  getCalendarStatus: () => Promise<CalendarStatusDTO>
  listEvents: (query?: EventQuery) => Promise<CalendarEventDTO[]>
  getAuthStatus: () => Promise<AuthStatusDTO>
  signInWithGoogle: () => Promise<AuthStatusDTO>
  signInDev: () => Promise<AuthStatusDTO>
  cancelSignIn: () => Promise<void>
  signOut: () => Promise<AuthStatusDTO>
  disconnectGoogle: () => Promise<AuthStatusDTO>
  onAuthChanged: (listener: (status: AuthStatusDTO) => void) => () => void
  transcribeAudio: (request: TranscribeAudioRequest) => Promise<STTResult>
  getSttStatus: () => Promise<STTStatusDTO>
  piperSynthesize: (request: PiperSynthesizeRequest) => Promise<PiperSynthesizeResult>
  getPiperStatus: () => Promise<PiperStatusDTO>
  getPiperVoices: () => Promise<PiperVoiceModelInfo[]>
  setPiperVoice: (voiceId: string) => Promise<boolean>
}
