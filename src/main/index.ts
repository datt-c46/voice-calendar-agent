import { app, shell, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

import { AgentOrchestrator } from './agent/agentOrchestrator'
import { loadEnvConfig } from './auth/envConfig'
import { OAuthManager } from './auth/oauthManager'
import { CalendarManager } from './calendar/calendarManager'
import { registerAuthIpc } from './ipc/authIpc'
import { registerCalendarIpc } from './ipc/calendarIpc'
import { registerSttIpc } from './ipc/sttIpc'
import { registerTtsIpc } from './ipc/ttsIpc'
import { SpeechToTextManager } from './voice/stt/sttManager'
import { PiperTtsManager } from './voice/tts/piperManager'

// Load environment variables (.env) globally
loadEnvConfig()

// Allow instant audio playback without user gesture requirement
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Auth, Calendar, STT, TTS manager instances
const oauthManager = new OAuthManager()
const calendarService = new CalendarManager(oauthManager)
const agentOrchestrator = new AgentOrchestrator(calendarService)
const sttManager = new SpeechToTextManager()
const piperManager = new PiperTtsManager()

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
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
    shell.openExternal(details.url)
    return { action: 'deny' }
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

  // Initialize Services & Register IPC
  await calendarService.initialize()
  await sttManager.initialize()
  await piperManager.initialize()
  registerAuthIpc(oauthManager)
  registerCalendarIpc(agentOrchestrator, calendarService)
  registerSttIpc(sttManager)
  registerTtsIpc(piperManager)

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
