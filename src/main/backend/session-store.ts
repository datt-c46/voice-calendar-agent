import type { TokenResponse, UserDTO } from '../../shared/backend'

export interface StoredSession {
  accessToken: string
  /** Local epoch ms, computed from `expiresIn` at receive time (immune to client/server clock skew). */
  accessTokenExpiresAt: number
  refreshToken: string
  user: UserDTO
}

export interface SessionStore {
  load(): Promise<StoredSession | null>
  save(session: StoredSession): Promise<void>
  clear(): Promise<void>
}

export function toStoredSession(tokens: TokenResponse, now: number): StoredSession {
  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: now + tokens.expiresIn * 1000,
    refreshToken: tokens.refreshToken,
    user: tokens.user
  }
}

/** Shape check for data read back from disk (it may be stale, truncated or from an older app version). */
export function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const user = v['user'] as Record<string, unknown> | null | undefined
  return (
    typeof v['accessToken'] === 'string' &&
    typeof v['refreshToken'] === 'string' &&
    v['refreshToken'] !== '' &&
    typeof v['accessTokenExpiresAt'] === 'number' &&
    Number.isFinite(v['accessTokenExpiresAt']) &&
    !!user &&
    typeof user === 'object' &&
    typeof user['id'] === 'string' &&
    typeof user['email'] === 'string'
  )
}

/** Keeps the session in memory only (tests, or when the OS cannot encrypt data at rest). */
export class MemorySessionStore implements SessionStore {
  #session: StoredSession | null

  constructor(initial: StoredSession | null = null) {
    this.#session = initial
  }

  async load(): Promise<StoredSession | null> {
    return this.#session
  }

  async save(session: StoredSession): Promise<void> {
    this.#session = session
  }

  async clear(): Promise<void> {
    this.#session = null
  }
}
