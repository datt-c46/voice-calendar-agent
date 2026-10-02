import React from 'react'
import { AgentExecutionResult, PipelineLatency } from '../hooks/useVoiceActivity'

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
  ttsProgress?: import('../services/tts/types').TTSQueueProgress
  onStopSpeaking?: () => void
  onSpeakAgain?: () => void
  onClear: () => void
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
  if (!isTranscribing && !isProcessing && !transcription) {
    return null
  }

  const renderLatencyText = (): string => {
    if (!pipelineLatency) {
      return latencyMs !== null ? `⏱ STT: ${latencyMs}ms` : ''
    }
    const parts = [`STT: ${pipelineLatency.sttMs}ms`, `Agent: ${pipelineLatency.agentMs}ms`]
    if (pipelineLatency.ttfsMs !== undefined && pipelineLatency.ttfsMs > 0) {
      parts.push(`TTFS: ${pipelineLatency.ttfsMs}ms`)
    }
    if (pipelineLatency.ttfaMs !== undefined && pipelineLatency.ttfaMs > 0) {
      parts.push(`TTFA: ${pipelineLatency.ttfaMs}ms`)
    }
    if (pipelineLatency.ttsMs !== undefined) {
      parts.push(`TTS: ${pipelineLatency.ttsMs}ms`)
    }
    parts.push(`Tổng: ${pipelineLatency.totalMs}ms`)
    return `⏱ ${parts.join(' | ')}`
  }

  return (
    <div className="transcription-card">
      <div className="transcription-header">
        <div className="transcription-title-row">
          <span className="transcription-icon">💬</span>
          <span className="transcription-title">Lệnh giọng nói (Voice Command):</span>
          {language && <span className="transcription-lang-badge">{language.toUpperCase()}</span>}

          {(pipelineLatency || latencyMs !== null) && (
            <span className="transcription-latency" title="Pipeline Latency Breakdown">
              {renderLatencyText()}
            </span>
          )}
        </div>

        {transcription && !isTranscribing && !isProcessing && (
          <button
            type="button"
            className="transcription-clear-btn"
            onClick={onClear}
            title="Clear transcription"
            aria-label="Clear transcription"
          >
            ✕ Xóa
          </button>
        )}
      </div>

      <div className="transcription-content-area">
        {isTranscribing && (
          <div className="transcription-loading">
            <span className="transcription-spinner">⏳</span>
            <span className="transcription-loading-text">
              Đang nhận diện giọng nói (Transcribing)...
            </span>
          </div>
        )}

        {isProcessing && (
          <div className="transcription-processing">
            <span className="transcription-spinner">⚡</span>
            <span className="transcription-processing-text">
              Đang xử lý qua Agent Orchestrator & Calendar...
            </span>
          </div>
        )}

        {transcription && (
          <div className="transcription-quote-box">
            <span className="transcription-quote-label">Bạn:</span>
            <blockquote className="transcription-quote">&ldquo;{transcription}&rdquo;</blockquote>
          </div>
        )}

        {agentResult && (
          <div className="transcription-agent-box">
            <div className="transcription-agent-header">
              <div className="transcription-agent-title-row">
                <span className="transcription-agent-label">🤖 Trợ lý:</span>
                {agentResult.intent && (
                  <span className="transcription-intent-badge">{agentResult.intent}</span>
                )}
                {isAssistantSpeaking && (
                  <span className="transcription-speaking-tag">
                    {ttsProgress && ttsProgress.totalSentences > 1
                      ? `🔊 Đang đọc (${ttsProgress.currentIndex + 1}/${ttsProgress.totalSentences})...`
                      : '🔊 Đang đọc...'}
                  </span>
                )}
              </div>

              <div className="transcription-tts-actions">
                {isAssistantSpeaking ? (
                  <button
                    type="button"
                    className="tts-btn tts-btn-stop"
                    onClick={onStopSpeaking}
                    title="Dừng đọc phản hồi"
                  >
                    ⏹ Dừng đọc
                  </button>
                ) : (
                  <button
                    type="button"
                    className="tts-btn tts-btn-replay"
                    onClick={onSpeakAgain}
                    title="Nghe lại phản hồi"
                  >
                    🔊 Nghe lại
                  </button>
                )}
              </div>
            </div>

            {ttsWarning && (
              <div className="transcription-tts-warning">
                <span className="tts-warning-icon">ℹ️</span>
                <span>{ttsWarning}</span>
              </div>
            )}

            <p className="transcription-agent-text">{agentResult.message}</p>
          </div>
        )}
      </div>

      <div className="transcription-footer-note">
        * Lệnh giọng nói được xử lý qua Agent Orchestrator và phản hồi bằng giọng đọc TTS (Milestone
        3.1).
      </div>
    </div>
  )
}
