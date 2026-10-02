import { app, safeStorage } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { GoogleTokens } from './authTypes'

export class TokenStore {
  private filePath: string

  constructor(filePath?: string) {
    let userDataDir = process.cwd()
    try {
      if (app && typeof app.getPath === 'function') {
        userDataDir = app.getPath('userData')
      }
    } catch {
      // Fallback in headless test environments
    }
    this.filePath = filePath || join(userDataDir, 'auth_tokens.bin')
  }

  public async saveTokens(tokens: GoogleTokens): Promise<void> {
    const jsonStr = JSON.stringify(tokens)
    let buffer: Buffer

    if (
      safeStorage &&
      typeof safeStorage.isEncryptionAvailable === 'function' &&
      safeStorage.isEncryptionAvailable()
    ) {
      buffer = safeStorage.encryptString(jsonStr)
    } else {
      console.warn(
        '[TokenStore] Warning: safeStorage encryption unavailable. Storing encoded payload for local dev.'
      )
      buffer = Buffer.from(jsonStr, 'utf-8')
    }

    await fs.writeFile(this.filePath, buffer)
  }

  public async loadTokens(): Promise<GoogleTokens | null> {
    if (!existsSync(this.filePath)) {
      return null
    }

    try {
      const buffer = await fs.readFile(this.filePath)
      let jsonStr: string

      if (
        safeStorage &&
        typeof safeStorage.isEncryptionAvailable === 'function' &&
        safeStorage.isEncryptionAvailable()
      ) {
        try {
          jsonStr = safeStorage.decryptString(buffer)
        } catch {
          jsonStr = buffer.toString('utf-8')
        }
      } else {
        jsonStr = buffer.toString('utf-8')
      }

      return JSON.parse(jsonStr) as GoogleTokens
    } catch (err) {
      console.error('[TokenStore] Failed to parse stored tokens:', err)
      return null
    }
  }

  public async clearTokens(): Promise<void> {
    if (existsSync(this.filePath)) {
      try {
        await fs.unlink(this.filePath)
      } catch (err) {
        console.error('[TokenStore] Failed to delete token file:', err)
      }
    }
  }

  public async hasStoredTokens(): Promise<boolean> {
    return existsSync(this.filePath)
  }
}
