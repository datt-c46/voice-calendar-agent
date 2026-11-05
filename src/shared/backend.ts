/**
 * Wire DTOs of voice-backend (`/api/v1`), mirrored from voice-backend/docs/openapi.json.
 * Shared by the main process (HTTP client) and the renderer (display), so it must stay free of runtime imports.
 */

export type Lang = 'vi' | 'en'
export type CalendarProvider = 'google' | 'local'

export interface EventDateTime {
  /** ISO-8601 with offset, expressed in the request's effective time zone. */
  dateTime: string
  /** `YYYY-MM-DD`, only for all-day events (end date is exclusive). */
  date?: string
  timeZone: string
}

export interface CalendarEventDTO {
  id: string
  summary: string
  description?: string
  location?: string
  start: EventDateTime
  end: EventDateTime
  allDay: boolean
  status: 'confirmed' | 'tentative' | 'cancelled'
  htmlLink?: string
  provider: CalendarProvider
}

export interface UserSettings {
  timeZone: string
  language: 'auto' | Lang
  ttsVoiceId: string | null
  requireConfirmation: boolean
}

export interface UserDTO {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  calendarProvider: CalendarProvider
  googleConnected: boolean
  settings: UserSettings
  createdAt: string
}

export interface TokenResponse {
  accessToken: string
  tokenType: 'Bearer'
  /** Seconds. */
  expiresIn: number
  refreshToken: string
  /** Seconds. */
  refreshExpiresIn: number
  user: UserDTO
}

export interface BackendAuthStatus {
  isAuthenticated: boolean
  isConfigured: boolean
  userEmail: string | null
  scopes: string[]
  calendarProvider: CalendarProvider
  googleConnected: boolean
}

export interface CalendarStatusDTO {
  mode: CalendarProvider
  connected: boolean
  userEmail?: string
  timeZone: string
  reauthRequired?: boolean
}

export type IntentType =
  | 'LIST_EVENTS'
  | 'CREATE_EVENT'
  | 'UPDATE_EVENT'
  | 'DELETE_EVENT'
  | 'CHECK_AVAILABILITY'
  | 'CONFIRM_ACTION'
  | 'REJECT_ACTION'
  | 'UNKNOWN'

export interface PendingActionDTO {
  id: string
  type: 'DELETE_EVENT' | 'UPDATE_EVENT'
  eventId: string
  eventSummary: string
  event: CalendarEventDTO
  proposed?: { summary?: string; start?: string; end?: string }
  expiresAt: string
  status?: 'pending' | 'confirmed' | 'rejected' | 'expired'
}

export interface AgentCommandInput {
  text: string
  source?: 'text' | 'voice'
  conversationId?: string
  timeZone?: string
  language?: Lang
}

export interface AgentCommandResponse {
  success: boolean
  message: string
  intent: IntentType | 'ERROR'
  language: Lang
  events?: CalendarEventDTO[]
  requiresConfirmation?: boolean
  pendingAction?: PendingActionDTO
  conversationId: string
  messageId: string
  error?: { code: string }
}

export interface SttResult {
  text: string
  language: Lang
  provider: string
  latencyMs: number
  audioDurationMs?: number
  confidence?: number
  interactionId?: string
}

export interface SttStatus {
  provider: string | null
  available: boolean
}

export interface SynthesizeJson {
  audioBase64: string
  mimeType: 'audio/wav'
  sampleRate: number
  durationMs: number
  voiceId: string
  provider: string
}

export interface TtsVoice {
  id: string
  name: string
  lang: string
  quality?: string
  sampleRate?: number
  isDefault: boolean
  numSpeakers?: number
}

export interface TtsVoiceList {
  items: TtsVoice[]
  defaultVoiceId: string | null
}

export interface TtsStatus {
  provider: string | null
  available: boolean
  voiceCount: number
  defaultVoiceId: string | null
}

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown; requestId: string }
}
