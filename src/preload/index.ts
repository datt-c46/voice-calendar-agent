import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { AUTH_CHANGED_EVENT, IPC, type AuthStatusDTO, type CalendarAgentAPI } from '../shared/ipc'

// Every call goes to the main process, which talks to voice-backend; tokens never reach the renderer.
const api: CalendarAgentAPI = {
  executeCommand: (request) => ipcRenderer.invoke(IPC.executeCommand, request),
  confirmAction: (actionId) => ipcRenderer.invoke(IPC.confirmAction, actionId),
  rejectAction: (actionId) => ipcRenderer.invoke(IPC.rejectAction, actionId),
  getCalendarStatus: () => ipcRenderer.invoke(IPC.getCalendarStatus),
  listEvents: (query) => ipcRenderer.invoke(IPC.listEvents, query),
  getAuthStatus: () => ipcRenderer.invoke(IPC.getAuthStatus),
  signInWithGoogle: () => ipcRenderer.invoke(IPC.signInWithGoogle),
  signInDev: () => ipcRenderer.invoke(IPC.signInDev),
  cancelSignIn: () => ipcRenderer.invoke(IPC.cancelSignIn),
  signOut: () => ipcRenderer.invoke(IPC.signOut),
  disconnectGoogle: () => ipcRenderer.invoke(IPC.disconnectGoogle),
  onAuthChanged: (listener) => {
    const wrapped = (_event: IpcRendererEvent, status: AuthStatusDTO): void => listener(status)
    ipcRenderer.on(AUTH_CHANGED_EVENT, wrapped)
    return () => {
      ipcRenderer.removeListener(AUTH_CHANGED_EVENT, wrapped)
    }
  },
  transcribeAudio: (request) => ipcRenderer.invoke(IPC.transcribeAudio, request),
  getSttStatus: () => ipcRenderer.invoke(IPC.getSttStatus),
  piperSynthesize: (request) => ipcRenderer.invoke(IPC.piperSynthesize, request),
  getPiperStatus: () => ipcRenderer.invoke(IPC.getPiperStatus),
  getPiperVoices: () => ipcRenderer.invoke(IPC.getPiperVoices),
  setPiperVoice: (voiceId) => ipcRenderer.invoke(IPC.setPiperVoice, voiceId)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
