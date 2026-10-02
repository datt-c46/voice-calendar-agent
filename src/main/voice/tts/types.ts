export interface PiperSynthesizeRequest {
  text: string
  voiceId?: string
  speakerId?: number
  rate?: number // Speed multiplier (default: 1.0)
  pitch?: number
  volume?: number // 0.0 to 1.0
  noiseScale?: number
  noiseW?: number
  lengthScale?: number
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
  quality?: 'x_low' | 'low' | 'medium' | 'high'
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
