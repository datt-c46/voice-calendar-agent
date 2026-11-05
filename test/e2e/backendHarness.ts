/**
 * Boots a REAL voice-backend for end-to-end tests:
 *   - builds it when `dist/server.js` is missing or older than `src/`,
 *   - creates a throw-away database on the `postgres-test` service (starting it with docker compose if needed)
 *     and applies the Prisma migrations,
 *   - starts `node dist/server.js` on a free port with dev login, rule-based NLU, mock TTS and Gemini STT pointed
 *     at a local fake (see fakeGemini.ts), plus fake Google OAuth client credentials,
 *   - drops the database on stop().
 * Env: VOICE_BACKEND_DIR (default ../voice-backend), E2E_DATABASE_ADMIN_URL (default the postgres-test superuser).
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { TokenResponse } from '../../src/shared/backend'
import { startFakeGemini, type FakeGemini } from './fakeGemini'

const run = promisify(execFile)

export const BACKEND_DIR = resolve(
  process.env['VOICE_BACKEND_DIR'] ?? join(__dirname, '../../../voice-backend')
)
const ADMIN_URL =
  process.env['E2E_DATABASE_ADMIN_URL'] ?? 'postgresql://voice:voice@127.0.0.1:55433/postgres'
export const FAKE_GOOGLE_CLIENT_ID = 'e2e-client.apps.googleusercontent.com'

interface PgClient {
  connect(): Promise<void>
  query(sql: string): Promise<unknown>
  end(): Promise<void>
}
type PgModule = { Client: new (o: { connectionString: string }) => PgClient }

export interface RequestLogEntry {
  method: string
  url: string
}

export interface E2EBackend {
  url: string
  apiUrl: string
  gemini: FakeGemini
  /** Requests seen by the server (from its info-level request log). */
  requests(): RequestLogEntry[]
  count(method: string, path: string | RegExp): number
  output(): string
  /** Restart the same server (same database) with some env changed, e.g. a rotated JWT_SECRET. */
  restart(env?: Record<string, string>): Promise<void>
  /** Stop the HTTP server but keep the database (simulates an outage); restart() brings it back. */
  pause(): Promise<void>
  devLogin(email: string): Promise<TokenResponse>
  stop(): Promise<void>
}

function newestMtime(dir: string): number {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs)
  }
  return newest
}

async function ensureBuilt(): Promise<void> {
  if (!existsSync(join(BACKEND_DIR, 'package.json'))) {
    throw new Error(`voice-backend not found at ${BACKEND_DIR} (set VOICE_BACKEND_DIR)`)
  }
  const server = join(BACKEND_DIR, 'dist/server.js')
  if (existsSync(server) && statSync(server).mtimeMs >= newestMtime(join(BACKEND_DIR, 'src')))
    return
  await run('npm', ['run', 'build'], { cwd: BACKEND_DIR, timeout: 180_000 })
}

function pg(): PgModule {
  return createRequire(join(BACKEND_DIR, 'package.json'))('pg') as PgModule
}

async function canConnect(url: string): Promise<boolean> {
  const client = new (pg().Client)({ connectionString: url })
  try {
    await client.connect()
    await client.end()
    return true
  } catch {
    return false
  }
}

async function ensureDatabaseServer(): Promise<void> {
  if (await canConnect(ADMIN_URL)) return
  if (process.env['E2E_DATABASE_ADMIN_URL'])
    throw new Error(`E2E_DATABASE_ADMIN_URL is not reachable: ${ADMIN_URL}`)
  try {
    await run('docker', ['compose', 'up', '-d', 'postgres-test'], {
      cwd: BACKEND_DIR,
      timeout: 120_000
    })
  } catch (error) {
    throw new Error(
      `Postgres for e2e is not reachable at ${new URL(ADMIN_URL).host} and 'docker compose up -d postgres-test' ` +
        `failed in ${BACKEND_DIR}: ${(error as Error).message}`
    )
  }
  for (let i = 0; i < 60; i++) {
    if (await canConnect(ADMIN_URL)) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`postgres-test started but ${new URL(ADMIN_URL).host} is still unreachable`)
}

async function adminQuery(sql: string): Promise<void> {
  const client = new (pg().Client)({ connectionString: ADMIN_URL })
  await client.connect()
  try {
    await client.query(sql)
  } finally {
    await client.end()
  }
}

async function createDatabase(): Promise<{ name: string; url: string }> {
  const name = `vb_e2e_${randomBytes(6).toString('hex')}`
  await adminQuery(`CREATE DATABASE "${name}"`)
  const url = new URL(ADMIN_URL)
  url.pathname = `/${name}`
  const client = new (pg().Client)({ connectionString: url.toString() })
  await client.connect()
  try {
    const dir = join(BACKEND_DIR, 'prisma/migrations')
    const migrations = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    for (const m of migrations)
      await client.query(await readFile(join(dir, m, 'migration.sql'), 'utf8'))
  } finally {
    await client.end()
  }
  return { name, url: url.toString() }
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolvePort(port))
    })
  })
}

export async function startE2EBackend(extraEnv: Record<string, string> = {}): Promise<E2EBackend> {
  await ensureBuilt()
  await ensureDatabaseServer()
  const db = await createDatabase()
  const gemini = await startFakeGemini()
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`

  let env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(port),
    PUBLIC_BASE_URL: url,
    LOG_LEVEL: 'info',
    DATABASE_URL: db.url,
    JWT_SECRET: randomBytes(32).toString('hex'),
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    AUTH_DEV_LOGIN_ENABLED: 'true',
    GOOGLE_CLIENT_ID: FAKE_GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'e2e-not-a-real-secret',
    INTENT_EXTRACTOR: 'rule',
    STT_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'e2e-fake-key',
    GOOGLE_GEMINI_BASE_URL: gemini.url,
    TTS_PROVIDER: 'mock',
    DEFAULT_TIMEZONE: 'Asia/Bangkok',
    ...extraEnv
  }

  let child: ChildProcess | null = null
  let out = ''

  const spawnServer = async (): Promise<void> => {
    const proc = spawn(process.execPath, ['dist/server.js'], {
      cwd: BACKEND_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child = proc
    proc.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    proc.stderr?.on('data', (d: Buffer) => (out += d.toString()))
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null)
        throw new Error(`voice-backend exited (${proc.exitCode}):\n${out.slice(-3000)}`)
      try {
        if ((await fetch(`${url}/health`)).ok) return
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(`voice-backend did not become healthy:\n${out.slice(-3000)}`)
  }

  const kill = async (): Promise<void> => {
    const proc = child
    child = null
    if (!proc || proc.exitCode !== null) return
    await new Promise<void>((r) => {
      proc.once('exit', () => r())
      proc.kill('SIGTERM')
      setTimeout(() => proc.kill('SIGKILL'), 10_000).unref()
    })
  }

  try {
    await spawnServer()
  } catch (error) {
    await gemini.close()
    await adminQuery(`DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`).catch(() => undefined)
    throw error
  }

  const requests = (): RequestLogEntry[] =>
    [...out.matchAll(/"method":"([A-Z]+)","url":"([^"]+)"/g)].map((m) => ({
      method: m[1] ?? '',
      url: m[2] ?? ''
    }))

  return {
    url,
    apiUrl: `${url}/api/v1`,
    gemini,
    requests,
    count: (method, path) =>
      requests().filter(
        (r) =>
          r.method === method &&
          (typeof path === 'string' ? r.url.split('?')[0] === path : path.test(r.url))
      ).length,
    output: () => out,
    async restart(changes = {}) {
      await kill()
      env = { ...env, ...changes }
      await spawnServer()
    },
    pause: kill,
    async devLogin(email) {
      const res = await fetch(`${url}/api/v1/auth/dev-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email })
      })
      if (!res.ok) throw new Error(`dev-login failed: ${res.status} ${await res.text()}`)
      return (await res.json()) as TokenResponse
    },
    async stop() {
      await kill()
      await gemini.close()
      await adminQuery(`DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`).catch(() => undefined)
    }
  }
}
