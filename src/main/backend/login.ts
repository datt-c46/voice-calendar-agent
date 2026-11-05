import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { TokenResponse } from '../../shared/backend'
import type { BackendClient } from './backend-client'
import { ApiError, type FetchLike, send, toApiError } from './http'

export const LOGIN_TIMEOUT_MS = 120_000
const CALLBACK_PATH = '/callback'

/** `code`: the `error` sent back by the backend (access_denied, unverified_email, …), SIGN_IN_TIMEOUT or SIGN_IN_CANCELLED. */
export class LoginError extends Error {
  constructor(readonly code: string) {
    super(`Google sign-in failed: ${code}`)
    this.name = 'LoginError'
  }
}

export interface GoogleLoginDeps {
  client: Pick<BackendClient, 'apiUrl' | 'publicRequest'>
  /** Opens the URL in the system browser (`shell.openExternal`). */
  openExternal(url: string): Promise<void>
  fetch?: FetchLike
  timeoutMs?: number
  signal?: AbortSignal
}

export function createPkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url') // 43 chars of [A-Za-z0-9_-]
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url') // exactly 43 chars
  return { codeVerifier, codeChallenge }
}

function page(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(
    `<!doctype html><meta charset="utf-8"><title>Voice Calendar Agent</title>` +
      `<body style="font-family:sans-serif;padding:3rem;text-align:center"><p>${text}</p></body>`
  )
}

/**
 * RFC 8252 sign-in: system browser + loopback listener + PKCE, against voice-backend's `/auth/google/login`.
 *
 * The login URL is requested by the main process first (redirect: manual) so configuration errors such as
 * `503 GOOGLE_NOT_CONFIGURED` surface in the app immediately; only the resulting Google URL is opened in the browser.
 * The backend binds nothing to the browser (no cookie), so this is equivalent to opening the backend URL directly.
 */
export async function signInWithGoogle(deps: GoogleLoginDeps): Promise<TokenResponse> {
  const fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init))
  const { codeVerifier, codeChallenge } = createPkce()
  const state = randomBytes(16).toString('hex')

  const server = http.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve()) // random free port, IPv4 loopback only
  })
  const { port } = server.address() as AddressInfo
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`
  let timer: NodeJS.Timeout | undefined
  let onAbort: (() => void) | undefined

  try {
    const code = await new Promise<string>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new LoginError('SIGN_IN_TIMEOUT')),
        deps.timeoutMs ?? LOGIN_TIMEOUT_MS
      )
      onAbort = () => reject(new LoginError('SIGN_IN_CANCELLED'))
      if (deps.signal?.aborted) onAbort()
      deps.signal?.addEventListener('abort', onAbort, { once: true })

      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri)
        // Ignore favicon and anything that is not the answer to THIS sign-in attempt.
        if (
          req.method !== 'GET' ||
          url.pathname !== CALLBACK_PATH ||
          url.searchParams.get('state') !== state
        ) {
          page(res, 404, 'Not found')
          return
        }
        const error = url.searchParams.get('error')
        const loginCode = url.searchParams.get('code')
        if (error || !loginCode) {
          page(res, 400, 'Đăng nhập thất bại. Hãy quay lại ứng dụng Voice Calendar Agent.')
          reject(new LoginError(error && /^[a-z_]{1,64}$/.test(error) ? error : 'server_error'))
          return
        }
        page(res, 200, 'Đăng nhập thành công. Bạn có thể đóng tab này và quay lại ứng dụng.')
        resolve(loginCode)
      })

      const loginUrl = new URL(`${deps.client.apiUrl}/auth/google/login`)
      loginUrl.search = new URLSearchParams({
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state
      }).toString()

      void (async () => {
        const res = await send(fetchImpl, loginUrl.toString(), {
          method: 'GET',
          redirect: 'manual',
          timeoutMs: 15_000
        })
        if (res.status < 300 || res.status >= 400) throw await toApiError(res)
        const location = res.headers.get('location')
        const target = location ? new URL(location, loginUrl) : null
        if (!target || (target.protocol !== 'https:' && target.protocol !== 'http:')) {
          throw new ApiError(
            502,
            'UPSTREAM_ERROR',
            'voice-backend returned an invalid sign-in redirect'
          )
        }
        await deps.openExternal(target.toString())
      })().catch(reject)
    })

    // The login code is single-use and lives 120 s; redirectUri must equal the one sent to /auth/google/login.
    return await deps.client.publicRequest<TokenResponse>('POST', '/auth/token', {
      grantType: 'authorization_code',
      code,
      codeVerifier,
      redirectUri
    })
  } finally {
    clearTimeout(timer)
    if (onAbort) deps.signal?.removeEventListener('abort', onAbort)
    server.close()
    server.closeIdleConnections()
    // Give the browser a moment to receive the result page before cutting keep-alive sockets.
    setTimeout(() => server.closeAllConnections(), 1_000).unref()
  }
}
