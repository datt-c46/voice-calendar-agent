import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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

// Custom APIs for renderer
const api = {
  executeCommand: (request: AgentCommandRequest): Promise<AgentCommandResponse> =>
    ipcRenderer.invoke('agent:execute-command', request),
  getCalendarStatus: (): Promise<CalendarStatusDTO> => ipcRenderer.invoke('calendar:get-status'),
  listEvents: (query?: EventQueryDTO): Promise<CalendarEventDTO[]> =>
    ipcRenderer.invoke('calendar:list-events', query),
  getAuthStatus: (): Promise<AuthStatusDTO> => ipcRenderer.invoke('auth:get-status'),
  startGoogleAuth: (): Promise<AuthStatusDTO> => ipcRenderer.invoke('auth:start-google'),
  logoutGoogle: (): Promise<AuthStatusDTO> => ipcRenderer.invoke('auth:logout'),
  transcribeAudio: (request: TranscribeAudioRequest): Promise<STTResult> =>
    ipcRenderer.invoke('stt:transcribe', request),
  getSttStatus: (): Promise<STTStatusDTO> => ipcRenderer.invoke('stt:get-status'),
  piperSynthesize: (request: PiperSynthesizeRequest): Promise<PiperSynthesizeResult> =>
    ipcRenderer.invoke('tts:piper:synthesize', request),
  getPiperStatus: (): Promise<PiperStatusDTO> => ipcRenderer.invoke('tts:piper:get-status'),
  getPiperVoices: (): Promise<PiperVoiceModelInfo[]> => ipcRenderer.invoke('tts:piper:get-voices'),
  setPiperVoice: (voiceId: string): Promise<boolean> =>
    ipcRenderer.invoke('tts:piper:set-voice', voiceId)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
