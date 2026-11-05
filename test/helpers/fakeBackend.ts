/**
 * In-process HTTP stand-in for voice-backend's auth contract (token rotation with reuse detection, PKCE login,
 * Bearer checks), so the main-process client is tested over real sockets and real fetch.
 */
import { createHash } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { TokenResponse, UserDTO } from '../../src/shared/backend'

export interface RecordedRequest {
  method: string
  path: string
  headers: http.IncomingHttpHeaders
  body: string
}

export interface FakeBackend {
  baseUrl: string
  apiUrl: string
  requests: RecordedRequest[]
  /** Valid access tokens; delete one to simulate server-side expiry. */
  validAccess: Set<string>
  /** Live refresh tokens (rotated on use; reuse of a dead one fails with INVALID_GRANT). */
  liveRefresh: Set<string>
  revoked: string[]
  googleConfigured: boolean
  devLoginEnabled: boolean
  /** Return 401 GOOGLE_REAUTH_REQUIRED from /calendar/status. */
  googleReauth: boolean
  /** Extra latency for /auth/token (to overlap concurrent refreshes). */
  tokenDelayMs: number
  /** Location returned by /auth/google/login. */
  googleLocation: string
  /** PKCE data of the last /auth/google/login call. */
  lastLogin: { redirectUri: string; state: string; codeChallenge: string } | null
  issue(): TokenResponse
  /** What the backend callback does after Google answered: a single-use login code bound to redirect + PKCE. */
  issueLoginCode(redirectUri: string, codeChallenge: string): string
  count(path: string): number
  close(): Promise<void>
}

export const USER: UserDTO = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  displayName: 'Test User',
  avatarUrl: null,
  calendarProvider: 'local',
  googleConnected: false,
  settings: {
    timeZone: 'Asia/Bangkok',
    language: 'auto',
    ttsVoiceId: null,
    requireConfirmation: true
  },
  createdAt: '2026-11-05T00:00:00.000Z'
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function fail(res: http.ServerResponse, status: number, code: string, message = code): void {
  json(res, status, { error: { code, message, requestId: 'req-test' } })
}

export async function startFakeBackend(): Promise<FakeBackend> {
  let seq = 0
  const loginCodes = new Map<string, { redirectUri: string; codeChallenge: string }>()

  const fake: Omit<FakeBackend, 'baseUrl' | 'apiUrl' | 'close'> = {
    requests: [],
    validAccess: new Set(),
    liveRefresh: new Set(),
    revoked: [],
    googleConfigured: true,
    devLoginEnabled: true,
    googleReauth: false,
    tokenDelayMs: 0,
    googleLocation: 'https://accounts.google.test/o/oauth2/v2/auth?client_id=x',
    lastLogin: null,
    issue(): TokenResponse {
      seq++
      const accessToken = `access-${seq}`
      const refreshToken = `refresh-${seq}`
      fake.validAccess.add(accessToken)
      fake.liveRefresh.add(refreshToken)
      return {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: 900,
        refreshToken,
        refreshExpiresIn: 2592000,
        user: USER
      }
    },
    issueLoginCode(redirectUri: string, codeChallenge: string): string {
      const code = `login-code-${++seq}`
      loginCodes.set(code, { redirectUri, codeChallenge })
      return code
    },
    count(path: string): number {
      return fake.requests.filter((r) => r.path === path).length
    }
  }

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake')
      const body = Buffer.concat(chunks).toString('utf8')
      fake.requests.push({
        method: req.method ?? '',
        path: url.pathname,
        headers: req.headers,
        body
      })
      void route(req, res, url, body)
    })
  })

  const authed = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (token && fake.validAccess.has(token)) return true
    fail(res, 401, 'UNAUTHORIZED', 'Invalid or expired access token')
    return false
  }

  async function route(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    raw: string
  ): Promise<void> {
    const p = url.pathname.replace(/^\/api\/v1/, '')
    // Fastify rejects a JSON content-type with an empty body.
    if (req.headers['content-type']?.includes('application/json') && raw === '') {
      return fail(
        res,
        400,
        'VALIDATION_ERROR',
        'Body cannot be empty when content-type is set to application/json'
      )
    }
    const body = raw ? (JSON.parse(raw) as Record<string, string>) : {}

    if (req.method === 'POST' && p === '/auth/token') {
      if (fake.tokenDelayMs) await new Promise((r) => setTimeout(r, fake.tokenDelayMs))
      if (body.grantType === 'refresh_token') {
        if (!fake.liveRefresh.delete(body.refreshToken))
          return fail(res, 400, 'INVALID_GRANT', 'Refresh token reused')
        return json(res, 200, fake.issue())
      }
      const login = loginCodes.get(body.code)
      loginCodes.delete(body.code)
      const challenge = createHash('sha256')
        .update(body.codeVerifier ?? '')
        .digest('base64url')
      if (!login || login.redirectUri !== body.redirectUri || login.codeChallenge !== challenge) {
        return fail(res, 400, 'INVALID_GRANT', 'Bad login code')
      }
      return json(res, 200, fake.issue())
    }
    if (req.method === 'POST' && p === '/auth/logout') {
      fake.liveRefresh.delete(body.refreshToken)
      fake.revoked.push(body.refreshToken)
      res.writeHead(204).end()
      return
    }
    if (req.method === 'POST' && p === '/auth/dev-login') {
      if (!fake.devLoginEnabled) return fail(res, 404, 'NOT_FOUND', 'Route not found')
      return json(res, 200, fake.issue())
    }
    if (req.method === 'GET' && p === '/auth/google/login') {
      if (!fake.googleConfigured)
        return fail(res, 503, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured')
      const q = url.searchParams
      fake.lastLogin = {
        redirectUri: q.get('redirect_uri') ?? '',
        state: q.get('state') ?? '',
        codeChallenge: q.get('code_challenge') ?? ''
      }
      res.writeHead(302, { location: fake.googleLocation }).end()
      return
    }
    if (req.method === 'GET' && p === '/auth/status') {
      if (!authed(req, res)) return
      return json(res, 200, {
        isAuthenticated: true,
        isConfigured: fake.googleConfigured,
        userEmail: null,
        scopes: [],
        calendarProvider: 'local',
        googleConnected: false
      })
    }
    if (req.method === 'GET' && p === '/calendar/status') {
      if (!authed(req, res)) return
      if (fake.googleReauth)
        return fail(res, 401, 'GOOGLE_REAUTH_REQUIRED', 'Google access was revoked')
      return json(res, 200, { mode: 'local', connected: true, timeZone: 'Asia/Bangkok' })
    }
    if (req.method === 'POST' && /^\/agent\/actions\/[^/]+\/confirm$/.test(p)) {
      if (!authed(req, res)) return
      return json(res, 200, {
        success: true,
        message: 'Đã xóa lịch.',
        intent: 'CONFIRM_ACTION',
        language: 'vi',
        conversationId: '22222222-2222-4222-8222-222222222222',
        messageId: '33333333-3333-4333-8333-333333333333'
      })
    }
    if (req.method === 'POST' && p === '/agent/command') {
      if (!authed(req, res)) return
      return json(res, 200, {
        success: true,
        message: `echo: ${body.text}`,
        intent: 'UNKNOWN',
        language: 'vi',
        conversationId: body.conversationId ?? '22222222-2222-4222-8222-222222222222',
        messageId: '33333333-3333-4333-8333-333333333333'
      })
    }
    return fail(res, 404, 'NOT_FOUND', 'Route not found')
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${port}`
  return Object.assign(fake, {
    baseUrl,
    apiUrl: `${baseUrl}/api/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  })
}
