/**
 * Error codes crossing the IPC boundary. `ipcMain.handle` only keeps an Error's `message`, so main throws
 * `Error("<CODE>: <message>")` and the renderer recovers the code with `parseIpcError`.
 */

const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
  INVALID_GRANT: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
  GOOGLE_REAUTH_REQUIRED: 'Quyền truy cập Google Calendar đã mất. Hãy kết nối lại Google.',
  GOOGLE_NOT_CONFIGURED: 'Server chưa cấu hình đăng nhập Google.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Hãy thử lại sau ít giây.',
  STT_UNAVAILABLE: 'Server chưa bật nhận dạng giọng nói.',
  TTS_UNAVAILABLE: 'Server chưa bật giọng đọc.',
  UPSTREAM_ERROR: 'Dịch vụ bên ngoài đang lỗi. Hãy thử lại sau.',
  SERVICE_UNAVAILABLE: 'Server đang bận. Hãy thử lại sau.',
  PAYLOAD_TOO_LARGE: 'Nội dung quá dài.',
  UNSUPPORTED_MEDIA_TYPE: 'Định dạng âm thanh không được hỗ trợ.',
  VALIDATION_ERROR: 'Dữ liệu gửi lên không hợp lệ.',
  NOT_FOUND: 'Không tìm thấy dữ liệu.',
  BACKEND_UNREACHABLE: 'Không kết nối được tới server voice-backend.',
  TIMEOUT: 'Server phản hồi quá lâu. Hãy thử lại.',
  SIGN_IN_TIMEOUT: 'Hết thời gian chờ đăng nhập trên trình duyệt.',
  SIGN_IN_CANCELLED: 'Đã hủy đăng nhập.',
  DEV_LOGIN_UNAVAILABLE: 'Server không bật đăng nhập thử nghiệm (AUTH_DEV_LOGIN_ENABLED).',
  access_denied: 'Bạn đã từ chối cấp quyền Google.',
  unverified_email: 'Email Google chưa được xác minh.',
  account_conflict: 'Email này đã gắn với một tài khoản Google khác.',
  temporarily_unavailable: 'Dịch vụ đăng nhập tạm thời không khả dụng.',
  server_error: 'Đăng nhập thất bại do lỗi server.'
}

export function describeError(code: string | undefined, fallback?: string): string {
  if (code && Object.hasOwn(MESSAGES, code)) return MESSAGES[code]
  return fallback || (code ? `Lỗi: ${code}` : 'Đã xảy ra lỗi không xác định.')
}

const IPC_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/

/** `Error invoking remote method 'x': Error: RATE_LIMITED: Too many requests` → `{ code: 'RATE_LIMITED', … }`. */
export function parseIpcError(error: unknown): { code: string | undefined; message: string } {
  const raw = (error instanceof Error ? error.message : String(error)).replace(IPC_PREFIX, '')
  const match = /^([A-Za-z_]{3,}): ([\s\S]*)$/.exec(raw)
  if (match && (Object.hasOwn(MESSAGES, match[1]) || /^[A-Z][A-Z_]+$/.test(match[1]))) {
    return { code: match[1], message: describeError(match[1], match[2]) }
  }
  return { code: undefined, message: raw || 'Đã xảy ra lỗi không xác định.' }
}
