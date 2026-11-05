/**
 * Visual check tool (not a test): builds the app, starts a real voice-backend, drives the Electron UI into its main
 * states and saves screenshots at several window sizes in light and dark mode, plus an overflow report.
 *
 *   pnpm ui:shots [outDir] [--no-build]
 *
 * outDir/report.json lists, per state × size × theme, the screenshot file, whether the page scrolls horizontally, the
 * elements sticking out of the viewport, the chat's share of the window height and whether the input is fully visible.
 *
 * States: 1-signed-out, 2-chat-confirm (event cards + Xác nhận/Hủy), 3-voice (after a spoken command),
 * 4-voice-details ('Chi tiết' expanded) and 5-long-header (worst-case header: server unreachable,
 * long e-mail, Google reauth link, long time zone; injected into the DOM, so only the header is meaningful).
 * Sizes include the minimum window height (560) at tablet and phone widths.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { startE2EBackend } from './backendHarness'
import { launchApp, type ElectronApp } from './electronApp'

const APP_DIR = resolve(__dirname, '../..')
const SPEECH_WAV = '/usr/share/sounds/alsa/Front_Center.wav'
const SIZES = [
  { name: 'wide', width: 1440, height: 900 },
  { name: 'wide-short', width: 1180, height: 560 },
  { name: 'default', width: 960, height: 720 },
  { name: 'tablet', width: 720, height: 900 },
  { name: 'narrow', width: 480, height: 820 },
  { name: 'min', width: 360, height: 640 },
  { name: 'tablet-short', width: 720, height: 560 },
  { name: 'min-short', width: 360, height: 560 }
]
const THEMES = ['light', 'dark'] as const

interface ShotReport {
  state: string
  size: string
  theme: string
  file: string
  horizontalScroll: boolean
  overflowing: string[]
  /** Chat height / window height. */
  chatRatio: number
  inputVisible: boolean
}

const OVERFLOW_PROBE = `(() => {
  const vw = document.documentElement.clientWidth
  // Elements inside a container that clips or scrolls horizontally (and is itself on screen) are intentional.
  const clippedByAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox !== 'visible') {
        const r = p.getBoundingClientRect()
        return r.right <= vw + 1 && r.left >= -1
      }
    }
    return false
  }
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if ((r.right > vw + 1 || r.left < -1) && !clippedByAncestor(el)) {
      const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : ''
      out.push(el.tagName.toLowerCase() + cls + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ' > ' + vw + ']')
    }
  }
  const vh = document.documentElement.clientHeight
  const chat = document.querySelector('.chat-feed')?.getBoundingClientRect()
  const input = document.querySelector('.input-footer')?.getBoundingClientRect()
  return {
    horizontalScroll: document.documentElement.scrollWidth > vw + 1,
    overflowing: out.slice(0, 12),
    chatRatio: chat ? Math.round((chat.height / vh) * 100) / 100 : 0,
    inputVisible: !!input && input.bottom <= vh + 1 && input.top >= 0
  }
})()`

/** Worst-case header for layout checks: written straight into the DOM (React does not re-render the header here). */
const LONG_HEADER = `(() => {
  const status = document.querySelector('.header-status')
  const email = document.querySelector('.user-email')
  if (email) email.textContent = 'nguyenvana.sinhvien2026@gmail.com'
  const label = document.querySelector('.status-item.calendar .status-label')
  if (label) label.textContent = 'GOOGLE CALENDAR'
  const action = document.querySelector('.status-item.calendar .link-btn')
  if (action) action.textContent = 'Kết nối lại Google'
  document.querySelector('.status-item.calendar')?.classList.add('is-warn')
  const tz = document.querySelector('.status-item.timezone')
  if (tz) tz.textContent = 'Asia/Ho_Chi_Minh'
  const err = document.createElement('span')
  err.className = 'status-item is-error'
  err.innerHTML = '<span class="status-dot" aria-hidden="true"></span>Không kết nối được server'
  status?.prepend(err)
  return true
})()`

async function capture(
  app: ElectronApp,
  outDir: string,
  state: string,
  reports: ShotReport[]
): Promise<void> {
  for (const theme of THEMES) {
    await app.cdp('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: theme }]
    })
    for (const size of SIZES) {
      await app.cdp('Emulation.setDeviceMetricsOverride', {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 1,
        mobile: false
      })
      await new Promise((r) => setTimeout(r, 250))
      const file = join(outDir, `${state}-${size.name}-${theme}.png`)
      await app.screenshot(file)
      const probe =
        await app.evaluate<
          Pick<ShotReport, 'horizontalScroll' | 'overflowing' | 'chatRatio' | 'inputVisible'>
        >(OVERFLOW_PROBE)
      reports.push({ state, size: `${size.width}x${size.height}`, theme, file, ...probe })
    }
  }
  await app.cdp('Emulation.clearDeviceMetricsOverride')
}

async function ask(app: ElectronApp, text: string): Promise<void> {
  const before = await app.assistantCount()
  await app.typeCommand(text)
  await app.waitFor(
    `[...document.querySelectorAll('.chat-message.assistant')].filter((x) => !x.innerText.startsWith('Đang phân tích')).length > ${before} && !document.body.innerText.includes('Đang phân tích')`,
    `answer to ${text}`,
    30_000
  )
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const outDir = resolve(
    args.find((a) => !a.startsWith('--')) ?? mkdtempSync(join(tmpdir(), 'vca-shots-'))
  )
  mkdirSync(outDir, { recursive: true })
  if (!args.includes('--no-build')) {
    await promisify(execFile)('npx', ['electron-vite', 'build'], { cwd: APP_DIR, timeout: 240_000 })
  }
  const backend = await startE2EBackend()
  const configHome = mkdtempSync(join(tmpdir(), 'vca-shots-config-'))
  const app = await launchApp({
    appDir: APP_DIR,
    configHome,
    env: { VOICE_BACKEND_URL: backend.url, VOICE_BACKEND_DEV_EMAIL: 'nguyen.van.a@example.com' },
    ...(existsSync(SPEECH_WAV) ? { fakeMicWav: SPEECH_WAV } : {})
  })
  const reports: ShotReport[] = []
  try {
    await app.waitFor(`document.body.innerText.includes('Đăng nhập bằng Google')`, 'sign-in screen')
    await capture(app, outDir, '1-signed-out', reports)

    await app.clickButton('Đăng nhập dev')
    await app.waitFor(`!document.querySelector('.command-input').disabled`, 'signed in')
    await ask(app, 'Tạo lịch họp nhóm dự án voice calendar ngày mai lúc 9 giờ')
    await ask(app, 'Tạo lịch ăn trưa với khách hàng ngày mai lúc 12 giờ')
    await ask(app, 'Ngày mai tôi có lịch gì?')
    await ask(app, 'Xóa lịch ăn trưa ngày mai')
    await capture(app, outDir, '2-chat-confirm', reports)

    backend.gemini.transcripts.push('Ngày mai tôi có lịch gì')
    await app.clickButton('Bắt đầu nghe')
    await app.waitFor(
      `document.querySelectorAll('.chat-message.user').length >= 5`,
      'spoken command',
      45_000
    )
    await app.waitFor(`!document.body.innerText.includes('Đang phân tích')`, 'answer')
    await capture(app, outDir, '3-voice', reports)

    if (await app.evaluate<boolean>(`!!document.querySelector('.mic-btn-stop')`)) {
      await app.clickButton('Dừng nghe')
    }
    await app.clickButton('Chi tiết')
    await app.waitFor(`!!document.querySelector('.transcription-details')`, 'details')
    await capture(app, outDir, '4-voice-details', reports)

    await app.evaluate(LONG_HEADER)
    await capture(app, outDir, '5-long-header', reports)
  } finally {
    await app.close()
    await backend.stop()
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(reports, null, 2))
  const bad = reports.filter((r) => r.horizontalScroll || r.overflowing.length > 0)
  console.log(`screenshots: ${outDir}`)
  console.log(`${reports.length} shots, ${bad.length} with horizontal overflow`)
  for (const r of bad)
    console.log(`  ${r.state} ${r.size} ${r.theme}: ${r.overflowing.slice(0, 4).join(', ')}`)
  const cramped = reports.filter((r) => !r.inputVisible || r.chatRatio < 0.35)
  console.log(`${cramped.length} with the input cut off or the chat under 35% of the height`)
  for (const r of cramped)
    console.log(`  ${r.state} ${r.size} ${r.theme}: chat ${r.chatRatio}, input ${r.inputVisible}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
