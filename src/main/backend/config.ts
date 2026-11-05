export const DEFAULT_BACKEND_URL = 'http://localhost:4000'

export interface BackendConfig {
  /** Origin (+ optional path prefix) of voice-backend, without trailing slash. */
  baseUrl: string
  /** `${baseUrl}/api/v1` */
  apiUrl: string
  /** Email for `POST /auth/dev-login` (development servers only); null hides the dev sign-in button. */
  devLoginEmail: string | null
  /** Set when VOICE_BACKEND_URL was present but unusable (the default is used instead). */
  warning: string | null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Reads VOICE_BACKEND_URL / VOICE_BACKEND_DEV_EMAIL. Only http(s) URLs without credentials are accepted. */
export function resolveBackendConfig(env: Record<string, string | undefined>): BackendConfig {
  let warning: string | null = null
  let baseUrl = DEFAULT_BACKEND_URL
  const raw = env['VOICE_BACKEND_URL']?.trim()
  if (raw) {
    try {
      const url = new URL(raw)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
      if (url.username || url.password || url.search || url.hash) throw new Error('extra parts')
      baseUrl = `${url.origin}${url.pathname}`.replace(/\/+$/, '')
    } catch {
      warning = `VOICE_BACKEND_URL is not a valid http(s) URL; using ${DEFAULT_BACKEND_URL}`
    }
  }
  const email = env['VOICE_BACKEND_DEV_EMAIL']?.trim() ?? ''
  return {
    baseUrl,
    apiUrl: `${baseUrl}/api/v1`,
    devLoginEmail: EMAIL.test(email) && email.length <= 254 ? email : null,
    warning
  }
}
