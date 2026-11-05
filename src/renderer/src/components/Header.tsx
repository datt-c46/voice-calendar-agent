import React from 'react'
import type { AuthStatusDTO, CalendarStatusDTO } from '../../../shared/ipc'

export interface HeaderProps {
  /** null while the first status is loading. */
  auth: AuthStatusDTO | null
  calendar: CalendarStatusDTO | null
  signingIn: boolean
  onSignInGoogle: () => void
  onSignInDev: () => void
  onCancelSignIn: () => void
  onSignOut: () => void
  onDisconnectGoogle: () => void
}

export const Header: React.FC<HeaderProps> = ({
  auth,
  calendar,
  signingIn,
  onSignInGoogle,
  onSignInDev,
  onCancelSignIn,
  onSignOut,
  onDisconnectGoogle
}) => {
  const signedIn = auth?.isAuthenticated === true
  const unreachable = auth?.error === 'BACKEND_UNREACHABLE'
  const mode = calendar?.mode ?? auth?.calendarProvider ?? null
  const googleAvailable = auth?.isConfigured !== false

  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-icon">🎙️</div>
        <div className="brand-text">
          <h1>Voice Calendar Agent</h1>
          <div className="brand-subtitle" title="VOICE_BACKEND_URL">
            voice-backend • {auth?.backendUrl ?? '…'}
          </div>
        </div>
      </div>

      <div className="header-status">
        {auth === null && (
          <div className="badge authenticating">
            <span className="badge-dot pulse"></span>
            <span>Đang kết nối server...</span>
          </div>
        )}

        {unreachable && (
          <div className="badge auth-error" title={auth?.errorMessage}>
            <span>⚠️ Không kết nối được server</span>
          </div>
        )}

        {signingIn && (
          <div className="badge authenticating">
            <span className="badge-dot pulse"></span>
            <span>Đang đăng nhập trên trình duyệt...</span>
            <button className="auth-link-btn" onClick={onCancelSignIn} type="button">
              [Hủy]
            </button>
          </div>
        )}

        {auth !== null && !signedIn && !signingIn && (
          <>
            <button
              className="auth-connect-btn"
              onClick={onSignInGoogle}
              type="button"
              title="Đăng nhập voice-backend bằng tài khoản Google (mở trình duyệt)"
            >
              <span className="g-icon">📅</span>
              <span>Đăng nhập bằng Google</span>
            </button>
            {auth.devLoginAvailable && (
              <button
                className="auth-link-btn"
                onClick={onSignInDev}
                type="button"
                title="Đăng nhập thử bằng VOICE_BACKEND_DEV_EMAIL (server phải bật AUTH_DEV_LOGIN_ENABLED)"
              >
                [Đăng nhập dev]
              </button>
            )}
          </>
        )}

        {signedIn && (
          <div className={`badge ${auth.googleConnected ? 'google' : 'mock'}`}>
            <span className={`badge-dot ${auth.googleConnected ? 'google' : ''}`}></span>
            <span className="user-email">{auth.userEmail ?? 'Đã đăng nhập'}</span>
            <button
              className="auth-link-btn"
              onClick={onSignOut}
              title="Đăng xuất khỏi voice-backend"
              type="button"
            >
              [Đăng xuất]
            </button>
          </div>
        )}

        {signedIn && mode && (
          <div className={`badge ${mode === 'google' ? 'google' : 'mock'}`}>
            <span className="badge-dot"></span>
            <span>{mode === 'google' ? 'GOOGLE CALENDAR' : 'LỊCH LOCAL'}</span>
            {calendar?.reauthRequired && (
              <button
                className="auth-link-btn"
                onClick={onSignInGoogle}
                title="Quyền Google đã mất, đăng nhập lại"
                type="button"
              >
                [Kết nối lại Google]
              </button>
            )}
            {mode === 'google' && !calendar?.reauthRequired && (
              <button
                className="auth-link-btn"
                onClick={onDisconnectGoogle}
                title="Thu hồi quyền Google, chuyển sang lịch local trên server"
                type="button"
              >
                [Ngắt Google]
              </button>
            )}
            {mode === 'local' && googleAvailable && !signingIn && (
              <button
                className="auth-link-btn"
                onClick={onSignInGoogle}
                title="Đăng nhập bằng Google để dùng Google Calendar"
                type="button"
              >
                [Kết nối Google]
              </button>
            )}
          </div>
        )}

        {calendar?.timeZone && (
          <div className="badge timezone">
            <span>🌐 {calendar.timeZone}</span>
          </div>
        )}
      </div>
    </header>
  )
}
