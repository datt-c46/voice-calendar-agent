import { ElectronAPI } from '@electron-toolkit/preload'

export interface AgentCommandRequest {
  text: string
  clientTimestamp?: string
  timeZone?: string
}

export interface CalendarEventDTO {
  id: string
  summary: string
  description?: string
  location?: string
  start: { dateTime: string; timeZone?: string }
  end: { dateTime: string; timeZone?: string }
  status?: string
}

export interface AgentCommandResponse {
  success: boolean
  message: string
  intent: string
  events?: CalendarEventDTO[]
  error?: string
}

export interface CalendarStatusDTO {
  mode: 'mock' | 'google'
  connected: boolean
  userEmail?: string
  eventCount?: number
  timeZone: string
}

export interface AuthStatusDTO {
  isAuthenticated: boolean
  isConfigured: boolean
  userEmail?: string | null
  scopes: string[]
  error?: string
}

export interface EventQueryDTO {
  timeMin?: string
  timeMax?: string
  query?: string
  maxResults?: number
}

export interface TranscribeAudioRequest {
  audioBase64: string
  mimeType?: string
  sampleRate?: number
  language?: string
  durationMs?: number
  interactionId?: string
}

export interface STTResult {
  text: string
  language?: string
  provider?: string
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
  rate?: number
  pitch?: number
  volume?: number
}

export interface PiperSynthesizeResult {
  audioBase64: string
  mimeType: string
  sampleRate: number
  durationMs: number
  voiceId: string
  isFallback?: boolean
}

export interface PiperVoiceModelInfo {
  id: string
  name: string
  lang: string
  modelPath: string
  configPath: string
  sampleRate?: number
  numSpeakers?: number
  quality?: string
  isDefault?: boolean
}

export interface PiperStatusDTO {
  isAvailable: boolean
  engineType: 'executable' | 'python' | 'built-in' | 'mock'
  activeVoiceId: string | null
  activeVoiceName: string | null
  voices: PiperVoiceModelInfo[]
  executablePath: string | null
  modelDirectory: string | null
  error?: string | null
}

export interface CalendarAgentAPI {
  executeCommand: (request: AgentCommandRequest) => Promise<AgentCommandResponse>
  getCalendarStatus: () => Promise<CalendarStatusDTO>
  listEvents: (query?: EventQueryDTO) => Promise<CalendarEventDTO[]>
  getAuthStatus: () => Promise<AuthStatusDTO>
  startGoogleAuth: () => Promise<AuthStatusDTO>
  logoutGoogle: () => Promise<AuthStatusDTO>
  transcribeAudio: (request: TranscribeAudioRequest) => Promise<STTResult>
  getSttStatus: () => Promise<STTStatusDTO>
  piperSynthesize: (request: PiperSynthesizeRequest) => Promise<PiperSynthesizeResult>
  getPiperStatus: () => Promise<PiperStatusDTO>
  getPiperVoices: () => Promise<PiperVoiceModelInfo[]>
  setPiperVoice: (voiceId: string) => Promise<boolean>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: CalendarAgentAPI
  }
}
