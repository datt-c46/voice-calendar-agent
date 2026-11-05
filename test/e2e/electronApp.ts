/**
 * Launches the built Electron app with Chrome DevTools Protocol enabled and drives its renderer like a user
 * (clicks, typing, reading the DOM). App data goes to a temporary XDG_CONFIG_HOME, never the user's profile.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { join } from 'node:path'

export interface LaunchOptions {
  appDir: string
  configHome: string
  env: Record<string, string>
  /** WAV played as the microphone (looped). */
  fakeMicWav?: string
}

export interface ElectronApp {
  /** Raw Chrome DevTools Protocol call (e.g. Emulation.setDeviceMetricsOverride). */
  cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  evaluate<T = unknown>(expression: string): Promise<T>
  waitFor(expression: string, label: string, timeoutMs?: number): Promise<void>
  text(): Promise<string>
  clickButton(label: string): Promise<void>
  typeCommand(text: string): Promise<void>
  lastAssistant(): Promise<{ text: string; intent: string }>
  assistantCount(): Promise<number>
  screenshot(path: string): Promise<void>
  logs: string[]
  close(): Promise<void>
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function launchApp(o: LaunchOptions): Promise<ElectronApp> {
  const electronBin = createRequire(join(o.appDir, 'package.json'))('electron') as unknown as string
  const port = await freePort()
  const args = ['.', `--remote-debugging-port=${port}`]
  if (o.fakeMicWav) {
    args.push(
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${o.fakeMicWav}`
    )
  }
  const proc: ChildProcess = spawn(electronBin, args, {
    cwd: o.appDir,
    env: { ...process.env, XDG_CONFIG_HOME: o.configHome, ...o.env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  proc.stdout?.on('data', (d: Buffer) => (output += d.toString()))
  proc.stderr?.on('data', (d: Buffer) => (output += d.toString()))

  let wsUrl: string | undefined
  for (let i = 0; i < 80 && !wsUrl; i++) {
    if (proc.exitCode !== null)
      throw new Error(`Electron exited (${proc.exitCode}):\n${output.slice(-2000)}`)
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
        type: string
        url: string
        webSocketDebuggerUrl: string
      }>
      wsUrl = targets.find(
        (t) => t.type === 'page' && !t.url.startsWith('devtools://')
      )?.webSocketDebuggerUrl
    } catch {
      // not up yet
    }
    if (!wsUrl) await sleep(250)
  }
  if (!wsUrl) throw new Error(`no renderer page via CDP:\n${output.slice(-2000)}`)

  const ws = new WebSocket(wsUrl)
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true })
  })
  let seq = 0
  const pending = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>()
  const logs: string[] = []
  ws.addEventListener('message', (event) => {
    const m = JSON.parse(String(event.data)) as {
      id?: number
      method?: string
      params?: {
        type?: string
        args?: Array<{ value?: unknown; description?: string }>
        exceptionDetails?: unknown
      }
      result?: unknown
      error?: { message: string }
    }
    if (m.id !== undefined) {
      pending.get(m.id)?.(m)
      pending.delete(m.id)
    } else if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(
        `[${m.params?.type}] ${(m.params?.args ?? []).map((a) => a.value ?? a.description).join(' ')}`
      )
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push(`[exception] ${JSON.stringify(m.params?.exceptionDetails)}`)
    }
  })
  const send = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, (m) =>
        m.error ? reject(new Error(m.error.message)) : resolve(m.result as T)
      )
      ws.send(JSON.stringify({ id, method, params }))
    })
  await send('Runtime.enable')
  await send('Page.enable')

  const evaluate = async <T>(expression: string): Promise<T> => {
    const r = await send<{ result: { value?: T }; exceptionDetails?: unknown }>(
      'Runtime.evaluate',
      {
        expression,
        awaitPromise: true,
        returnByValue: true
      }
    )
    if (r.exceptionDetails)
      throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails)}`)
    return r.result.value as T
  }

  const app: ElectronApp = {
    cdp: send,
    evaluate,
    logs,
    async waitFor(expression, label, timeoutMs = 20_000) {
      const end = Date.now() + timeoutMs
      while (Date.now() < end) {
        if (await evaluate<boolean>(`!!(${expression})`)) return
        await sleep(150)
      }
      throw new Error(`timed out waiting for: ${label}\n--- page text ---\n${await app.text()}`)
    },
    text: () => evaluate<string>('document.body.innerText'),
    async clickButton(label) {
      const clicked = await evaluate<boolean>(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes(${JSON.stringify(label)}) && !x.disabled)
        if (!b) return false
        b.click()
        return true
      })()`)
      if (!clicked)
        throw new Error(`no enabled button "${label}"\n--- page text ---\n${await app.text()}`)
    },
    async typeCommand(text) {
      await app.waitFor(
        `!document.querySelector('.command-input').disabled`,
        'enabled command input'
      )
      await evaluate(`(() => {
        const input = document.querySelector('.command-input')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await app.waitFor(`!document.querySelector('.send-btn').disabled`, 'enabled send button')
      await evaluate(`document.querySelector('.input-footer form').requestSubmit()`)
    },
    lastAssistant: () =>
      evaluate(`(() => {
        const m = [...document.querySelectorAll('.chat-message.assistant')].filter((x) => !x.querySelector('.message-bubble')?.innerText.startsWith('Đang phân tích')).at(-1)
        return { text: m?.querySelector('.message-bubble')?.innerText ?? '', intent: m?.querySelector('.intent-tag')?.innerText ?? '' }
      })()`),
    assistantCount: () =>
      evaluate<number>(
        `[...document.querySelectorAll('.chat-message.assistant')].filter((x) => !x.innerText.startsWith('Đang phân tích')).length`
      ),
    async screenshot(path) {
      const r = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
      writeFileSync(path, Buffer.from(r.data, 'base64'))
    },
    async close() {
      ws.close()
      if (proc.exitCode !== null) return
      await new Promise<void>((resolve) => {
        proc.once('exit', () => resolve())
        proc.kill('SIGTERM')
        setTimeout(() => proc.kill('SIGKILL'), 5_000).unref()
      })
    }
  }
  return app
}
