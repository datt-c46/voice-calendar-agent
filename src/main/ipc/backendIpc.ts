import { BrowserWindow, ipcMain } from 'electron'
import { AUTH_CHANGED_EVENT, IPC } from '../../shared/ipc'
import type { BackendClient } from '../backend/backend-client'
import type { IpcHandlers } from '../backend/handlers'

/** Wires every `window.api` channel to its handler and pushes auth changes to all windows. */
export function registerBackendIpc(handlers: IpcHandlers, client: BackendClient): void {
  for (const name of Object.keys(IPC) as Array<keyof typeof IPC>) {
    const handler = handlers[name] as (arg?: unknown) => Promise<unknown>
    ipcMain.handle(IPC[name], (_event, arg: unknown) => handler(arg))
  }

  client.onSessionChange(() => {
    void handlers.getAuthStatus().then((status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(AUTH_CHANGED_EVENT, status)
      }
    })
  })
}
