import { safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { isStoredSession, type SessionStore, type StoredSession } from './session-store'

/**
 * Backend session encrypted with the OS keychain (`safeStorage`). Never writes tokens in clear text: when the OS
 * cannot encrypt (or Linux falls back to the fixed-key `basic_text` backend) the session lives in memory only and the
 * user signs in again on the next launch. Must be used after `app.whenReady()`.
 */
export class ElectronSessionStore implements SessionStore {
  #memory: StoredSession | null = null

  constructor(
    private readonly filePath: string,
    private readonly log: (message: string) => void = console.warn
  ) {}

  canPersist(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
      return false
    return true
  }

  async load(): Promise<StoredSession | null> {
    if (!this.canPersist()) return this.#memory
    try {
      const parsed: unknown = JSON.parse(
        safeStorage.decryptString(await fs.readFile(this.filePath))
      )
      return isStoredSession(parsed) ? parsed : null
    } catch {
      return null // missing, corrupted, or encrypted by another OS user
    }
  }

  async save(session: StoredSession): Promise<void> {
    this.#memory = session
    if (!this.canPersist()) {
      this.log('[session] OS encryption unavailable: keeping the backend session in memory only')
      return
    }
    const tmp = `${this.filePath}.tmp`
    await fs.writeFile(tmp, safeStorage.encryptString(JSON.stringify(session)), { mode: 0o600 })
    await fs.rename(tmp, this.filePath) // atomic: a crash never leaves a truncated session file
  }

  async clear(): Promise<void> {
    this.#memory = null
    await fs.rm(this.filePath, { force: true })
  }
}
