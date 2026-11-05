import React, { useState } from 'react'
import { AgentExecutionResult, PipelineLatency } from '../hooks/useVoiceActivity'
import type { TTSQueueProgress } from '../services/tts/types'
import { intentLabel } from '../utils/intentLabel'

interface TranscriptionDisplayProps {
  transcription: string | null
  isTranscribing: boolean
  isProcessing: boolean
  latencyMs: number | null
  pipelineLatency: PipelineLatency | null
  language?: string
  agentResult: AgentExecutionResult | null
  isAssistantSpeaking?: boolean
  ttsWarning?: string | null
  ttsProgress?: TTSQueueProgress
  onStopSpeaking?: () => void
  onSpeakAgain?: () => void
  onClear: () => void
}

function latencyText(pipelineLatency: PipelineLatency | null, latencyMs: number | null): string {
  if (!pipelineLatency) return latencyMs !== null ? `STT ${latencyMs} ms` : ''
  const parts = [`STT ${pipelineLatency.sttMs} ms`, `Agent ${pipelineLatency.agentMs} ms`]
  if (pipelineLatency.ttfsMs !== undefined && pipelineLatency.ttfsMs > 0) {
    parts.push(`TTFS ${pipelineLatency.ttfsMs} ms`)
  }
  if (pipelineLatency.ttfaMs !== undefined && pipelineLatency.ttfaMs > 0) {
    parts.push(`TTFA ${pipelineLatency.ttfaMs} ms`)
  }
  if (pipelineLatency.ttsMs !== undefined) parts.push(`TTS ${pipelineLatency.ttsMs} ms`)
  parts.push(`Tổng ${pipelineLatency.totalMs} ms`)
  return parts.join(' · ')
}

export const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({
  transcription,
  isTranscribing,
  isProcessing,
  latencyMs,
  pipelineLatency,
  language,
  agentResult,
  isAssistantSpeaking,
  ttsWarning,
  ttsProgress,
  onStopSpeaking,
  onSpeakAgain,
  onClear
}) => {
  const [showDetails, setShowDetails] = useState(false)

  if (!isTranscribing && !isProcessing && !transcription) {
    return null
  }

  const latency = latencyText(pipelineLatency, latencyMs)
  const hasDetails = !!latency || !!agentResult?.message
  const settled = !!transcription && !isTranscribing && !isProcessing

  return (
    <div className="transcription-card">
      {isTranscribing && <div className="transcription-progress">Đang nhận dạng giọng nói…</div>}
      {isProcessing && <div className="transcription-progress">Đang xử lý lệnh…</div>}

      {transcription && (
        <div className="transcription-row">
          <span className="transcription-label">Bạn nói</span>
          <q className="transcription-quote" title={transcription}>
            {transcription}
          </q>
          {language && <span className="transcription-lang">{language.toUpperCase()}</span>}
          {settled && (
            <span className="transcription-tools">
              {hasDetails && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setShowDetails((v) => !v)}
                  aria-expanded={showDetails}
                >
                  {showDetails ? 'Ẩn chi tiết' : 'Chi tiết'}
                </button>
              )}
              <button
                type="button"
                className="link-btn transcription-clear-btn"
                onClick={onClear}
                title="Xóa nội dung lệnh giọng nói"
              >
                Xóa
              </button>
            </span>
          )}
        </div>
      )}

      {agentResult && (
        <div className="transcription-row">
          <span className="transcription-label">Trợ lý</span>
          {agentResult.intent && (
            <span className="transcription-intent" title={agentResult.intent}>
              {intentLabel(agentResult.intent)}
            </span>
          )}
          {isAssistantSpeaking && (
            <span className="transcription-speaking">
              {ttsProgress && ttsProgress.totalSentences > 1
                ? `Đang đọc ${ttsProgress.currentIndex + 1}/${ttsProgress.totalSentences}`
                : 'Đang đọc'}
            </span>
          )}
          <span className="transcription-tools">
            {isAssistantSpeaking ? (
              <button
                type="button"
                className="btn btn-sm tts-btn tts-btn-stop"
                onClick={onStopSpeaking}
                title="Dừng đọc phản hồi"
              >
                Dừng đọc
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-sm tts-btn tts-btn-replay"
                onClick={onSpeakAgain}
                title="Nghe lại phản hồi"
              >
                Nghe lại
              </button>
            )}
          </span>
        </div>
      )}

      {agentResult && ttsWarning && (
        <div className="notice notice-warn transcription-tts-warning">{ttsWarning}</div>
      )}

      {showDetails && hasDetails && (
        <div className="transcription-details">
          {latency && (
            <div className="transcription-latency" title="Độ trễ từng bước của pipeline">
              {latency}
            </div>
          )}
          {agentResult?.message && (
            <p className="transcription-agent-text">{agentResult.message}</p>
          )}
        </div>
      )}
    </div>
  )
}
