export interface AudioData {
  buffer?: Buffer
  base64?: string
  mimeType?: string
  sampleRate?: number
  durationMs?: number
  language?: string
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

export interface TranscribeAudioRequest {
  audioBase64: string
  mimeType?: string
  sampleRate?: number
  language?: string
  interactionId?: string
  durationMs?: number
}
