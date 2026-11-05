import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { BackendClient } from '../src/main/backend/backend-client'
import { ApiError } from '../src/main/backend/http'
import { createPkce, LoginError, signInWithGoogle } from '../src/main/backend/login'
import { MemorySessionStore } from '../src/main/backend/session-store'
import { startFakeBackend, type FakeBackend } from './helpers/fakeBackend'

describe('signInWithGoogle (loopback + PKCE)', () => {
  let fake: FakeBackend
  let client: BackendClient
  let opened: string[]

  before(async () => {
    fake = await startFakeBackend()
    client = new BackendClient({ apiUrl: fake.apiUrl, store: new MemorySessionStore() })
  })
  after(() => fake.close())
  beforeEach(() => {
    fake.googleConfigured = true
    fake.googleLocation = 'https://accounts.google.test/o/oauth2/v2/auth?client_id=x'
    fake.lastLogin = null
    opened = []
  })

  /** Plays the browser: Google approves, the backend callback redirects to the app's loopback listener. */
  const browserThatApproves = async (url: string): Promise<void> => {
    opened.push(url)
    const login = fake.lastLogin
    assert.ok(login)
    const code = fake.issueLoginCode(login.redirectUri, login.codeChallenge)
    // A stray request (favicon, wrong state) must be ignored, not end the sign-in.
    assert.equal((await fetch(`${login.redirectUri}?code=evil&state=wrong`)).status, 404)
    const res = await fetch(`${login.redirectUri}?code=${code}&state=${login.state}`)
    assert.equal(res.status, 200)
    assert.match(await res.text(), /Đăng nhập thành công/)
  }

  it('creates an RFC 7636 S256 challenge', () => {
    const { codeVerifier, codeChallenge } = createPkce()
    assert.match(codeVerifier, /^[A-Za-z0-9_-]{43}$/)
    assert.match(codeChallenge, /^[A-Za-z0-9_-]{43}$/)
  })

  it('opens the Google URL and exchanges the login code with the PKCE verifier', async () => {
    const tokens = await signInWithGoogle({ client, openExternal: browserThatApproves })
    assert.deepEqual(opened, [fake.googleLocation])
    assert.match(tokens.accessToken, /^access-/)
    const login = fake.lastLogin
    assert.ok(login)
    assert.match(login.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    assert.match(login.state, /^[0-9a-f]{32}$/)
    const exchange = fake.requests.filter((r) => r.path === '/api/v1/auth/token').at(-1)
    const body = JSON.parse(exchange?.body ?? '{}') as Record<string, string>
    assert.equal(body.grantType, 'authorization_code')
    assert.equal(body.redirectUri, login.redirectUri)
  })

  it('reports the error sent back by the backend (e.g. access_denied)', async () => {
    await assert.rejects(
      signInWithGoogle({
        client,
        openExternal: async () => {
          const login = fake.lastLogin
          assert.ok(login)
          const res = await fetch(`${login.redirectUri}?error=access_denied&state=${login.state}`)
          assert.equal(res.status, 400)
        }
      }),
      (e: LoginError) => e instanceof LoginError && e.code === 'access_denied'
    )
  })

  it('fails fast with GOOGLE_NOT_CONFIGURED without opening the browser', async () => {
    fake.googleConfigured = false
    await assert.rejects(
      signInWithGoogle({ client, openExternal: async (url) => void opened.push(url) }),
      (e: ApiError) => e instanceof ApiError && e.code === 'GOOGLE_NOT_CONFIGURED'
    )
    assert.deepEqual(opened, [])
  })

  it('refuses to open a non-web redirect target', async () => {
    fake.googleLocation = 'file:///etc/passwd'
    await assert.rejects(
      signInWithGoogle({ client, openExternal: async (url) => void opened.push(url) }),
      (e: ApiError) => e instanceof ApiError && e.code === 'UPSTREAM_ERROR'
    )
    assert.deepEqual(opened, [])
  })

  it('can be cancelled', async () => {
    const controller = new AbortController()
    await assert.rejects(
      signInWithGoogle({
        client,
        signal: controller.signal,
        openExternal: async () => {
          setTimeout(() => controller.abort(), 10)
        }
      }),
      (e: LoginError) => e instanceof LoginError && e.code === 'SIGN_IN_CANCELLED'
    )
  })

  it('times out when the browser never comes back', async () => {
    await assert.rejects(
      signInWithGoogle({ client, timeoutMs: 100, openExternal: async () => undefined }),
      (e: LoginError) => e instanceof LoginError && e.code === 'SIGN_IN_TIMEOUT'
    )
  })
})
