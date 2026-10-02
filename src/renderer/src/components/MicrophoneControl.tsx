import React from 'react'
import { useVoiceActivity, AgentExecutionResult } from '../hooks/useVoiceActivity'
import { VoiceActivityIndicator } from './VoiceActivityIndicator'
import { TranscriptionDisplay } from './TranscriptionDisplay'

interface MicrophoneControlProps {
  onVoiceCommand?: (text: string) => Promise<AgentExecutionResult | undefined>
}

export const MicrophoneControl: React.FC<MicrophoneControlProps> = ({ onVoiceCommand }) => {
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

  // Format text representation of the volume meter for testing: [████████──]
  const meterSegments = 10
  const activeSegments = Math.round(audioLevel * meterSegments)
  const textMeter = `[${'█'.repeat(activeSegments)}${'─'.repeat(meterSegments - activeSegments)}]`

  return (
    <div className="mic-control-card">
      <div className="mic-header">
        <VoiceActivityIndicator
          vadState={vadState}
          isSpeechDetected={isSpeechDetected}
          speechCount={speechCount}
          lastSpeechInfo={lastSpeechInfo}
        />

        <div className="mic-action-container">
          {isActive ? (
            <button
              type="button"
              className="mic-btn mic-btn-stop"
              onClick={stop}
              aria-label="Stop Listening"
            >
              <span className="mic-btn-icon">🔴</span>
              <span>Stop Listening</span>
            </button>
          ) : (
            <button
              type="button"
              className="mic-btn mic-btn-start"
              onClick={start}
              disabled={isInitializing}
              aria-label="Start Listening"
            >
              <span className="mic-btn-icon">{isInitializing ? '⏳' : '🎙'}</span>
              <span>{isInitializing ? 'Đang mở VAD...' : 'Start Listening'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Audio Level Meter (Independent M2.1 Visualization) */}
      <div className="mic-meter-container">
        <div className="mic-meter-label-row">
          <span className="mic-meter-title">Audio Level:</span>
          <span className="mic-text-meter" title={`Level: ${Math.round(audioLevel * 100)}%`}>
            {textMeter}
          </span>
          <span className="mic-meter-pct">{Math.round(audioLevel * 100)}%</span>
          {isSpeechDetected && <span className="mic-speaking-tag">🔴 Speaking</span>}
        </div>

        <div className="mic-meter-bar-track">
          <div
            className={`mic-meter-bar-fill ${isActive ? 'active' : ''}`}
            style={{
              width: `${Math.round(audioLevel * 100)}%`,
              backgroundColor:
                audioLevel > 0.75 ? '#f43f5e' : audioLevel > 0.4 ? '#f59e0b' : '#10b981'
            }}
          />
        </div>
      </div>

      {/* Transcription & Agent Execution Display Area (Milestones 2.3, 2.4, 3.1) */}
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

      {/* Error Banner */}
      {error && (
        <div className="mic-error-banner">
          <span className="mic-error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
