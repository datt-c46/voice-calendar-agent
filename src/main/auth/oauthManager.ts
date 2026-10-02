import { shell } from 'electron'
import { OAuth2Client } from 'google-auth-library'
import { google } from 'googleapis'
import http from 'http'
import { AddressInfo } from 'net'
import crypto from 'crypto'
import { URL } from 'url'
import { AuthStatusDTO } from './authTypes'
import { loadGoogleEnvConfig } from './envConfig'
import { TokenStore } from './tokenStore'

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email'
]

export interface OAuthConfig {
  clientId?: string
  clientSecret?: string
}

export class OAuthManager {
  private tokenStore: TokenStore
  private customConfig?: OAuthConfig
  private oauth2Client: OAuth2Client | null = null
  private userEmail: string | null = null
  private activeServer: http.Server | null = null
  private authTimeoutTimer: NodeJS.Timeout | null = null
  private isAuthenticating = false

  constructor(tokenStore?: TokenStore, customConfig?: OAuthConfig) {
    this.tokenStore = tokenStore || new TokenStore()
    this.customConfig = customConfig
  }

  private getConfig(): { clientId: string; clientSecret: string } {
    if (this.customConfig) {
      return {
        clientId: this.customConfig.clientId || '',
        clientSecret: this.customConfig.clientSecret || ''
      }
    }
    return loadGoogleEnvConfig()
  }

  public isConfigured(): boolean {
    const { clientId, clientSecret } = this.getConfig()
    return Boolean(clientId && clientSecret)
  }

  public async getAuthStatus(): Promise<AuthStatusDTO> {
    const configured = this.isConfigured()
    if (!configured) {
      return {
        isAuthenticated: false,
        isConfigured: false,
        userEmail: null,
        scopes: []
      }
    }

    const client = await this.getAuthenticatedClient()
    if (client) {
      return {
        isAuthenticated: true,
        isConfigured: true,
        userEmail: this.userEmail,
        scopes: GOOGLE_SCOPES
      }
    }

    return {
      isAuthenticated: false,
      isConfigured: true,
      userEmail: null,
      scopes: []
    }
  }

  public async getAuthenticatedClient(): Promise<OAuth2Client | null> {
    if (!this.isConfigured()) {
      return null
    }

    const { clientId, clientSecret } = this.getConfig()

    if (!this.oauth2Client) {
      this.oauth2Client = new OAuth2Client({
        clientId,
        clientSecret
      })

      // Auto-save refreshed tokens
      this.oauth2Client.on('tokens', async (newTokens) => {
        const current = (await this.tokenStore.loadTokens()) || {}
        await this.tokenStore.saveTokens({
          ...current,
          ...newTokens
        })
      })
    }

    // Check if tokens exist in store
    const stored = await this.tokenStore.loadTokens()
    if (!stored || (!stored.access_token && !stored.refresh_token)) {
      return null
    }

    this.oauth2Client.setCredentials({
      access_token: stored.access_token || undefined,
      refresh_token: stored.refresh_token || undefined,
      scope: stored.scope || GOOGLE_SCOPES.join(' '),
      token_type: stored.token_type || 'Bearer',
      expiry_date: stored.expiry_date || undefined
    })

    // Fetch user email if not already cached
    if (!this.userEmail) {
      try {
        const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client })
        const res = await oauth2.userinfo.get()
        this.userEmail = res.data.email || null
      } catch {
        // Token might still be valid or refreshable on next call
      }
    }

    return this.oauth2Client
  }

  public async startAuth(): Promise<AuthStatusDTO> {
    if (this.isAuthenticating) {
      throw new Error('Một phiên xác thực Google đang diễn ra. Vui lòng kiểm tra trình duyệt.')
    }

    const { clientId, clientSecret } = this.getConfig()
    if (!clientId || !clientSecret) {
      return {
        isAuthenticated: false,
        isConfigured: false,
        userEmail: null,
        scopes: [],
        error: 'Chưa cấu hình GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET trong .env'
      }
    }

    this.isAuthenticating = true

    return new Promise<AuthStatusDTO>((resolve, reject) => {
      // Create local loopback callback server
      const server = http.createServer()
      this.activeServer = server

      // 4. Generate cryptographically random state
      const expectedState = crypto.randomBytes(32).toString('hex')

      const cleanup = (): void => {
        if (this.authTimeoutTimer) {
          clearTimeout(this.authTimeoutTimer)
          this.authTimeoutTimer = null
        }
        if (this.activeServer) {
          try {
            this.activeServer.close()
          } catch {
            // Ignore close error
          }
          this.activeServer = null
        }
        this.isAuthenticating = false
      }

      // 6. Enforce 120-second timeout
      this.authTimeoutTimer = setTimeout(() => {
        cleanup()
        reject(new Error('Quá thời gian chờ xác thực Google OAuth (120 giây). Vui lòng thử lại.'))
      }, 120000)

      server.on('request', async (req, res) => {
        const reqUrl = req.url || '/'
        if (!reqUrl.startsWith('/oauth2callback')) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('Not Found')
          return
        }

        try {
          const parsedUrl = new URL(reqUrl, 'http://127.0.0.1')
          const queryParams = parsedUrl.searchParams
          const code = queryParams.get('code')
          const state = queryParams.get('state')
          const error = queryParams.get('error')

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`
              <div style="font-family: sans-serif; text-align: center; padding: 40px;">
                <h2 style="color: #e11d48;">Xác thực bị từ chối</h2>
                <p>Google trả về lỗi: ${error}. Bạn có thể đóng tab này.</p>
              </div>
            `)
            cleanup()
            resolve({
              isAuthenticated: false,
              isConfigured: true,
              userEmail: null,
              scopes: [],
              error: `Xác thực bị hủy: ${error}`
            })
            return
          }

          // 5. Validate OAuth state
          if (!state || state !== expectedState) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`
              <div style="font-family: sans-serif; text-align: center; padding: 40px;">
                <h2 style="color: #e11d48;">Lỗi bảo mật (Invalid State)</h2>
                <p>Mã trạng thái OAuth không hợp lệ hoặc đã hết hạn.</p>
              </div>
            `)
            cleanup()
            reject(new Error('Lỗi bảo mật OAuth: state parameter không hợp lệ.'))
            return
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('Missing authorization code.')
            cleanup()
            reject(new Error('Không tìm thấy authorization code từ Google.'))
            return
          }

          // 7. Success HTML response & immediate server close
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><meta charset="utf-8"><title>Xác thực thành công</title></head>
              <body style="font-family: -apple-system, sans-serif; text-align: center; padding: 60px 20px; background: #0f1117; color: #f3f4f6;">
                <div style="display: inline-block; padding: 32px 48px; background: #181b24; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                  <div style="font-size: 40px; margin-bottom: 12px;">✅</div>
                  <h2 style="margin: 0 0 10px 0; color: #10b981;">Kết nối Google Calendar thành công!</h2>
                  <p style="color: #9ca3af; margin: 0;">Bạn có thể đóng cửa sổ trình duyệt này và quay lại ứng dụng Voice Calendar Agent.</p>
                </div>
              </body>
            </html>
          `)

          const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth2callback`
          const client = new OAuth2Client({
            clientId,
            clientSecret,
            redirectUri
          })

          // 9. Exchange authorization code for tokens
          const tokenResponse = await client.getToken(code)
          const tokens = tokenResponse.tokens

          await this.tokenStore.saveTokens(tokens)
          client.setCredentials(tokens)
          this.oauth2Client = client

          // Auto-save refreshed tokens
          this.oauth2Client.on('tokens', async (newTokens) => {
            const current = (await this.tokenStore.loadTokens()) || {}
            await this.tokenStore.saveTokens({ ...current, ...newTokens })
          })

          // Fetch user profile email
          try {
            const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client })
            const userinfo = await oauth2.userinfo.get()
            this.userEmail = userinfo.data.email || null
          } catch {
            this.userEmail = null
          }

          cleanup()

          resolve({
            isAuthenticated: true,
            isConfigured: true,
            userEmail: this.userEmail,
            scopes: GOOGLE_SCOPES
          })
        } catch (err: unknown) {
          cleanup()
          const errMsg = err instanceof Error ? err.message : String(err)
          reject(new Error(`Trao đổi mã xác thực thất bại: ${errMsg}`))
        }
      })

      // 3. Bind callback server ONLY to 127.0.0.1
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo
        const port = address.port
        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`

        const tempClient = new OAuth2Client({
          clientId,
          clientSecret,
          redirectUri
        })

        const authUrl = tempClient.generateAuthUrl({
          access_type: 'offline',
          scope: GOOGLE_SCOPES,
          state: expectedState,
          prompt: 'consent'
        })

        // 8. Open auth URL using Electron shell
        shell.openExternal(authUrl)
      })

      server.on('error', (err) => {
        cleanup()
        reject(err)
      })
    })
  }

  public async logout(): Promise<AuthStatusDTO> {
    if (this.oauth2Client) {
      try {
        const creds = this.oauth2Client.credentials
        if (creds.access_token) {
          await this.oauth2Client.revokeToken(creds.access_token)
        }
      } catch {
        // Token revocation failure is non-fatal during local logout
      }
    }

    await this.tokenStore.clearTokens()
    this.oauth2Client = null
    this.userEmail = null

    return {
      isAuthenticated: false,
      isConfigured: this.isConfigured(),
      userEmail: null,
      scopes: []
    }
  }
}
