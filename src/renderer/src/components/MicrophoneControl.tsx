import React from 'react'
import { useVoiceActivity, AgentExecutionResult } from '../hooks/useVoiceActivity'
import { VoiceActivityIndicator } from './VoiceActivityIndicator'
import { TranscriptionDisplay } from './TranscriptionDisplay'

interface MicrophoneControlProps {
  onVoiceCommand?: (text: string) => Promise<AgentExecutionResult | undefined>
  /** Signed out: listening would only produce errors. */
  disabled?: boolean
}

export const MicrophoneControl: React.FC<MicrophoneControlProps> = ({
  onVoiceCommand,
  disabled
}) => {
  const {
    vadState,
    isSpeechDetected,
    start,
    stop,
    audioLevel,
    error,
    speechCount,
    lastSpeechInfo,
    transcription,
    transcriptionLatencyMs,
    transcriptionLanguage,
    agentResult,
    pipelineLatency,
    clearTranscription,
    isAssistantSpeaking,
    ttsWarning,
    ttsProgress,
    stopSpeaking,
    speakResponse
  } = useVoiceActivity({ onVoiceCommand })

  const isActive =
    vadState === 'listening' ||
    vadState === 'speaking' ||
    vadState === 'speech-ended' ||
    vadState === 'transcribing' ||
    vadState === 'processing' ||
    vadState === 'speaking-assistant' ||
    vadState === 'success'

  const isInitializing = vadState === 'initializing'
  const isTranscribing = vadState === 'transcribing'
  const isProcessing = vadState === 'processing'

  const levelPct = Math.round(Math.min(Math.max(audioLevel, 0), 1) * 100)

  return (
    <section className="mic-control-card" aria-label="Điều khiển giọng nói">
      <h2 className="panel-title">Giọng nói</h2>

      <div className="voice-bar">
        <VoiceActivityIndicator
          vadState={vadState}
          isSpeechDetected={isSpeechDetected}
          speechCount={speechCount}
          lastSpeechInfo={lastSpeechInfo}
          signedOut={disabled}
        />

        <div
          className={`mic-level${isActive ? ' is-active' : ''}${audioLevel > 0.85 ? ' is-loud' : ''}`}
          role="meter"
          aria-label="Mức âm thanh"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={levelPct}
          title={`Mức âm thanh: ${levelPct}%`}
        >
          <span className="mic-level-fill" style={{ width: `${levelPct}%` }} />
        </div>

        {isActive ? (
          <button type="button" className="btn mic-btn mic-btn-stop" onClick={stop}>
            <span className="mic-btn-icon icon-stop" aria-hidden="true"></span>
            <span>Dừng nghe</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn mic-btn mic-btn-start"
            onClick={start}
            disabled={isInitializing || disabled}
            title={disabled ? 'Hãy đăng nhập trước' : undefined}
          >
            <MicIcon />
            <span>{isInitializing ? 'Đang mở…' : 'Bắt đầu nghe'}</span>
          </button>
        )}
      </div>

      {error && (
        <div className="notice notice-error mic-error-banner" role="alert">
          {error}
        </div>
      )}

      {/* Always present, so the TTS fallback warning shown below is also announced. */}
      <div className="sr-only" role="status" aria-live="polite">
        {agentResult && ttsWarning ? ttsWarning : ''}
      </div>

      <TranscriptionDisplay
        transcription={transcription}
        isTranscribing={isTranscribing}
        isProcessing={isProcessing}
        latencyMs={transcriptionLatencyMs}
        pipelineLatency={pipelineLatency}
        language={transcriptionLanguage}
        agentResult={agentResult}
        isAssistantSpeaking={isAssistantSpeaking}
        ttsWarning={ttsWarning}
        ttsProgress={ttsProgress}
        onStopSpeaking={stopSpeaking}
        onSpeakAgain={() => speakResponse()}
        onClear={clearTranscription}
      />
    </section>
  )
}

const MicIcon: React.FC = () => (
  <svg
    className="mic-btn-icon"
    viewBox="0 0 16 16"
    width="14"
    height="14"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" fill="none" stroke="currentColor" />
    <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" fill="none" stroke="currentColor" />
  </svg>
)
