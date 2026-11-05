import type { ErrorEnvelope } from '../../shared/backend'

export type FetchLike = typeof fetch

/** Error from voice-backend (`{error: {code, message}}` envelope) or from the transport (`status` 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as Partial<ErrorEnvelope> | null
  const e = body && typeof body === 'object' ? body.error : undefined
  return new ApiError(
    res.status,
    typeof e?.code === 'string' ? e.code : `HTTP_${res.status}`,
    typeof e?.message === 'string' ? e.message : res.statusText || `HTTP ${res.status}`,
    e?.details,
    e?.requestId ?? res.headers.get('x-request-id') ?? undefined
  )
}

/** Maps fetch's own failures (connection refused, DNS, abort/timeout) to an ApiError with status 0. */
export function transportError(error: unknown, baseUrl: string): ApiError {
  if (error instanceof ApiError) return error
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError')
    return new ApiError(0, 'TIMEOUT', 'voice-backend did not answer in time')
  if (name === 'AbortError') return new ApiError(0, 'ABORTED', 'Request aborted')
  return new ApiError(0, 'BACKEND_UNREACHABLE', `Cannot reach voice-backend at ${baseUrl}`)
}

export interface SendOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  token?: string
  timeoutMs: number
  redirect?: RequestRedirect
}

/**
 * One HTTP exchange. Never sends `content-type: application/json` without a body: Fastify rejects an empty JSON body
 * with 400 (e.g. `POST /agent/actions/:id/confirm`).
 */
export async function send(fetchImpl: FetchLike, url: string, o: SendOptions): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (o.token) headers.authorization = `Bearer ${o.token}`
  if (o.body !== undefined) headers['content-type'] = 'application/json'
  try {
    return await fetchImpl(url, {
      method: o.method,
      headers,
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
      ...(o.redirect ? { redirect: o.redirect } : {}),
      signal: AbortSignal.timeout(o.timeoutMs)
    })
  } catch (error) {
    throw transportError(error, new URL(url).origin)
  }
}

export async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
