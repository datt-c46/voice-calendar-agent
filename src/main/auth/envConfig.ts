import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Loads all key-value pairs from .env into process.env if not already present.
 */
export function loadEnvConfig(): void {
  const candidatePaths = [
    join(process.cwd(), '.env'),
    join(__dirname, '../../.env'),
    join(__dirname, '../.env'),
    join(app ? app.getAppPath() : process.cwd(), '.env')
  ]

  for (const envPath of candidatePaths) {
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, 'utf-8')
        const lines = content.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx <= 0) continue

          const key = trimmed.slice(0, eqIdx).trim()
          let val = trimmed.slice(eqIdx + 1).trim()
          // Remove surrounding quotes if present
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1)
          }

          if (!process.env[key] && val) {
            process.env[key] = val
          }
        }
      } catch {
        // Silently ignore file read errors in dev
      }
      break
    }
  }
}

/**
 * Loads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from environment or root .env file.
 * Does not throw if .env is missing or invalid.
 */
export function loadGoogleEnvConfig(): { clientId: string; clientSecret: string } {
  loadEnvConfig()
  return {
    clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim()
  }
}
