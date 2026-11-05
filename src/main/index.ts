import { app, shell, BrowserWindow, nativeTheme, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

import { promises as fs } from 'node:fs'
import { createBackendApi } from './backend/api'
import { BackendClient } from './backend/backend-client'
import { resolveBackendConfig } from './backend/config'
import { ElectronSessionStore } from './backend/electron-session-store'
import { createIpcHandlers } from './backend/handlers'
import { signInWithGoogle } from './backend/login'
import { loadEnvConfig } from './envConfig'
import { registerBackendIpc } from './ipc/backendIpc'

// VOICE_BACKEND_URL / VOICE_BACKEND_DEV_EMAIL from the environment or .env (no other key is read).
loadEnvConfig()
const backendConfig = resolveBackendConfig(process.env)
if (backendConfig.warning) console.warn(`[config] ${backendConfig.warning}`)

// Allow instant audio playback without user gesture requirement
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

/** Opens only web links in the system browser (never file:, custom protocols, …). */
function openWebUrl(url: string): void {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(url)
  } catch {
    // not a URL: ignore
  }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 360,
    minHeight: 560,
    // Matches the renderer's paper colour (light/dark) so resizing never flashes another colour.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1a18' : '#f6f4ef',
    show: false,
    autoHideMenuBar: true,
    title: 'Voice Calendar Agent',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openWebUrl(details.url)
    return { action: 'deny' }
  })

  // The window only ever shows the bundled renderer: send any other navigation to the system browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow.webContents.getURL()) return
    event.preventDefault()
    openWebUrl(url)
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Configure granular media permission handler (microphone only)
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (permission === 'media') {
        const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes
        // Allow audio/microphone specifically; deny video or unspecified media
        if (!mediaTypes || mediaTypes.every((type) => type === 'audio')) {
          callback(true)
          return
        }
      }
      callback(false)
    }
  )

  session.defaultSession.setPermissionCheckHandler((_webContents, permission, _origin, details) => {
    if (permission === 'media') {
      if (!details.mediaType || details.mediaType === 'audio') {
        return true
      }
    }
    return false
  })

  // voice-backend session (tokens stay in the main process, encrypted with safeStorage)
  const userData = app.getPath('userData')
  const client = new BackendClient({
    apiUrl: backendConfig.apiUrl,
    store: new ElectronSessionStore(join(userData, 'backend-session.bin'))
  })
  await client.init()
  // Google tokens of the pre-backend app version are no longer used: delete them.
  await fs.rm(join(userData, 'auth_tokens.bin'), { force: true }).catch(() => undefined)

  registerBackendIpc(
    createIpcHandlers({
      client,
      api: createBackendApi(client),
      config: backendConfig,
      signInWithGoogle: (signal) =>
        signInWithGoogle({ client, openExternal: (url) => shell.openExternal(url), signal }),
      log: (message, error) => console.warn(message, error ?? '')
    }),
    client
  )

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
