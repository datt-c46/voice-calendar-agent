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
  // One always-present live region, so screen readers announce connection / sign-in changes.
  const announcement = unreachable
    ? 'Không kết nối được server'
    : signingIn
      ? 'Đang đăng nhập trên trình duyệt'
      : auth === null
        ? 'Đang kết nối server'
        : ''

  return (
    <header className="app-header">
      {/* The URL line is hidden on narrow windows; the tooltip keeps it reachable. */}
      <div
        className="brand"
        title={auth?.backendUrl ? `Máy chủ voice-backend: ${auth.backendUrl}` : undefined}
      >
        <h1 className="brand-title">Voice Calendar Agent</h1>
        <div className="brand-subtitle">voice-backend • {auth?.backendUrl ?? '…'}</div>
      </div>

      <div className="header-status">
        {auth === null && (
          <span className="status-item is-pending">
            <span className="status-dot" aria-hidden="true"></span>
            Đang kết nối server…
          </span>
        )}

        {unreachable && (
          <span className="status-item is-error" title={auth?.errorMessage}>
            <span className="status-dot" aria-hidden="true"></span>
            Không kết nối được server
          </span>
        )}

        {signingIn && (
          <span className="status-item is-pending">
            <span className="status-dot" aria-hidden="true"></span>
            <span className="status-text">Đang đăng nhập trên trình duyệt…</span>
            <button className="link-btn" onClick={onCancelSignIn} type="button">
              Hủy
            </button>
          </span>
        )}

        {auth !== null && !signedIn && !signingIn && (
          <span className="status-item sign-in-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={onSignInGoogle}
              type="button"
              title="Đăng nhập voice-backend bằng tài khoản Google (mở trình duyệt)"
            >
              Đăng nhập bằng Google
            </button>
            {auth.devLoginAvailable && (
              <button
                className="link-btn"
                onClick={onSignInDev}
                type="button"
                title="Đăng nhập thử bằng VOICE_BACKEND_DEV_EMAIL (server phải bật AUTH_DEV_LOGIN_ENABLED)"
              >
                Đăng nhập dev
              </button>
            )}
          </span>
        )}

        {signedIn && (
          <span className="status-item account is-ok">
            <span className="status-dot" aria-hidden="true"></span>
            <span className="user-email" title={auth.userEmail ?? undefined}>
              {auth.userEmail ?? 'Đã đăng nhập'}
            </span>
            <button
              className="link-btn"
              onClick={onSignOut}
              title="Đăng xuất khỏi voice-backend"
              type="button"
            >
              Đăng xuất
            </button>
          </span>
        )}

        {signedIn && mode && (
          <span className={`status-item calendar${calendar?.reauthRequired ? ' is-warn' : ''}`}>
            <span className="status-label">
              {mode === 'google' ? 'GOOGLE CALENDAR' : 'LỊCH LOCAL'}
            </span>
            {calendar?.reauthRequired && (
              <button
                className="link-btn"
                onClick={onSignInGoogle}
                title="Quyền Google đã mất, đăng nhập lại"
                type="button"
              >
                Kết nối lại Google
              </button>
            )}
            {mode === 'google' && !calendar?.reauthRequired && (
              <button
                className="link-btn"
                onClick={onDisconnectGoogle}
                title="Thu hồi quyền Google, chuyển sang lịch local trên server"
                type="button"
              >
                Ngắt Google
              </button>
            )}
            {mode === 'local' && googleAvailable && !signingIn && (
              <button
                className="link-btn"
                onClick={onSignInGoogle}
                title="Đăng nhập bằng Google để dùng Google Calendar"
                type="button"
              >
                Kết nối Google
              </button>
            )}
          </span>
        )}

        {calendar?.timeZone && (
          <span className="status-item timezone" title="Múi giờ của lịch">
            {calendar.timeZone}
          </span>
        )}
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </header>
  )
}
