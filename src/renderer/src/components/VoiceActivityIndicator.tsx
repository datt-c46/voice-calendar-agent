import React from 'react'
import { VadState, LastSpeechInfo } from '../hooks/useVoiceActivity'

interface VoiceActivityIndicatorProps {
  vadState: VadState
  isSpeechDetected: boolean
  speechCount?: number
  lastSpeechInfo?: LastSpeechInfo | null
  /** Signed out: the mic button is disabled, so say why instead of "ready". */
  signedOut?: boolean
}

/** Colour of the status dot; each tone carries a meaning (see main.css `.tone-*`). */
type Tone = 'idle' | 'busy' | 'active' | 'live' | 'ok' | 'error'

interface VadView {
  tone: Tone
  mainText: string
  subText: string
}

const VAD_VIEWS: Record<VadState, VadView> = {
  idle: {
    tone: 'idle',
    mainText: 'Micro sẵn sàng',
    subText: 'Bấm “Bắt đầu nghe” để ra lệnh bằng giọng nói'
  },
  initializing: { tone: 'busy', mainText: 'Đang khởi động…', subText: 'Đang tải mô hình VAD' },
  listening: { tone: 'active', mainText: 'Đang nghe', subText: 'Chưa phát hiện giọng nói' },
  speaking: { tone: 'live', mainText: 'Đang thu giọng nói', subText: 'Phát hiện giọng nói' },
  'speech-ended': { tone: 'ok', mainText: 'Đã thu xong', subText: 'Sẵn sàng cho lệnh tiếp theo' },
  transcribing: {
    tone: 'busy',
    mainText: 'Đang nhận dạng…',
    subText: 'Chuyển giọng nói thành văn bản'
  },
  processing: { tone: 'busy', mainText: 'Đang xử lý…', subText: 'Đang thực hiện thao tác lịch' },
  'speaking-assistant': {
    tone: 'active',
    mainText: 'Trợ lý đang đọc',
    subText: 'Micro tạm dừng để tránh thu lại tiếng loa'
  },
  success: { tone: 'ok', mainText: 'Hoàn tất', subText: 'Đã thực hiện thao tác lịch' },
  error: { tone: 'error', mainText: 'Lỗi giọng nói', subText: 'Không thể hoàn tất thao tác' }
}

const SIGNED_OUT_VIEW: VadView = {
  tone: 'idle',
  mainText: 'Chưa đăng nhập',
  subText: 'Đăng nhập để ra lệnh bằng giọng nói'
}

export const VoiceActivityIndicator: React.FC<VoiceActivityIndicatorProps> = ({
  vadState,
  isSpeechDetected,
  speechCount = 0,
  lastSpeechInfo = null,
  signedOut = false
}) => {
  const view =
    signedOut && vadState === 'idle' ? SIGNED_OUT_VIEW : (VAD_VIEWS[vadState] ?? VAD_VIEWS.idle)
  const tone: Tone = isSpeechDetected ? 'live' : view.tone

  return (
    <div className={`vad-status tone-${tone}`} role="status">
      <div className="vad-status-row">
        <span className="status-dot" aria-hidden="true"></span>
        <span className="vad-main-text">{view.mainText}</span>
        {speechCount > 0 && (
          <span className="vad-count" title="Số đoạn giọng nói đã phát hiện">
            {speechCount} đoạn
            {lastSpeechInfo && ` · ${lastSpeechInfo.durationMs} ms`}
          </span>
        )}
      </div>
      <div className="vad-subtext">{view.subText}</div>
    </div>
  )
}
