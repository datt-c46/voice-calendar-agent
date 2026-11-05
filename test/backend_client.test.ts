import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { BackendClient, EXPIRY_MARGIN_MS } from '../src/main/backend/backend-client'
import { ApiError } from '../src/main/backend/http'
import {
  isStoredSession,
  MemorySessionStore,
  toStoredSession
} from '../src/main/backend/session-store'
import { startFakeBackend, type FakeBackend } from './helpers/fakeBackend'

describe('BackendClient', () => {
  let fake: FakeBackend
  let clock: number
  let store: MemorySessionStore
  let client: BackendClient

  before(async () => {
    fake = await startFakeBackend()
  })
  after(() => fake.close())

  beforeEach(async () => {
    fake.requests.length = 0
    fake.tokenDelayMs = 0
    fake.googleReauth = false
    clock = 1_000_000
    store = new MemorySessionStore()
    client = new BackendClient({
      apiUrl: fake.apiUrl,
      store,
      now: () => clock,
      log: () => undefined
    })
    await client.init()
    await client.signIn(fake.issue())
  })

  it('sends Bearer requests and persists the session', async () => {
    const res = await client.request<{ message: string }>('POST', '/agent/command', {
      text: 'xin chào'
    })
    assert.equal(res.message, 'echo: xin chào')
    const sent = fake.requests.find((r) => r.path === '/api/v1/agent/command')
    assert.match(String(sent?.headers.authorization), /^Bearer access-\d+$/)
    assert.equal(sent?.headers['content-type'], 'application/json')
    assert.ok(isStoredSession(await store.load()))
  })

  it('never sends a JSON content-type without a body (Fastify would answer 400)', async () => {
    const res = await client.request<{ intent: string }>('POST', '/agent/actions/abc/confirm')
    assert.equal(res.intent, 'CONFIRM_ACTION')
    const sent = fake.requests.find((r) => r.path.endsWith('/confirm'))
    assert.equal(sent?.headers['content-type'], undefined)
  })

  it('refreshes an expired access token once for concurrent callers (single flight)', async () => {
    clock += 900_000 - EXPIRY_MARGIN_MS + 1 // inside the safety margin
    fake.tokenDelayMs = 50
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        client.request<{ message: string }>('POST', '/agent/command', { text: `${i}` })
      )
    )
    assert.deepEqual(
      results.map((r) => r.message),
      ['echo: 0', 'echo: 1', 'echo: 2', 'echo: 3', 'echo: 4']
    )
    assert.equal(fake.count('/api/v1/auth/token'), 1)
    const saved = await store.load()
    assert.equal(saved?.refreshToken, [...fake.liveRefresh].at(-1))
  })

  it('retries once with a refreshed token when the server answers 401 UNAUTHORIZED', async () => {
    fake.validAccess.clear() // server-side expiry the client cannot see
    const res = await client.request<{ message: string }>('POST', '/agent/command', { text: 'hi' })
    assert.equal(res.message, 'echo: hi')
    assert.equal(fake.count('/api/v1/auth/token'), 1)
    assert.equal(fake.count('/api/v1/agent/command'), 2)
  })

  it('does not refresh on 401 GOOGLE_REAUTH_REQUIRED', async () => {
    fake.googleReauth = true
    await assert.rejects(client.request('GET', '/calendar/status'), (e: ApiError) => {
      assert.equal(e.code, 'GOOGLE_REAUTH_REQUIRED')
      assert.equal(e.status, 401)
      return true
    })
    assert.equal(fake.count('/api/v1/auth/token'), 0)
    assert.equal(client.isSignedIn, true)
  })

  it('drops the session and notifies listeners when the refresh token is rejected', async () => {
    let changes = 0
    client.onSessionChange(() => changes++)
    fake.validAccess.clear()
    fake.liveRefresh.clear() // revoked / reused on the server
    await assert.rejects(
      client.request('GET', '/auth/status'),
      (e: ApiError) => e.code === 'UNAUTHORIZED'
    )
    assert.equal(client.isSignedIn, false)
    assert.equal(await store.load(), null)
    assert.equal(changes, 1)
  })

  it('signOut forgets the session locally and revokes the refresh token', async () => {
    const refreshToken = (await store.load())?.refreshToken
    await client.signOut()
    assert.equal(client.isSignedIn, false)
    assert.equal(await store.load(), null)
    assert.deepEqual(fake.revoked.at(-1), refreshToken)
    await assert.rejects(
      client.request('GET', '/auth/status'),
      (e: ApiError) => e.code === 'UNAUTHORIZED'
    )
  })

  it('signing in again revokes the replaced session', async () => {
    const previous = (await store.load())?.refreshToken
    await client.signIn(fake.issue())
    assert.equal(fake.revoked.at(-1), previous)
    assert.notEqual((await store.load())?.refreshToken, previous)
  })

  it('restores a stored session on init', async () => {
    const restored = new BackendClient({ apiUrl: fake.apiUrl, store, now: () => clock })
    await restored.init()
    assert.equal(restored.user?.email, 'user@example.com')
    const res = await restored.request<{ message: string }>('POST', '/agent/command', { text: 'x' })
    assert.equal(res.message, 'echo: x')
  })

  it('maps an unreachable server to BACKEND_UNREACHABLE', async () => {
    const offline = new BackendClient({
      apiUrl: 'http://127.0.0.1:1/api/v1',
      store: new MemorySessionStore(toStoredSession(fake.issue(), clock)),
      now: () => clock
    })
    await offline.init()
    await assert.rejects(offline.request('GET', '/auth/status'), (e: ApiError) => {
      assert.equal(e.code, 'BACKEND_UNREACHABLE')
      assert.equal(e.status, 0)
      return true
    })
    assert.equal(offline.isSignedIn, true) // a network error never signs the user out
  })

  it('maps a hung server to TIMEOUT', async () => {
    const hung = new BackendClient({
      apiUrl: fake.apiUrl,
      store: new MemorySessionStore(toStoredSession(fake.issue(), clock)),
      now: () => clock
    })
    await hung.init()
    fake.tokenDelayMs = 500
    await assert.rejects(
      hung.publicRequest(
        'POST',
        '/auth/token',
        { grantType: 'refresh_token', refreshToken: 'x' },
        { timeoutMs: 50 }
      ),
      (e: ApiError) => e.code === 'TIMEOUT'
    )
  })
})
