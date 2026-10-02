import React from 'react'

export type AuthState = 'NOT_CONFIGURED' | 'DISCONNECTED' | 'AUTHENTICATING' | 'CONNECTED' | 'ERROR'

export interface HeaderProps {
  mode: string
  timeZone: string
  eventCount: number
  authState: AuthState
  userEmail?: string | null
  authError?: string
  onConnect: () => void
  onDisconnect: () => void
}

export const Header: React.FC<HeaderProps> = ({
  mode,
  timeZone,
  eventCount,
  authState,
  userEmail,
  authError,
  onConnect,
  onDisconnect
}) => {
  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-icon">🎙️</div>
        <div className="brand-text">
          <h1>Voice Calendar Agent</h1>
          <div className="brand-subtitle">Milestone 1.5 • Google & Mock Mode</div>
        </div>
      </div>

      <div className="header-status">
        {/* Google OAuth Connection Section */}
        {authState === 'CONNECTED' && (
          <div className="badge google">
            <span className="badge-dot google"></span>
            <span className="user-email">Google: {userEmail || 'Connected'}</span>
            <button
              className="auth-link-btn"
              onClick={onDisconnect}
              title="Ngắt kết nối Google Calendar"
              type="button"
            >
              [Disconnect]
            </button>
          </div>
        )}

        {authState === 'AUTHENTICATING' && (
          <div className="badge authenticating">
            <span className="badge-dot pulse"></span>
            <span>Đang xác thực trên trình duyệt...</span>
          </div>
        )}

        {authState === 'DISCONNECTED' && (
          <button
            className="auth-connect-btn"
            onClick={onConnect}
            type="button"
            title="Kết nối tài khoản Google Calendar thật"
          >
            <span className="g-icon">📅</span>
            <span>Connect Google Calendar</span>
          </button>
        )}

        {authState === 'NOT_CONFIGURED' && (
          <div className="badge not-configured" title="Chưa cấu hình GOOGLE_CLIENT_ID trong .env">
            <span>⚙️ Google Chưa cấu hình</span>
          </div>
        )}

        {authState === 'ERROR' && (
          <div className="badge auth-error" title={authError || 'Lỗi xác thực'}>
            <span>⚠️ Lỗi kết nối</span>
            <button className="auth-link-btn" onClick={onConnect} type="button">
              [Thử lại]
            </button>
          </div>
        )}

        {/* Calendar Mode & Event Count */}
        <div className={`badge ${mode === 'google' ? 'google' : 'mock'}`}>
          <span className="badge-dot"></span>
          <span>
            {mode.toUpperCase()} ({eventCount} events)
          </span>
        </div>

        <div className="badge timezone">
          <span>🌐 {timeZone}</span>
        </div>
      </div>
    </header>
  )
}
