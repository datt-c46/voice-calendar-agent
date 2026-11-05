import type { TokenResponse, UserDTO } from '../../shared/backend'
import { ApiError, type FetchLike, readJson, send } from './http'
import { type SessionStore, type StoredSession, toStoredSession } from './session-store'

/** Refresh a bit before the access token expires (network latency). */
export const EXPIRY_MARGIN_MS = 30_000
export const DEFAULT_TIMEOUT_MS = 45_000

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface BackendClientDeps {
  /** `${baseUrl}/api/v1` */
  apiUrl: string
  store: SessionStore
  fetch?: FetchLike
  now?: () => number
  log?: (message: string, error?: unknown) => void
}

export interface RequestOptions {
  timeoutMs?: number
}

/**
 * The only holder of backend tokens (main process). Access tokens are refreshed on demand; concurrent refreshes are
 * collapsed into one request because the server treats a reused refresh token as theft and revokes the session family.
 */
export class BackendClient {
  readonly apiUrl: string
  #store: SessionStore
  #fetch: FetchLike
  #now: () => number
  #log: (message: string, error?: unknown) => void
  #session: StoredSession | null = null
  #refreshing: Promise<StoredSession> | null = null
  #listeners = new Set<() => void>()

  constructor(deps: BackendClientDeps) {
    this.apiUrl = deps.apiUrl
    this.#store = deps.store
    this.#fetch = deps.fetch ?? ((input, init) => fetch(input, init))
    this.#now = deps.now ?? Date.now
    this.#log = deps.log ?? ((message, error) => console.warn(message, error ?? ''))
  }

  async init(): Promise<void> {
    try {
      this.#session = await this.#store.load()
    } catch (error) {
      this.#log('[backend] could not load the stored session', error)
      this.#session = null
    }
  }

  get isSignedIn(): boolean {
    return this.#session !== null
  }

  get user(): UserDTO | null {
    return this.#session?.user ?? null
  }

  /** Called after sign-in, sign-out and when the server invalidates the session. */
  onSessionChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async signIn(tokens: TokenResponse): Promise<void> {
    const previous = this.#session
    this.#refreshing = null // a refresh of the previous session must not overwrite this one
    await this.#replace(toStoredSession(tokens, this.#now()))
    this.#emit()
    if (previous && previous.refreshToken !== tokens.refreshToken) {
      // Switching account / re-connecting Google: revoke the replaced session family (best effort).
      await this.publicRequest('POST', '/auth/logout', {
        refreshToken: previous.refreshToken
      }).catch((error) => this.#log('[backend] could not revoke the replaced session', error))
    }
  }

  /** Forgets the local session, then revokes the refresh-token family on the server (best effort). */
  async signOut(): Promise<void> {
    const session = this.#session
    this.#refreshing = null
    await this.#replace(null)
    if (session) {
      await this.publicRequest('POST', '/auth/logout', {
        refreshToken: session.refreshToken
      }).catch((error) =>
        this.#log('[backend] logout request failed (session already forgotten locally)', error)
      )
    }
    this.#emit()
  }

  /** Valid access token, refreshed when about to expire. */
  async accessToken(): Promise<string> {
    const session = this.#requireSession()
    if (session.accessTokenExpiresAt - this.#now() > EXPIRY_MARGIN_MS) return session.accessToken
    return (await this.refresh()).accessToken
  }

  refresh(): Promise<StoredSession> {
    const current = this.#requireSession()
    if (!this.#refreshing) {
      const flight: Promise<StoredSession> = this.#doRefresh(current).finally(() => {
        if (this.#refreshing === flight) this.#refreshing = null
      })
      this.#refreshing = flight
    }
    return this.#refreshing
  }

  async #doRefresh(current: StoredSession): Promise<StoredSession> {
    let tokens: TokenResponse
    try {
      tokens = await this.publicRequest<TokenResponse>('POST', '/auth/token', {
        grantType: 'refresh_token',
        refreshToken: current.refreshToken
      })
    } catch (error) {
      // Refresh token expired, revoked or reused: the user must sign in again.
      if (
        error instanceof ApiError &&
        error.code === 'INVALID_GRANT' &&
        this.#session === current
      ) {
        await this.#replace(null)
        this.#emit()
        throw new ApiError(401, 'UNAUTHORIZED', 'Session expired, sign in again')
      }
      throw error
    }
    const next = toStoredSession(tokens, this.#now())
    if (this.#session !== current) {
      // Signed out or signed in as someone else meanwhile: drop the rotated tokens.
      throw new ApiError(401, 'UNAUTHORIZED', 'Session changed during refresh')
    }
    await this.#replace(next) // persist right away: the previous refresh token is dead now
    return next
  }

  /** Bearer request; a 401 UNAUTHORIZED is retried once with a refreshed token. */
  async fetchAuthed(
    method: Method,
    path: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<Response> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const token = await this.accessToken()
    const res = await send(this.#fetch, `${this.apiUrl}${path}`, { method, body, token, timeoutMs })
    if (res.status !== 401) return res

    const code = await res
      .clone()
      .json()
      .then((b: { error?: { code?: unknown } }) => b?.error?.code)
      .catch(() => undefined)
    // GOOGLE_REAUTH_REQUIRED is a 401 too, but a new backend token does not fix it.
    if (code !== 'UNAUTHORIZED' || !this.#session) return res
    const latest = this.#session
    const retryToken =
      latest.accessToken !== token ? latest.accessToken : (await this.refresh()).accessToken
    return send(this.#fetch, `${this.apiUrl}${path}`, {
      method,
      body,
      token: retryToken,
      timeoutMs
    })
  }

  async request<T>(
    method: Method,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    return readJson<T>(await this.fetchAuthed(method, path, body, options))
  }

  /** Request without Authorization (/auth/token, /auth/logout, /auth/dev-login). */
  async publicRequest<T>(
    method: Method,
    path: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<T> {
    const res = await send(this.#fetch, `${this.apiUrl}${path}`, {
      method,
      body,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    })
    return readJson<T>(res)
  }

  #requireSession(): StoredSession {
    if (!this.#session) throw new ApiError(401, 'UNAUTHORIZED', 'Not signed in')
    return this.#session
  }

  async #replace(session: StoredSession | null): Promise<void> {
    this.#session = session
    try {
      if (session) await this.#store.save(session)
      else await this.#store.clear()
    } catch (error) {
      this.#log('[backend] could not persist the session', error)
    }
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      try {
        listener()
      } catch (error) {
        this.#log('[backend] session listener failed', error)
      }
    }
  }
}
