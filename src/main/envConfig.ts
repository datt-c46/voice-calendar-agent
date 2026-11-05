import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/** Only the app's own settings are read from `.env`; any other key (e.g. old Google/Gemini secrets) is ignored. */
const ALLOWED_KEY = /^VOICE_BACKEND_[A-Z_]+$/

/** Parses `KEY=value` lines (optional quotes, `#` comments). */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx <= 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.slice(1, -1)
    }
    if (ALLOWED_KEY.test(key) && val) result[key] = val
  }
  return result
}

/** Loads VOICE_BACKEND_* from the first `.env` found into process.env (real environment variables win). */
export function loadEnvConfig(): void {
  const candidatePaths = [
    join(process.cwd(), '.env'),
    join(__dirname, '../../.env'),
    join(__dirname, '../.env'),
    join(app ? app.getAppPath() : process.cwd(), '.env')
  ]

  for (const envPath of candidatePaths) {
    if (!existsSync(envPath)) continue
    try {
      for (const [key, val] of Object.entries(parseEnvFile(readFileSync(envPath, 'utf-8')))) {
        if (!process.env[key]) process.env[key] = val
      }
    } catch {
      // Unreadable .env: keep the defaults.
    }
    break
  }
}
