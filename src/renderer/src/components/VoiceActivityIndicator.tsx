import React from 'react'
import { VadState, LastSpeechInfo } from '../hooks/useVoiceActivity'

interface VoiceActivityIndicatorProps {
  vadState: VadState
  isSpeechDetected: boolean
  speechCount?: number
  lastSpeechInfo?: LastSpeechInfo | null
}

export const VoiceActivityIndicator: React.FC<VoiceActivityIndicatorProps> = ({
  vadState,
  isSpeechDetected,
  speechCount = 0,
  lastSpeechInfo = null
}) => {
  const getVadConfig = (): {
    badge: string
    badgeColor: string
    mainText: string
    subText: string
    icon: string
    pulsing?: boolean
  } => {
    switch (vadState) {
      case 'idle':
        return {
          badge: 'Ready',
          badgeColor: '#9ca3af',
          mainText: 'Microphone Ready',
          subText: 'Ready to listen',
          icon: '🎙'
        }
      case 'initializing':
        return {
          badge: 'Initializing',
          badgeColor: '#f59e0b',
          mainText: 'Initializing VAD...',
          subText: 'Loading Silero ONNX model...',
          icon: '⏳'
        }
      case 'listening':
        return {
          badge: 'Listening',
          badgeColor: '#06b6d4',
          mainText: 'Listening',
          subText: 'No speech detected',
          icon: '🎙'
        }
      case 'speaking':
        return {
          badge: 'Speaking',
          badgeColor: '#f43f5e',
          mainText: 'Speaking...',
          subText: 'Voice activity detected',
          icon: '🔴',
          pulsing: true
        }
      case 'transcribing':
        return {
          badge: 'Transcribing',
          badgeColor: '#8b5cf6',
          mainText: 'Transcribing audio...',
          subText: 'Converting speech to text via STT...',
          icon: '⏳',
          pulsing: true
        }
      case 'processing':
        return {
          badge: 'Processing',
          badgeColor: '#3b82f6',
          mainText: 'Processing with Agent...',
          subText: 'Executing calendar operation...',
          icon: '⚡',
          pulsing: true
        }
      case 'speaking-assistant':
        return {
          badge: 'Speaking (Assistant)',
          badgeColor: '#a855f7',
          mainText: 'Assistant Speaking...',
          subText: 'Đang đọc phản hồi (Mic tạm dừng tránh phản xạ)...',
          icon: '🔊',
          pulsing: true
        }
      case 'success':
        return {
          badge: 'Success',
          badgeColor: '#10b981',
          mainText: 'Execution complete',
          subText: 'Calendar operation completed',
          icon: '✓'
        }
      case 'speech-ended':
        return {
          badge: 'Detected',
          badgeColor: '#10b981',
          mainText: 'Speech detected',
          subText: 'Ready for next input',
          icon: '✓'
        }
      case 'error':
        return {
          badge: 'Error',
          badgeColor: '#f43f5e',
          mainText: 'Voice/Agent error',
          subText: 'Operation could not be completed',
          icon: '⚠'
        }
      default:
        return {
          badge: 'Ready',
          badgeColor: '#9ca3af',
          mainText: 'Microphone Ready',
          subText: 'Ready to listen',
          icon: '🎙'
        }
    }
  }

  const { badge, badgeColor, mainText, subText, icon, pulsing } = getVadConfig()

  return (
    <div className="vad-indicator-box">
      <div className="vad-status-row">
        <div className="vad-main-indicator">
          <span
            className={`vad-indicator-dot ${pulsing || isSpeechDetected ? 'pulsing' : ''}`}
            style={{ backgroundColor: badgeColor }}
          />
          <span className="vad-icon">{icon}</span>
          <span className="vad-main-text" style={{ color: pulsing ? badgeColor : undefined }}>
            {mainText}
          </span>
          <span
            className="vad-badge"
            style={{
              borderColor: badgeColor,
              color: badgeColor,
              backgroundColor: `${badgeColor}15`
            }}
          >
            {badge}
          </span>
        </div>

        {speechCount > 0 && (
          <div className="vad-count-badge" title="Number of detected speech segments">
            Segments: <strong>{speechCount}</strong>
            {lastSpeechInfo && (
              <span className="vad-last-duration"> ({lastSpeechInfo.durationMs}ms)</span>
            )}
          </div>
        )}
      </div>

      <div className="vad-subtext-row">
        <span className="vad-subtext">{subText}</span>
      </div>
    </div>
  )
}
