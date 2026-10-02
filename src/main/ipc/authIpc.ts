import { ipcMain } from 'electron'
import { OAuthManager } from '../auth/oauthManager'

export function registerAuthIpc(oauthManager: OAuthManager): void {
  // Get current authentication status
  ipcMain.handle('auth:get-status', async () => {
    return await oauthManager.getAuthStatus()
  })

  // Start Google OAuth 2.0 loopback flow
  ipcMain.handle('auth:start-google', async () => {
    return await oauthManager.startAuth()
  })

  // Logout / clear stored tokens
  ipcMain.handle('auth:logout', async () => {
    return await oauthManager.logout()
  })
}
