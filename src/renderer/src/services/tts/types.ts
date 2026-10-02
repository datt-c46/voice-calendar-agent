export type TTSState = 'idle' | 'queued' | 'speaking' | 'completed' | 'cancelled' | 'error'

export interface TTSVoice {
  id: string
  name: string
  lang: string
  isDefault?: boolean
  localService?: boolean
}

export interface SpeakOptions {
  rate?: number // 0.1 to 10, default 1.0
  pitch?: number // 0 to 2, default 1.0
  volume?: number // 0 to 1, default 1.0
  voice?: TTSVoice | null
  lang?: string // Preferred language code (e.g. 'vi-VN')
  onStart?: () => void
  onEnd?: () => void
  onError?: (err: Error) => void
}

export interface SpeakStreamOptions extends SpeakOptions {
  /** Callback fired as text accumulates chunk-by-chunk for UI updates */
  onTextProgress?: (cumulativeText: string, latestChunk: string) => void
  /** Interaction ID for telemetry correlation */
  interactionId?: string
}

export interface VoiceSelectionResult {
  voice: TTSVoice | null
  isVietnamese: boolean
  warning: string | null
}

export interface TTSQueueProgress {
  currentSentence: string | null
  currentIndex: number
  totalSentences: number
  queueLength: number
}

export interface TTSQueueMetrics {
  queueCreatedAt: number | null
  firstSentenceStartedAt: number | null
  lastSentenceCompletedAt: number | null
  totalDurationMs: number | null
}

export interface TTSStatus {
  state: TTSState
  isSpeaking: boolean
  providerId?: string
  providerName?: string
  selectedVoice: TTSVoice | null
  isVietnameseSupported: boolean
  warning: string | null
  error: string | null
  latencyMs: number | null
  progress?: TTSQueueProgress
  metrics?: TTSQueueMetrics
}

export interface FormattedResponse {
  uiText: string
  ttsText: string
  sentences: string[]
}
